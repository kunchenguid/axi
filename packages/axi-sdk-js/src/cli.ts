import { basename } from "node:path";
import { AxiError, exitCodeForError } from "./errors.js";
import {
  homeHeaderOutput,
  renderError,
  renderOutput,
  type AxiRenderable,
  type AxiStructuredOutput,
} from "./output.js";
import { runUpdate } from "./update.js";

/**
 * Command names reserved by the SDK as built-ins. A tool may shadow one by
 * registering its own handler in `options.commands`.
 */
export const RESERVED_COMMANDS = ["update"] as const;

type MaybePromise<T> = T | Promise<T>;

export type AxiCliCommand<TContext> = (
  args: string[],
  context: TContext | undefined,
) => MaybePromise<AxiRenderable>;

export interface AxiResolveContextInput {
  command: string | undefined;
  args: string[];
}

export interface AxiCliOptions<TContext = undefined> {
  description: string;
  version?: string;
  /**
   * npm package name override for the built-in `update` command. Defaults to the
   * name resolved from the nearest `package.json`, so most tools never set it.
   */
  packageName?: string;
  argv?: string[];
  topLevelHelp: string;
  commands: Record<string, AxiCliCommand<TContext>>;
  home: AxiCliCommand<TContext>;
  getCommandHelp?: (command: string) => string | null | undefined;
  initialize?: () => void;
  resolveContext?: (input: AxiResolveContextInput) => MaybePromise<TContext>;
  stdout?: { write: (chunk: string) => unknown };
  renderUnknownCommand?: (command: string) => string;
  formatError?: (error: unknown) => { output: string; exitCode: number };
}

function defaultFormatError(error: unknown): {
  output: string;
  exitCode: number;
} {
  if (error instanceof AxiError) {
    return {
      output: `${renderError(error.message, error.code, error.suggestions)}\n`,
      exitCode: exitCodeForError(error),
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    output: `${renderError(message, "UNKNOWN")}\n`,
    exitCode: 1,
  };
}

function defaultUnknownCommand(command: string): string {
  return `${renderError(`Unknown command: ${command}`, "VALIDATION_ERROR", [
    "Run `--help` to see available commands",
  ])}\n`;
}

export async function runAxiCli<TContext = undefined>(
  options: AxiCliOptions<TContext>,
): Promise<void> {
  options.initialize?.();

  const stdout = options.stdout ?? process.stdout;
  const argv = options.argv ?? process.argv.slice(2);

  if (argv.length === 1 && argv[0] === "--help") {
    stdout.write(options.topLevelHelp);
    if (!options.commands.update) {
      if (
        options.topLevelHelp.length > 0 &&
        !options.topLevelHelp.endsWith("\n")
      ) {
        stdout.write("\n");
      }
      stdout.write(builtinCommandsHelp());
    }
    return;
  }

  if (argv.length === 1 && isVersionFlag(argv[0])) {
    if (!options.version) {
      stdout.write(
        `${renderError("Version is not configured for this tool", "VALIDATION_ERROR")}\n`,
      );
      process.exitCode = 2;
      return;
    }

    stdout.write(`${options.version}\n`);
    return;
  }

  const command = argv[0];
  if (!command) {
    const context = await options.resolveContext?.({
      command: undefined,
      args: [],
    });
    await runHandler(options.home, [], context, stdout, options, true);
    return;
  }

  if (command.startsWith("-")) {
    stdout.write(renderLeadingFlagError(command));
    process.exitCode = 2;
    return;
  }

  const args = argv.slice(1);

  // `update` is a reserved built-in. A tool may shadow it by registering its own
  // handler; otherwise the SDK handles the self-update.
  if (command === "update" && !options.commands.update) {
    await runBuiltinUpdate(args, stdout, options);
    return;
  }

  if (args.includes("--help")) {
    const help = options.getCommandHelp?.(command);
    if (help) {
      stdout.write(help);
      return;
    }
  }

  const handler = options.commands[command];
  if (!handler) {
    stdout.write(
      (options.renderUnknownCommand ?? defaultUnknownCommand)(command),
    );
    process.exitCode = 2;
    return;
  }

  const context = await options.resolveContext?.({ command, args });
  await runHandler(handler, args, context, stdout, options, false);
}

async function runHandler<TContext>(
  handler: AxiCliCommand<TContext>,
  args: string[],
  context: TContext | undefined,
  stdout: { write: (chunk: string) => unknown },
  options: AxiCliOptions<TContext>,
  isHomeView: boolean,
): Promise<void> {
  try {
    const output = await handler(args, context);
    stdout.write(`${renderCommandOutput(output, options, isHomeView)}\n`);
  } catch (error) {
    const formatted = (options.formatError ?? defaultFormatError)(error);
    stdout.write(formatted.output);
    process.exitCode = formatted.exitCode;
  }
}

async function runBuiltinUpdate<TContext>(
  args: string[],
  stdout: { write: (chunk: string) => unknown },
  options: AxiCliOptions<TContext>,
): Promise<void> {
  if (args.length === 1 && args[0] === "--help") {
    stdout.write(builtinUpdateHelp());
    return;
  }

  try {
    const output = await runUpdate({
      args,
      stdout,
      packageName: options.packageName,
      version: options.version,
    });
    stdout.write(`${renderOutput(output)}\n`);
  } catch (error) {
    const formatted = (options.formatError ?? defaultFormatError)(error);
    stdout.write(formatted.output);
    process.exitCode = formatted.exitCode;
  }
}

function resolveBinName(): string {
  return basename(process.argv[1] ?? "tool") || "tool";
}

function builtinCommandsHelp(): string {
  const bin = resolveBinName();
  return `${renderOutput({
    "built-in": {
      update: `Upgrade \`${bin}\` to the latest published version`,
      "update --check": "Report current vs latest without installing",
    },
  })}\n`;
}

function builtinUpdateHelp(): string {
  const bin = resolveBinName();
  return `${renderOutput({
    command: "update",
    description: `Upgrade \`${bin}\` to the latest published npm version`,
    flags: {
      "--check": "Report current vs latest and exit without installing",
    },
    examples: [`${bin} update`, `${bin} update --check`],
  })}\n`;
}

function renderLeadingFlagError(flag: string): string {
  const bin = basename(process.argv[1] ?? "tool") || "tool";
  return `${renderError(
    "Flags must come after the command",
    "VALIDATION_ERROR",
    [
      `Run \`${bin} <command> [args] [flags]\``,
      `Move \`${flag}\` after the command instead of before it`,
    ],
  )}\n`;
}

function isVersionFlag(flag: string): boolean {
  return flag === "-v" || flag === "-V" || flag === "--version";
}

function renderCommandOutput<TContext>(
  output: AxiRenderable,
  options: AxiCliOptions<TContext>,
  isHomeView: boolean,
): string {
  if (!isHomeView) {
    return renderOutput(output);
  }

  const header = homeHeaderOutput({ description: options.description });

  if (typeof output === "string") {
    return `${renderOutput(header)}\n${output}`;
  }

  return renderOutput(mergeHomeHeader(header, output));
}

function mergeHomeHeader(
  header: AxiStructuredOutput,
  output: AxiStructuredOutput,
): AxiStructuredOutput {
  const rest = { ...output };
  delete rest.bin;
  delete rest.description;

  return {
    ...header,
    ...rest,
  };
}
