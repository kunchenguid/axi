import { parseArgs, type ParseArgsConfig } from "node:util";
import { resolveBinName } from "./bin.js";
import { AxiError } from "./errors.js";

/**
 * Declarative flag specs for AXI principle 6 ("Fail loud on unrecognized
 * input"). A command that declares its flags gets them checked by
 * `node:util`'s `parseArgs` before any work happens; anything undeclared is
 * refused by name, with the valid flags listed, so one turn self-corrects.
 *
 * The declaration is a `parseArgs` options map plus one AXI extension
 * (`refuse`). Everything here is opt-in: a command that declares nothing is
 * never checked and receives argv exactly as given.
 */

export type AxiFlagType = "string" | "boolean";

export type AxiFlagValue = string | boolean | string[] | boolean[];

/** A flag the command accepts. Mirrors a `parseArgs` option config. */
export interface AxiFlagSpec {
  type: AxiFlagType;
  /** Single-character alias, e.g. `r` for `-r`. */
  short?: string;
  /** Accept the flag more than once; `parsed.values[name]` is then an array. */
  multiple?: boolean;
  /** Value used in `parsed.values` when the flag is absent. Never appears in `args`. */
  default?: AxiFlagValue;
}

/**
 * A flag that is refused with a targeted message — for a likely guess, or a
 * renamed/removed flag that should point at its replacement.
 */
export interface AxiRefusedFlagSpec {
  refuse: string;
}

export type AxiFlagDeclaration = AxiFlagSpec | AxiRefusedFlagSpec;

/** Long flag name (without dashes) -> declaration. */
export type AxiFlags = Record<string, AxiFlagDeclaration>;

/** What `parseArgs` produced: option values (defaults included) and positionals. */
export interface AxiParsedArgs {
  values: Record<string, AxiFlagValue | undefined>;
  positionals: string[];
}

export interface AxiCheckedArgs {
  /** argv rewritten into canonical `--flag value` form; see `checkFlags`. */
  args: string[];
  parsed: AxiParsedArgs;
}

export interface AxiCheckFlagsOptions {
  /** Flags merged under the command's own (the command's declaration wins). */
  globalFlags?: AxiFlags;
  /** Executable name used in the `--help` suggestion. Defaults to argv[1]'s basename. */
  bin?: string;
}

function isRefused(spec: AxiFlagDeclaration): spec is AxiRefusedFlagSpec {
  return "refuse" in spec;
}

/**
 * Merge global and command-level declarations. The command's declaration wins
 * on a name clash, so a command can narrow or refuse a global flag.
 * `--help` is always accepted unless the command declares it itself.
 */
function mergeFlags(flags: AxiFlags, globalFlags?: AxiFlags): AxiFlags {
  const merged: AxiFlags = { ...globalFlags, ...flags };
  const help = merged.help;
  if (!help || isRefused(help)) {
    merged.help = { type: "boolean" };
  }
  return merged;
}

/**
 * Check `args` against `flags` and normalize them.
 *
 * Throws `AxiError("VALIDATION_ERROR")` (exit 2) for an unknown flag, a
 * refused flag, a value flag with no value, or a boolean flag given a value.
 * Returns the args rewritten into the one form a hand-written parser
 * understands — `--limit=5` becomes `--limit`, `5`; a declared short alias
 * becomes its long form — with positionals, option values, and everything
 * after a bare `--` passed through byte-identical and in order.
 *
 * `runAxiCli` calls this for every command that declares `flags`; nested
 * subcommand dispatchers call it themselves and get identical errors.
 */
export function checkFlags(
  args: string[],
  flags: AxiFlags,
  commandName: string,
  options: AxiCheckFlagsOptions = {},
): AxiCheckedArgs {
  const bin = options.bin ?? resolveBinName();
  const merged = mergeFlags(flags, options.globalFlags);

  const parseOptions: NonNullable<ParseArgsConfig["options"]> = {};
  const refused = new Map<string, string>();

  for (const [name, spec] of Object.entries(merged)) {
    if (isRefused(spec)) {
      refused.set(name, spec.refuse);
      continue;
    }
    // Only forward what parseArgs understands; future declaration fields
    // (description, choices, ...) must not reach Node's validator.
    parseOptions[name] = {
      type: spec.type,
      ...(spec.short !== undefined ? { short: spec.short } : {}),
      ...(spec.multiple !== undefined ? { multiple: spec.multiple } : {}),
      ...(spec.default !== undefined ? { default: spec.default } : {}),
    };
  }

  const fail = (
    message: string,
    suggestions: string[],
    hint?: string,
  ): never => {
    throw new AxiError(message, "VALIDATION_ERROR", [
      ...(hint ? [hint] : []),
      ...suggestions,
      `Run \`${bin} ${commandName} --help\` for usage`,
    ]);
  };

  const validFlagsLine = (): string => {
    const names = Object.keys(parseOptions)
      .filter((name) => name !== "help")
      .sort()
      .map((name) => `--${name}`);
    return names.length > 0
      ? `Valid flags for \`${commandName}\`: ${names.join(", ")} (--help always allowed)`
      : `\`${commandName}\` takes no flags (--help always allowed)`;
  };

  const unknownFlag = (flag: string): never => {
    const longName = flag.startsWith("--") ? flag.slice(2) : undefined;
    return fail(
      `Unknown flag ${flag} for \`${commandName}\``,
      [validFlagsLine()],
      longName !== undefined ? refused.get(longName) : undefined,
    );
  };

  // Refused flags are checked first so the targeted hint wins over whatever
  // parseArgs would have said about the same token. Nothing after `--` counts.
  for (const arg of args) {
    if (arg === "--") {
      break;
    }
    if (!arg.startsWith("--")) {
      continue;
    }
    const equals = arg.indexOf("=");
    const name = arg.slice(2, equals === -1 ? undefined : equals);
    if (refused.has(name)) {
      unknownFlag(`--${name}`);
    }
  }

  let result: ReturnType<typeof parseArgs>;
  try {
    result = parseArgs({
      args,
      options: parseOptions,
      strict: true,
      allowPositionals: true,
      tokens: true,
    });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    const message = error instanceof Error ? error.message : String(error);
    const flag = flagFromNodeMessage(message);

    if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" && flag) {
      return unknownFlag(flag);
    }

    if (code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE" && flag) {
      if (message.includes("does not take an argument")) {
        return fail(
          `Flag ${flag} for \`${commandName}\` does not take a value`,
          [`Pass \`${flag}\` on its own`],
        );
      }
      return fail(`Flag ${flag} for \`${commandName}\` needs a value`, [
        `Pass \`${flag} <value>\`, or \`${flag}=<value>\` when the value starts with a dash`,
      ]);
    }

    if (code.startsWith("ERR_PARSE_ARGS_")) {
      return fail(message, [validFlagsLine()]);
    }

    throw error;
  }

  return {
    args: normalizeArgs(args, result.tokens ?? []),
    parsed: {
      values: result.values as AxiParsedArgs["values"],
      positionals: result.positionals,
    },
  };
}

/**
 * Pull the offending flag out of a Node parseArgs message. Node quotes it as
 * `'--foo'`, or `'-r, --foo'` when a short alias exists; the long form is
 * always last.
 */
function flagFromNodeMessage(message: string): string | undefined {
  const quoted = /'([^']+)'/.exec(message)?.[1];
  if (!quoted) {
    return undefined;
  }
  const last = quoted.split(", ").at(-1) ?? quoted;
  return last.split(" ")[0];
}

type ParseArgsToken = NonNullable<
  ReturnType<typeof parseArgs>["tokens"]
>[number];

function normalizeArgs(args: string[], tokens: ParseArgsToken[]): string[] {
  const normalized: string[] = [];
  for (const token of tokens) {
    if (token.kind === "option-terminator") {
      normalized.push("--", ...args.slice(token.index + 1));
      break;
    }
    if (token.kind === "positional") {
      normalized.push(token.value);
      continue;
    }
    normalized.push(`--${token.name}`);
    if (token.value !== undefined) {
      normalized.push(token.value);
    }
  }
  return normalized;
}
