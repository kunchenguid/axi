import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { AxiError } from "./errors.js";

/** Where a resolved secret came from. */
export type SecretSource = "env" | "file" | "command";

/** A resolved secret plus the variable that supplied it (safe to print). */
export interface ResolvedSecret {
  value: string;
  source: SecretSource;
  /** `NAME`, `NAME_FILE`, or `NAME_COMMAND`. */
  variable: string;
}

/** Outcome of running a `NAME_COMMAND` credential command. */
export type SecretCommandResult =
  | { status: "exited"; exitCode: number; stdout: string }
  | { status: "signaled" }
  | { status: "timed-out" }
  | { status: "output-too-large" }
  | { status: "failed-to-start" };

/** Runs a credential command through the shell and captures only its stdout. */
export type SecretCommandRunner = (
  command: string,
  options: { env: NodeJS.ProcessEnv; timeoutMs: number },
) => Promise<SecretCommandResult>;

/** Options for `resolveSecret()`. */
export interface ResolveSecretOptions {
  /** Base variable name, for example `DATADOG_API_KEY`. */
  name: string;
  env?: NodeJS.ProcessEnv;
  /** File reader seam for `NAME_FILE`. */
  readFile?: (path: string) => string;
  /** Command runner seam for `NAME_COMMAND`. */
  exec?: SecretCommandRunner;
  /** `NAME_COMMAND` timeout in milliseconds. Defaults to 10 seconds. */
  timeoutMs?: number;
}

/** Why a configured credential source could not produce a secret. */
export type CredentialSourceFailure =
  | "env-empty"
  | "file-missing"
  | "file-unreadable"
  | "file-empty"
  | "command-failed"
  | "command-timeout"
  | "command-output-too-large"
  | "command-empty";

/** More than one of `NAME`, `NAME_FILE`, and `NAME_COMMAND` is set. */
export class CredentialConflictError extends AxiError {
  constructor(public readonly variables: string[]) {
    super(`Set only one of ${variables.join(", ")}`, "CREDENTIAL_CONFLICT", [
      `Unset all but one of ${variables.join(", ")}`,
    ]);
    this.name = "CredentialConflictError";
  }
}

/**
 * A configured credential source failed. Messages name the variable and never
 * include the secret, the command text, or the command's stderr.
 */
export class CredentialSourceError extends AxiError {
  constructor(
    public readonly variable: string,
    public readonly reason: CredentialSourceFailure,
    message: string,
    suggestions: string[],
  ) {
    super(message, "CREDENTIAL_ERROR", suggestions);
    this.name = "CredentialSourceError";
  }
}

const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;

/**
 * Resolve a secret from exactly one of three variables: `NAME` (the value),
 * `NAME_FILE` (a file holding the value), or `NAME_COMMAND` (a shell command
 * that prints the value, such as `op read ...`, `pass show ...`, or
 * `security find-generic-password -w ...`). File reads and commands run with
 * the caller's privileges and environment, like reading `NAME` itself; resolve
 * only variable names your tool documents. One trailing newline is stripped
 * from file contents and command output. Empty variables count as unset.
 * Returns `undefined` when none is set.
 */
export async function resolveSecret(
  options: ResolveSecretOptions,
): Promise<ResolvedSecret | undefined> {
  const env = options.env ?? process.env;
  const { name } = options;
  const configured = (["", "_FILE", "_COMMAND"] as const)
    .map((suffix) => `${name}${suffix}`)
    .filter((variable) => (env[variable] ?? "") !== "");

  if (configured.length > 1) {
    throw new CredentialConflictError(configured);
  }

  const variable = configured[0];
  if (!variable) {
    return undefined;
  }
  const setting = env[variable] as string;

  if (variable === name) {
    return {
      value: requireNonBlank(setting, variable, "env-empty"),
      source: "env",
      variable,
    };
  }

  if (variable === `${name}_FILE`) {
    return {
      value: readSecretFile(setting, variable, options.readFile),
      source: "file",
      variable,
    };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const result = await (options.exec ?? runSecretCommand)(setting, {
    env,
    timeoutMs,
  });
  return {
    value: secretFromCommand(result, variable, timeoutMs),
    source: "command",
    variable,
  };
}

function stripOneTrailingNewline(value: string): string {
  return value.replace(/\r?\n$/, "");
}

function requireNonBlank(
  value: string,
  variable: string,
  reason: "env-empty" | "file-empty" | "command-empty",
): string {
  if (value.trim() !== "") {
    return value;
  }
  const what =
    reason === "env-empty"
      ? "is blank"
      : reason === "file-empty"
        ? "points to an empty file"
        : "printed nothing";
  throw new CredentialSourceError(variable, reason, `${variable} ${what}`, [
    `Make ${variable} provide the secret, or unset it`,
  ]);
}

function readSecretFile(
  path: string,
  variable: string,
  readFile: (path: string) => string = (file) => readFileSync(file, "utf-8"),
): string {
  let contents: string;
  try {
    contents = readFile(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      throw new CredentialSourceError(
        variable,
        "file-missing",
        `${variable} points to a file that does not exist: ${path}`,
        [`Create ${path} or point ${variable} at the secret file`],
      );
    }
    throw new CredentialSourceError(
      variable,
      "file-unreadable",
      `${variable} points to a file that cannot be read: ${path}${code ? ` (${code})` : ""}`,
      [`Make ${path} a readable regular file`],
    );
  }
  return requireNonBlank(
    stripOneTrailingNewline(contents),
    variable,
    "file-empty",
  );
}

function secretFromCommand(
  result: SecretCommandResult,
  variable: string,
  timeoutMs: number,
): string {
  switch (result.status) {
    case "exited":
      if (result.exitCode !== 0) {
        throw commandFailed(variable, `exited with code ${result.exitCode}`);
      }
      return requireNonBlank(
        stripOneTrailingNewline(result.stdout),
        variable,
        "command-empty",
      );
    case "signaled":
      throw commandFailed(variable, "was terminated by a signal");
    case "failed-to-start":
      throw commandFailed(variable, "could not be started");
    case "output-too-large":
      throw new CredentialSourceError(
        variable,
        "command-output-too-large",
        `${variable} output exceeded the 1 MiB limit`,
        [`Make the command in ${variable} print only the secret`],
      );
    case "timed-out":
      throw new CredentialSourceError(
        variable,
        "command-timeout",
        `${variable} timed out after ${timeoutMs}ms`,
        [
          `Check that the command in ${variable} does not wait for input`,
          "Unlock or sign in to the secret manager first",
        ],
      );
  }
}

function commandFailed(variable: string, what: string): CredentialSourceError {
  return new CredentialSourceError(
    variable,
    "command-failed",
    `${variable} ${what}`,
    [`Run the command in ${variable} yourself to see its error`],
  );
}

/**
 * Default runner: the platform shell (`/bin/sh -c` on POSIX, `cmd.exe` on
 * Windows) with stdin closed and stderr discarded, because diagnostics can
 * include secret material. The command tree is killed on timeout or when output exceeds the
 * limit so a hung helper cannot keep the pipe open.
 */
export const runSecretCommand: SecretCommandRunner = (
  command,
  { env, timeoutMs },
) =>
  new Promise((resolve) => {
    let settled = false;
    const settle = (result: SecretCommandResult) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }
    };

    const child = spawn(command, {
      shell: true,
      env,
      stdio: ["ignore", "pipe", "ignore"],
      detached: process.platform !== "win32",
    });
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    const kill = () => {
      if (child.pid === undefined) {
        return;
      }
      if (process.platform === "win32") {
        try {
          const killer = spawn(
            "taskkill",
            ["/pid", String(child.pid), "/T", "/F"],
            {
              stdio: "ignore",
              windowsHide: true,
            },
          );
          killer.on("error", () => {});
        } catch {
          // The command may already have exited.
        }
        return;
      }
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already exited.
      }
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        kill();
        settle({ status: "output-too-large" });
      } else {
        chunks.push(chunk);
      }
    });
    child.on("error", () => settle({ status: "failed-to-start" }));
    child.on("close", (code) =>
      settle(
        code === null
          ? { status: "signaled" }
          : {
              status: "exited",
              exitCode: code,
              stdout: Buffer.concat(chunks).toString("utf-8"),
            },
      ),
    );

    const timer = setTimeout(() => {
      kill();
      settle({ status: "timed-out" });
    }, timeoutMs);
  });
