import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CredentialConflictError,
  CredentialSourceError,
  resolveSecret,
  runSecretCommand,
  type CredentialSourceFailure,
  type SecretCommandResult,
} from "../src/credentials.js";
import { AxiError } from "../src/errors.js";
import { renderError } from "../src/output.js";

const SENTINEL = "sk-SENTINEL-6f1d2c";
const NAME = "DEMO_AXI_TOKEN";

const dir = mkdtempSync(join(tmpdir(), "axi-credentials-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function file(name: string, contents: string): string {
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

const fakeExec =
  (result: SecretCommandResult) => async (): Promise<SecretCommandResult> =>
    result;

async function failure(
  options: Parameters<typeof resolveSecret>[0],
): Promise<unknown> {
  return resolveSecret(options).then(
    () => {
      throw new Error("expected resolveSecret to fail");
    },
    (error: unknown) => error,
  );
}

describe("resolveSecret sources", () => {
  it("returns undefined when no source is set, treating empty as unset", async () => {
    await expect(
      resolveSecret({ name: NAME, env: { [NAME]: "", [`${NAME}_FILE`]: "" } }),
    ).resolves.toBeUndefined();
  });

  it("resolves NAME verbatim", async () => {
    await expect(
      resolveSecret({ name: NAME, env: { [NAME]: SENTINEL } }),
    ).resolves.toEqual({ value: SENTINEL, source: "env", variable: NAME });
  });

  it("resolves NAME_FILE and strips one trailing newline", async () => {
    const path = file("token", `${SENTINEL}\n\n`);
    await expect(
      resolveSecret({ name: NAME, env: { [`${NAME}_FILE`]: path } }),
    ).resolves.toEqual({
      value: `${SENTINEL}\n`,
      source: "file",
      variable: `${NAME}_FILE`,
    });
  });

  it("resolves NAME_COMMAND through the shell and strips one trailing newline", async () => {
    const path = file("token-for-cat", `${SENTINEL}\r\n`);
    await expect(
      resolveSecret({
        name: NAME,
        env: { ...process.env, [`${NAME}_COMMAND`]: `cat '${path}'` },
      }),
    ).resolves.toEqual({
      value: SENTINEL,
      source: "command",
      variable: `${NAME}_COMMAND`,
    });
  });

  it("passes the environment and timeout to the command runner", async () => {
    const calls: unknown[] = [];
    const env = { [`${NAME}_COMMAND`]: "op read op://vault/item/token" };
    await resolveSecret({
      name: NAME,
      env,
      timeoutMs: 1234,
      exec: async (command, options) => {
        calls.push([command, options]);
        return { status: "exited", exitCode: 0, stdout: SENTINEL };
      },
    });
    expect(calls).toEqual([
      ["op read op://vault/item/token", { env, timeoutMs: 1234 }],
    ]);
  });
});

describe("resolveSecret conflicts", () => {
  const all = {
    [NAME]: SENTINEL,
    [`${NAME}_FILE`]: "/tmp/token",
    [`${NAME}_COMMAND`]: `echo ${SENTINEL}`,
  };
  const combos: string[][] = [
    [NAME, `${NAME}_FILE`],
    [NAME, `${NAME}_COMMAND`],
    [`${NAME}_FILE`, `${NAME}_COMMAND`],
    [NAME, `${NAME}_FILE`, `${NAME}_COMMAND`],
  ];

  for (const variables of combos) {
    it(`rejects ${variables.join(" + ")}`, async () => {
      const env = Object.fromEntries(variables.map((v) => [v, all[v]]));
      const error = await failure({ name: NAME, env });
      expect(error).toBeInstanceOf(CredentialConflictError);
      expect(error).toBeInstanceOf(AxiError);
      expect((error as CredentialConflictError).variables).toEqual(variables);
      expect((error as CredentialConflictError).code).toBe(
        "CREDENTIAL_CONFLICT",
      );
    });
  }
});

describe("resolveSecret failures", () => {
  mkdirSync(join(dir, "a-directory"), { recursive: true });

  const cases: Array<{
    name: string;
    reason: CredentialSourceFailure;
    options: Parameters<typeof resolveSecret>[0];
  }> = [
    {
      name: "blank NAME",
      reason: "env-empty",
      options: { name: NAME, env: { [NAME]: "  " } },
    },
    {
      name: "missing file",
      reason: "file-missing",
      options: { name: NAME, env: { [`${NAME}_FILE`]: join(dir, "nope") } },
    },
    {
      name: "directory as file",
      reason: "file-unreadable",
      options: {
        name: NAME,
        env: { [`${NAME}_FILE`]: join(dir, "a-directory") },
      },
    },
    {
      name: "empty file",
      reason: "file-empty",
      options: { name: NAME, env: { [`${NAME}_FILE`]: file("empty", "\n") } },
    },
    {
      name: "non-zero command exit",
      reason: "command-failed",
      options: {
        name: NAME,
        env: { [`${NAME}_COMMAND`]: "false" },
        exec: fakeExec({ status: "exited", exitCode: 3, stdout: SENTINEL }),
      },
    },
    {
      name: "command killed by a signal",
      reason: "command-failed",
      options: {
        name: NAME,
        env: { [`${NAME}_COMMAND`]: "x" },
        exec: fakeExec({ status: "signaled" }),
      },
    },
    {
      name: "command that cannot start",
      reason: "command-failed",
      options: {
        name: NAME,
        env: { [`${NAME}_COMMAND`]: "x" },
        exec: fakeExec({ status: "failed-to-start" }),
      },
    },
    {
      name: "command timeout",
      reason: "command-timeout",
      options: {
        name: NAME,
        env: { [`${NAME}_COMMAND`]: "x" },
        exec: fakeExec({ status: "timed-out" }),
      },
    },
    {
      name: "whitespace-only command output",
      reason: "command-empty",
      options: {
        name: NAME,
        env: { [`${NAME}_COMMAND`]: "x" },
        exec: fakeExec({ status: "exited", exitCode: 0, stdout: " \t\n" }),
      },
    },
  ];

  for (const testCase of cases) {
    it(`reports ${testCase.name} as ${testCase.reason}`, async () => {
      const error = await failure(testCase.options);
      expect(error).toBeInstanceOf(CredentialSourceError);
      expect((error as CredentialSourceError).reason).toBe(testCase.reason);
      expect((error as CredentialSourceError).code).toBe("CREDENTIAL_ERROR");
    });
  }

  it("reports the default 10 s timeout", async () => {
    const error = await failure({
      name: NAME,
      env: { [`${NAME}_COMMAND`]: "x" },
      exec: async (_command, { timeoutMs }) => {
        expect(timeoutMs).toBe(10_000);
        return { status: "timed-out" };
      },
    });
    expect((error as Error).message).toContain("10000ms");
  });
});

describe("resolveSecret redaction", () => {
  const secretPath = file("secret-path-contents", "");
  const branches: Array<Parameters<typeof resolveSecret>[0]> = [
    { name: NAME, env: { [NAME]: SENTINEL, [`${NAME}_FILE`]: secretPath } },
    {
      name: NAME,
      env: {
        [`${NAME}_FILE`]: secretPath,
        [`${NAME}_COMMAND`]: `echo ${SENTINEL}`,
      },
    },
    { name: NAME, env: { [`${NAME}_FILE`]: secretPath } },
    {
      name: NAME,
      env: { [`${NAME}_COMMAND`]: `echo ${SENTINEL}; exit 4` },
      exec: fakeExec({ status: "exited", exitCode: 4, stdout: SENTINEL }),
    },
    {
      name: NAME,
      env: { [`${NAME}_COMMAND`]: `echo ${SENTINEL}` },
      exec: fakeExec({ status: "timed-out" }),
    },
    {
      name: NAME,
      env: { [`${NAME}_COMMAND`]: `printf ' ' # ${SENTINEL}` },
      exec: fakeExec({ status: "exited", exitCode: 0, stdout: " " }),
    },
    {
      name: NAME,
      env: { [`${NAME}_COMMAND`]: `echo ${SENTINEL} >&2; exit 1` },
    },
  ];

  it("never puts the secret or the command text in errors or TOON output", async () => {
    for (const options of branches) {
      const error = (await failure(options)) as AxiError;
      const rendered = [
        error.message,
        String(error),
        JSON.stringify(error),
        error.suggestions.join("\n"),
        renderError(error.message, error.code, error.suggestions),
      ].join("\n");
      expect(rendered).not.toContain(SENTINEL);
    }
  });
});

describe("runSecretCommand", () => {
  it("captures stdout only and reports the exit code", async () => {
    await expect(
      runSecretCommand("printf out; printf err >&2; exit 7", {
        env: process.env,
        timeoutMs: 5_000,
      }),
    ).resolves.toEqual({ status: "exited", exitCode: 7, stdout: "out" });
  });

  it("kills a command that exceeds the stdout limit", async () => {
    await expect(
      runSecretCommand("yes x", { env: process.env, timeoutMs: 5_000 }),
    ).resolves.toEqual({ status: "output-too-large" });
  });

  it("reports oversized output without including command output", async () => {
    const error = (await failure({
      name: NAME,
      env: { [`${NAME}_COMMAND`]: "yes secret-output" },
    })) as CredentialSourceError;
    expect(error.reason).toBe("command-output-too-large");
    expect(error.message).toContain("1 MiB");
    expect(error.message).not.toContain("secret-output");
  });

  it("does not read stdin", async () => {
    await expect(
      runSecretCommand("cat", { env: process.env, timeoutMs: 5_000 }),
    ).resolves.toEqual({ status: "exited", exitCode: 0, stdout: "" });
  });

  it("times out and kills the whole process group", async () => {
    const started = Date.now();
    await expect(
      runSecretCommand("sleep 30 & sleep 30; wait", {
        env: process.env,
        timeoutMs: 200,
      }),
    ).resolves.toEqual({ status: "timed-out" });
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
