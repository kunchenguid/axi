import { resolveBinName } from "./bin.js";
import { AxiError, exitCodeForError } from "./errors.js";
import {
  checkFlags,
  type AxiCheckedArgs,
  type AxiFlags,
  type AxiParsedArgs,
} from "./flags.js";
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

const stdoutWithErrorHandler = new WeakSet<object>();

/**
 * A command handler. `parsed` is only present when the command declares
 * `flags` (see `AxiCliCommandSpec`); handlers may ignore it.
 */
export type AxiCliCommand<TContext> = (
  args: string[],
  context: TContext | undefined,
  parsed?: AxiParsedArgs,
) => MaybePromise<AxiRenderable>;

/**
 * The handler of a declared command: `parsed` is always present. A plain
 * `(args, context) => ...` handler is assignable here too.
 */
export type AxiCliDeclaredCommand<TContext> = (
  args: string[],
  context: TContext | undefined,
  parsed: AxiParsedArgs,
) => MaybePromise<AxiRenderable>;

/**
 * A command that declares its flags. Before `resolveContext` and the handler
 * run, `args` are checked against `flags` (plus `globalFlags`) and rewritten
 * into canonical `--flag value` form; an unknown or malformed flag is a
 * `VALIDATION_ERROR` (exit 2). `flags: {}` means the command takes no flags.
 */
export interface AxiCliCommandSpec<TContext> {
  flags: AxiFlags;
  run: AxiCliDeclaredCommand<TContext>;
}

/**
 * Either a bare handler (unchecked, receives argv exactly as given) or a
 * declared command. Behaviour only changes when a command declares `flags`.
 */
export type AxiCliCommandEntry<TContext> =
  | AxiCliCommand<TContext>
  | AxiCliCommandSpec<TContext>;

export interface AxiResolveContextInput {
  command: string | undefined;
  /** Normalized when the command declares `flags`; otherwise argv as given. */
  args: string[];
  /** Present only when the command declares `flags`. */
  parsed?: AxiParsedArgs;
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
  commands: Record<string, AxiCliCommandEntry<TContext>>;
  home: AxiCliCommand<TContext>;
  /**
   * Flags merged into every command that declares `flags` (e.g. an account
   * selector). A command's own declaration wins on a name clash. Has no
   * effect on bare-function commands.
   */
  globalFlags?: AxiFlags;
  getCommandHelp?: (command: string) => string | null | undefined;
  initialize?: () => MaybePromise<void>;
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
  const stdout = options.stdout ?? process.stdout;
  handleStdoutErrors(stdout);

  try {
    await options.initialize?.();
  } catch (error) {
    writeFormattedError(error, stdout, options);
    return;
  }

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
    await runHandler(
      options.home,
      [],
      { command: undefined, args: [] },
      stdout,
      options,
      true,
    );
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

  const entry = options.commands[command];
  if (!entry) {
    stdout.write(
      (options.renderUnknownCommand ?? defaultUnknownCommand)(command),
    );
    process.exitCode = 2;
    return;
  }

  if (typeof entry === "function") {
    await runHandler(entry, args, { command, args }, stdout, options, false);
    return;
  }

  // A declared command is checked before any context resolution or work, so
  // an unknown flag never reaches a dependency call.
  let checked: AxiCheckedArgs;
  try {
    checked = checkFlags(args, entry.flags, command, {
      globalFlags: options.globalFlags,
    });
  } catch (error) {
    writeFormattedError(error, stdout, options);
    return;
  }

  await runHandler(
    entry.run,
    checked.args,
    { command, args: checked.args, parsed: checked.parsed },
    stdout,
    options,
    false,
    checked.parsed,
  );
}

function handleStdoutErrors(stdout: {
  write: (chunk: string) => unknown;
}): void {
  const errorObservable = stdout as {
    on?: (event: "error", listener: (error: unknown) => void) => unknown;
  };

  if (
    typeof errorObservable.on !== "function" ||
    stdoutWithErrorHandler.has(stdout)
  ) {
    return;
  }

  stdoutWithErrorHandler.add(stdout);
  errorObservable.on("error", (error) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EPIPE"
    ) {
      process.exitCode = 0;
      return;
    }

    throw error;
  });
}

async function runHandler<TContext>(
  handler: AxiCliCommand<TContext> | AxiCliDeclaredCommand<TContext>,
  args: string[],
  contextInput: AxiResolveContextInput,
  stdout: { write: (chunk: string) => unknown },
  options: AxiCliOptions<TContext>,
  isHomeView: boolean,
  parsed?: AxiParsedArgs,
): Promise<void> {
  try {
    // Context resolution stays inside this boundary so a failing `resolveContext`
    // reports through the same structured-error contract as the handler itself,
    // and still only runs for views that actually need a context.
    const context = await options.resolveContext?.(contextInput);
    // A bare function is called with exactly the two arguments it always got.
    const output = parsed
      ? await handler(args, context, parsed)
      : await (handler as AxiCliCommand<TContext>)(args, context);
    stdout.write(`${renderCommandOutput(output, options, isHomeView)}\n`);
  } catch (error) {
    writeFormattedError(error, stdout, options);
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
    writeFormattedError(error, stdout, options);
  }
}

function writeFormattedError<TContext>(
  error: unknown,
  stdout: { write: (chunk: string) => unknown },
  options: AxiCliOptions<TContext>,
): void {
  const formatted = (options.formatError ?? defaultFormatError)(error);
  stdout.write(formatted.output);
  process.exitCode = formatted.exitCode;
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
  const bin = resolveBinName();
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
