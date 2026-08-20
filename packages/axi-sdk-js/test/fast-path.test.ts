import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAxiCli } from "../src/cli.js";
import { tryFastPath } from "../src/fast-path.js";

const execFileAsync = promisify(execFile);

const VERSION = "1.2.3";

/**
 * Every flag-shaped argv worth probing: the three the SDK accepts, plus the
 * near-misses that must NOT be treated as a version request. The parity test
 * below drives each one through both `tryFastPath` and `runAxiCli` and asserts
 * they agree, so the fast and slow paths cannot drift apart.
 */
const CANDIDATE_FLAGS = [
  "-v",
  "-V",
  "--version",
  "-version",
  "--v",
  "--V",
  "--Version",
  "--VERSION",
  "v",
  "V",
  "version",
  "--ver",
  "-h",
  "--help",
  "",
];

const ACCEPTED_FLAGS = ["-v", "-V", "--version"];

async function runSlowPath(argv: string[]): Promise<string> {
  const chunks: string[] = [];
  await runAxiCli({
    description: "Fixture CLI",
    version: VERSION,
    topLevelHelp: "fixture help",
    argv,
    home: async () => "home output",
    commands: { issue: async () => "issue output" },
    stdout: { write: (chunk: string) => chunks.push(chunk) },
  });
  return chunks.join("");
}

function runFastPath(argv: string[]): { handled: boolean; output: string } {
  const chunks: string[] = [];
  const handled = tryFastPath(argv, {
    version: VERSION,
    stdout: { write: (chunk: string) => chunks.push(chunk) },
  });
  return { handled, output: chunks.join("") };
}

describe("tryFastPath", () => {
  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it.each(ACCEPTED_FLAGS)("emits `${version}\\n` for bare %s", (flag) => {
    const { handled, output } = runFastPath([flag]);

    expect(handled).toBe(true);
    expect(output).toBe(`${VERSION}\n`);
  });

  it.each(CANDIDATE_FLAGS)(
    "agrees with runAxiCli on whether %j is a version request",
    async (flag) => {
      const { handled, output } = runFastPath([flag]);
      const slowOutput = await runSlowPath([flag]);

      const slowPathPrintedVersion = slowOutput === `${VERSION}\n`;
      expect(handled).toBe(slowPathPrintedVersion);
      expect(handled).toBe(ACCEPTED_FLAGS.includes(flag));

      if (handled) {
        expect(output).toBe(slowOutput);
        expect(process.exitCode).toBeUndefined();
      } else {
        expect(output).toBe("");
      }
    },
  );

  it("defaults to process.stdout when no stdout is supplied", () => {
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      expect(tryFastPath(["--version"], { version: VERSION })).toBe(true);
      expect(write).toHaveBeenCalledWith(`${VERSION}\n`);
    } finally {
      write.mockRestore();
    }
  });

  it.each([
    [[]],
    [["issue"]],
    [["issue", "list"]],
    [["--version", "--json"]],
    [["issue", "--version"]],
    [["-v", "-v"]],
  ])("returns false and writes nothing for %j", (argv) => {
    const { handled, output } = runFastPath(argv);

    expect(handled).toBe(false);
    expect(output).toBe("");
  });
});

describe("tryFastPath entry-point integration", () => {
  const fixturePath = fileURLToPath(
    new URL("./fixtures/fast-path-bin.mjs", import.meta.url),
  );
  const viteNodePath = fileURLToPath(
    new URL("../node_modules/.bin/vite-node", import.meta.url),
  );

  it.each(ACCEPTED_FLAGS)(
    "answers %s without loading the tool's command graph",
    async (flag) => {
      const { stdout, stderr } = await execFileAsync(
        viteNodePath,
        [fixturePath, flag],
        { cwd: new URL("..", import.meta.url) },
      );

      expect(stdout).toBe("9.9.9\n");
      expect(stderr).toBe("");
    },
  );

  it("falls through to the full CLI for real commands", async () => {
    const { stdout } = await execFileAsync(
      viteNodePath,
      [fixturePath, "issue"],
      { cwd: new URL("..", import.meta.url) },
    );

    expect(stdout).toContain("loaded-heavy-graph\n");
    expect(stdout).toContain("issue output");
  });
});
