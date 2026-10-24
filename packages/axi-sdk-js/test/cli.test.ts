import { execFile } from "node:child_process";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { installSessionStartHooks } = vi.hoisted(() => ({
  installSessionStartHooks: vi.fn(),
}));

const { runUpdate } = vi.hoisted(() => ({
  runUpdate: vi.fn(async () => ({ update: "mock update output" })),
}));

vi.mock("../src/hooks.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/hooks.js")>("../src/hooks.js");
  return {
    ...actual,
    installSessionStartHooks,
  };
});

vi.mock("../src/update.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/update.js")>(
      "../src/update.js",
    );
  return {
    ...actual,
    runUpdate,
  };
});

import { runAxiCli } from "../src/cli.js";
import { AxiError } from "../src/errors.js";
import { checkFlags } from "../src/flags.js";
import { renderError } from "../src/output.js";

const execFileAsync = promisify(execFile);

async function runErrorBoundaryFixture(
  phase: "initialize" | "initialize-async" | "resolveContext",
  errorKind: "axi" | "generic",
  view: "home" | "command",
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const fixturePath = fileURLToPath(
    new URL("./fixtures/error-boundary-bin.mjs", import.meta.url),
  );
  const viteNodePath = fileURLToPath(
    new URL("../node_modules/.bin/vite-node", import.meta.url),
  );

  try {
    const { stdout, stderr } = await execFileAsync(
      viteNodePath,
      [fixturePath, phase, errorKind, view],
      { cwd: new URL("..", import.meta.url) },
    );
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const result = error as Error & {
      code: number;
      stdout: string;
      stderr: string;
    };
    return {
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}

async function runStdoutErrorFixture(
  mode: "control" | "EPIPE" | "EACCES",
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const fixturePath = fileURLToPath(
    new URL("./fixtures/stdout-error-bin.mjs", import.meta.url),
  );
  const viteNodePath = fileURLToPath(
    new URL("../node_modules/.bin/vite-node", import.meta.url),
  );

  try {
    const { stdout, stderr } = await execFileAsync(
      viteNodePath,
      [fixturePath, mode],
      {
        cwd: new URL("..", import.meta.url),
      },
    );
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const result = error as Error & {
      code: number;
      stdout: string;
      stderr: string;
    };
    return {
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}

describe("runAxiCli", () => {
  const originalArgv = [...process.argv];
  const stdout = { write: vi.fn(() => true) };
  const initialize = vi.fn();
  const resolveContext = vi.fn();
  const home = vi.fn(async () => "home output");
  const issue = vi.fn(async () => "issue output");

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    process.argv = [...originalArgv];
  });

  afterEach(() => {
    process.exitCode = undefined;
    process.argv = [...originalArgv];
  });

  it("runs initializer before dispatch", async () => {
    process.argv = ["node", "tool"];

    await runAxiCli({
      description: "Manage GitHub state",
      topLevelHelp: "top help",
      initialize,
      home,
      commands: { issue },
      stdout,
    });

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(home).toHaveBeenCalledTimes(1);
  });

  it("installs one stdout error handler across repeated invocations", async () => {
    const sharedStdout = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

    for (let invocation = 0; invocation < 11; invocation += 1) {
      await runAxiCli({
        argv: ["--help"],
        description: "Manage GitHub state",
        topLevelHelp: "top help",
        home,
        commands: { issue },
        stdout: sharedStdout,
      });
    }

    expect(sharedStdout.listenerCount("error")).toBe(1);
  });

  it("shows top-level help for bare --help without resolving context", async () => {
    process.argv = ["node", "tool", "--help"];

    await runAxiCli({
      description: "Manage GitHub state",
      topLevelHelp: "top help",
      resolveContext,
      home,
      commands: { issue },
      stdout,
    });

    expect(stdout.write).toHaveBeenCalledWith("top help");
    expect(resolveContext).not.toHaveBeenCalled();
    expect(home).not.toHaveBeenCalled();
  });

  it("shows version for bare --version without resolving context", async () => {
    process.argv = ["node", "tool", "--version"];

    await runAxiCli({
      description: "Manage GitHub state",
      version: "1.2.3",
      topLevelHelp: "top help",
      resolveContext,
      home,
      commands: { issue },
      stdout,
    });

    expect(stdout.write).toHaveBeenCalledWith("1.2.3\n");
    expect(resolveContext).not.toHaveBeenCalled();
    expect(home).not.toHaveBeenCalled();
  });

  it.each(["-v", "-V"])(
    "shows version for bare %s without resolving context",
    async (flag) => {
      process.argv = ["node", "tool", flag];

      await runAxiCli({
        description: "Manage GitHub state",
        version: "1.2.3",
        topLevelHelp: "top help",
        resolveContext,
        home,
        commands: { issue },
        stdout,
      });

      expect(stdout.write).toHaveBeenCalledWith("1.2.3\n");
      expect(resolveContext).not.toHaveBeenCalled();
      expect(home).not.toHaveBeenCalled();
    },
  );

  it("uses explicit argv when provided instead of process.argv", async () => {
    process.argv = ["node", "tool", "--bogus-loader-flag", "--version"];

    await runAxiCli({
      description: "Manage GitHub state",
      version: "1.2.3",
      topLevelHelp: "top help",
      resolveContext,
      home,
      commands: { issue },
      stdout,
      argv: ["--version"],
    });

    expect(stdout.write).toHaveBeenCalledWith("1.2.3\n");
    expect(resolveContext).not.toHaveBeenCalled();
    expect(home).not.toHaveBeenCalled();
  });

  it("routes command help through getCommandHelp without resolving context", async () => {
    process.argv = ["node", "tool", "issue", "--help"];

    await runAxiCli({
      description: "Manage GitHub state",
      topLevelHelp: "top help",
      getCommandHelp: (command) =>
        command === "issue" ? "issue help" : undefined,
      resolveContext,
      home,
      commands: { issue },
      stdout,
    });

    expect(stdout.write).toHaveBeenCalledWith("issue help");
    expect(resolveContext).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
  });

  it("writes a structured error when flags appear before the command", async () => {
    process.argv = ["node", "gh-axi", "-R", "owner/name", "issue", "list"];

    await runAxiCli({
      description: "Manage GitHub state",
      topLevelHelp: "top help",
      resolveContext,
      home,
      commands: { issue },
      stdout,
    });

    expect(String(stdout.write.mock.calls[0]?.[0])).toContain(
      "Flags must come after the command",
    );
    expect(String(stdout.write.mock.calls[0]?.[0])).toContain("help[2]:");
    expect(process.exitCode).toBe(2);
    expect(resolveContext).not.toHaveBeenCalled();
  });

  it("writes structured unknown-command errors without resolving context", async () => {
    process.argv = ["node", "tool", "wat"];

    await runAxiCli({
      description: "Manage GitHub state",
      topLevelHelp: "top help",
      resolveContext,
      home,
      commands: { issue },
      stdout,
    });

    expect(String(stdout.write.mock.calls[0]?.[0])).toContain(
      "Unknown command: wat",
    );
    expect(process.exitCode).toBe(2);
    expect(resolveContext).not.toHaveBeenCalled();
  });

  it("routes to the matching command handler with lazy context resolution", async () => {
    process.argv = ["node", "tool", "issue", "list", "--repo", "owner/name"];
    resolveContext.mockReturnValue({ repo: "owner/name" });

    await runAxiCli({
      description: "Manage GitHub state",
      topLevelHelp: "top help",
      resolveContext,
      home,
      commands: { issue },
      stdout,
    });

    expect(resolveContext).toHaveBeenCalledWith({
      command: "issue",
      args: ["list", "--repo", "owner/name"],
    });
    expect(issue).toHaveBeenCalledWith(["list", "--repo", "owner/name"], {
      repo: "owner/name",
    });
    expect(stdout.write).toHaveBeenCalledWith("issue output\n");
  });

  it("serializes structured handler output at the boundary", async () => {
    process.argv = ["node", "tool", "issue", "list"];
    issue.mockResolvedValueOnce({
      issues: [{ number: 1, title: "Fix auth", state: "open" }],
      help: ["Run tool issue view 1 for details"],
    });

    await runAxiCli({
      description: "Manage GitHub state",
      topLevelHelp: "top help",
      home,
      commands: { issue },
      stdout,
    });

    expect(String(stdout.write.mock.calls[0]?.[0])).toContain("issues[1]");
    expect(String(stdout.write.mock.calls[0]?.[0])).toContain("Fix auth");
    expect(String(stdout.write.mock.calls[0]?.[0])).toContain("help[1]:");
  });

  it("adds bin and description to the home view automatically", async () => {
    process.argv = ["node", `${homedir()}/.local/bin/axi-tool`];
    home.mockResolvedValueOnce({ browser: "no active session" });

    await runAxiCli({
      description: "Manage browser state in the current workspace",
      topLevelHelp: "top help",
      home,
      commands: { issue },
      stdout,
    });

    expect(String(stdout.write.mock.calls[0]?.[0])).toContain(
      "bin: ~/.local/bin/axi-tool",
    );
    expect(String(stdout.write.mock.calls[0]?.[0])).toContain(
      "description: Manage browser state in the current workspace",
    );
    expect(String(stdout.write.mock.calls[0]?.[0])).toContain(
      "browser: no active session",
    );
  });

  it("resolves home context only when the home handler actually runs", async () => {
    process.argv = ["node", "tool"];
    resolveContext.mockReturnValue({ repo: "owner/name" });

    await runAxiCli({
      description: "Manage GitHub state",
      topLevelHelp: "top help",
      resolveContext,
      home,
      commands: { issue },
      stdout,
    });

    expect(resolveContext).toHaveBeenCalledWith({
      command: undefined,
      args: [],
    });
    expect(home).toHaveBeenCalledWith([], { repo: "owner/name" });
  });

  it("does not install hooks automatically from the executable path", async () => {
    process.argv = ["node", "/Users/me/src/gh-axi/dist/bin/gh-axi.js"];

    await runAxiCli({
      description: "Manage GitHub state",
      topLevelHelp: "top help",
      home,
      commands: { issue },
      stdout,
    });

    expect(installSessionStartHooks).not.toHaveBeenCalled();
  });

  it("does not auto-install hooks from test worker entrypoints", async () => {
    process.argv = [
      "node",
      "/Users/me/src/gh-axi/node_modules/tinypool/dist/entry/process.js",
    ];

    await runAxiCli({
      description: "Manage GitHub state",
      topLevelHelp: "top help",
      home,
      commands: { issue },
      stdout,
    });

    expect(installSessionStartHooks).not.toHaveBeenCalled();
  });

  it("handles the built-in update command via runUpdate", async () => {
    process.argv = ["node", "gh-axi", "update", "--check"];

    await runAxiCli({
      description: "Manage GitHub state",
      version: "1.2.3",
      packageName: "gh-axi",
      topLevelHelp: "top help",
      home,
      commands: { issue },
      stdout,
    });

    expect(runUpdate).toHaveBeenCalledTimes(1);
    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["--check"],
        version: "1.2.3",
        packageName: "gh-axi",
      }),
    );
    expect(String(stdout.write.mock.calls.at(-1)?.[0])).toContain(
      "mock update output",
    );
  });

  it("defers to a tool's own update command when registered", async () => {
    process.argv = ["node", "gh-axi", "update"];
    const update = vi.fn(async () => "tool update output");

    await runAxiCli({
      description: "Manage GitHub state",
      topLevelHelp: "top help",
      home,
      commands: { issue, update },
      stdout,
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(runUpdate).not.toHaveBeenCalled();
    expect(stdout.write).toHaveBeenCalledWith("tool update output\n");
  });

  it("shows built-in update help without running the upgrade", async () => {
    process.argv = ["node", "gh-axi", "update", "--help"];

    await runAxiCli({
      description: "Manage GitHub state",
      version: "1.2.3",
      topLevelHelp: "top help",
      home,
      commands: { issue },
      stdout,
    });

    expect(runUpdate).not.toHaveBeenCalled();
    expect(String(stdout.write.mock.calls[0]?.[0])).toContain(
      "command: update",
    );
  });

  it("advertises the built-in update command in bare --help", async () => {
    process.argv = ["node", "gh-axi", "--help"];

    await runAxiCli({
      description: "Manage GitHub state",
      topLevelHelp: "top help",
      home,
      commands: { issue },
      stdout,
    });

    expect(stdout.write).toHaveBeenCalledWith("top help");
    const combined = stdout.write.mock.calls.map((call) => call[0]).join("");
    expect(combined).toContain('top help\n"built-in":');
    expect(combined).not.toContain('top help"built-in":');
    expect(combined).toContain("update");
    expect(combined).toContain("update --check");
  });

  it("does not advertise the built-in update when a tool overrides it", async () => {
    process.argv = ["node", "gh-axi", "--help"];
    const update = vi.fn(async () => "tool update output");

    await runAxiCli({
      description: "Manage GitHub state",
      topLevelHelp: "top help",
      home,
      commands: { issue, update },
      stdout,
    });

    expect(stdout.write).toHaveBeenCalledTimes(1);
    expect(stdout.write).toHaveBeenCalledWith("top help");
  });

  it("maps validation errors to exit code 2", async () => {
    process.argv = ["node", "tool", "issue", "create"];
    issue.mockRejectedValueOnce(
      new AxiError("Missing title", "VALIDATION_ERROR", [
        'Run `tool issue create --title "..."`',
      ]),
    );

    await runAxiCli({
      description: "Manage GitHub state",
      topLevelHelp: "top help",
      home,
      commands: { issue },
      stdout,
    });

    expect(String(stdout.write.mock.calls[0]?.[0])).toContain("Missing title");
    expect(process.exitCode).toBe(2);
  });
});

describe("runAxiCli declared flags", () => {
  const originalArgv = [...process.argv];
  const stdout = { write: vi.fn(() => true) };
  const resolveContext = vi.fn();
  const run = vi.fn(async () => "search output");
  const bare = vi.fn(async () => "bare output");
  const home = vi.fn(async () => "home output");

  const search = {
    flags: {
      limit: { type: "string" as const },
      offset: { type: "string" as const },
      full: { type: "boolean" as const },
      recursive: { type: "boolean" as const, short: "r" },
      page: { type: "string" as const, default: "1" },
      transparency: { refuse: "Use --free or --busy" },
    },
    run,
  };

  function firstWrite(): string {
    return String(stdout.write.mock.calls[0]?.[0]);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resolveContext.mockReset();
    process.exitCode = undefined;
    process.argv = ["node", "tool"];
  });

  afterEach(() => {
    process.exitCode = undefined;
    process.argv = [...originalArgv];
  });

  async function runTool(argv: string[], extra: Record<string, unknown> = {}) {
    await runAxiCli({
      description: "Manage things",
      topLevelHelp: "top help",
      resolveContext,
      home,
      commands: { search, bare },
      stdout,
      argv,
      ...extra,
    });
  }

  it("passes argv to a bare function byte-identical, unchecked, with no parsed", async () => {
    const argv = [
      "bare",
      "--limit=5",
      "-r",
      "--bogus",
      "--offset=-5",
      "--",
      "-x",
    ];
    resolveContext.mockReturnValue({ ctx: true });

    await runTool(argv);

    expect(bare).toHaveBeenCalledTimes(1);
    expect(bare.mock.calls[0]).toEqual([argv.slice(1), { ctx: true }]);
    expect(bare.mock.calls[0]).toHaveLength(2);
    expect(resolveContext).toHaveBeenCalledWith({
      command: "bare",
      args: argv.slice(1),
    });
    expect(stdout.write).toHaveBeenCalledWith("bare output\n");
    expect(process.exitCode).toBeUndefined();
  });

  it("normalizes args for a declared command and passes parsed", async () => {
    resolveContext.mockReturnValue({ ctx: true });

    await runTool([
      "search",
      "q",
      "--limit=5",
      "-r",
      "--offset=-5",
      "--",
      "-x",
    ]);

    const normalized = [
      "q",
      "--limit",
      "5",
      "--recursive",
      "--offset",
      "-5",
      "--",
      "-x",
    ];
    const parsed = {
      values: { limit: "5", recursive: true, offset: "-5", page: "1" },
      positionals: ["q", "-x"],
    };
    expect(resolveContext).toHaveBeenCalledWith({
      command: "search",
      args: normalized,
      parsed,
    });
    expect(run).toHaveBeenCalledWith(normalized, { ctx: true }, parsed);
    expect(stdout.write).toHaveBeenCalledWith("search output\n");
  });

  it("rejects an unknown flag with exit 2 before resolving context", async () => {
    await runTool(["search", "q", "--bogus"]);

    expect(firstWrite()).toBe(
      `${renderError("Unknown flag --bogus for `search`", "VALIDATION_ERROR", [
        "Valid flags for `search`: --full, --limit, --offset, --page, --recursive (--help always allowed)",
        "Run `tool search --help` for usage",
      ])}\n`,
    );
    expect(process.exitCode).toBe(2);
    expect(resolveContext).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("leads with the refuse hint for a refused flag", async () => {
    await runTool(["search", "--transparency", "transparent"]);

    expect(firstWrite()).toBe(
      `${renderError(
        "Unknown flag --transparency for `search`",
        "VALIDATION_ERROR",
        [
          "Use --free or --busy",
          "Valid flags for `search`: --full, --limit, --offset, --page, --recursive (--help always allowed)",
          "Run `tool search --help` for usage",
        ],
      )}\n`,
    );
    expect(process.exitCode).toBe(2);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a value flag with no value", async () => {
    await runTool(["search", "--limit"]);

    expect(firstWrite()).toContain("Flag --limit for `search` needs a value");
    expect(process.exitCode).toBe(2);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a boolean flag given a value", async () => {
    await runTool(["search", "--full=yes"]);

    expect(firstWrite()).toContain(
      "Flag --full for `search` does not take a value",
    );
    expect(process.exitCode).toBe(2);
  });

  it("routes flag errors through formatError like any other error", async () => {
    await runTool(["search", "--bogus"], {
      formatError: (error: unknown) => ({
        output: `custom: ${(error as Error).message}\n`,
        exitCode: 7,
      }),
    });

    expect(firstWrite()).toBe("custom: Unknown flag --bogus for `search`\n");
    expect(process.exitCode).toBe(7);
  });

  it("still routes --help through getCommandHelp for a declared command", async () => {
    await runTool(["search", "--help"], {
      getCommandHelp: (command: string) =>
        command === "search" ? "search help" : undefined,
    });

    expect(stdout.write).toHaveBeenCalledWith("search help");
    expect(run).not.toHaveBeenCalled();
  });

  it("passes --help to the handler when no command help is registered", async () => {
    await runTool(["search", "--help"]);

    expect(run).toHaveBeenCalledWith(["--help"], undefined, {
      values: { help: true, page: "1" },
      positionals: [],
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("accepts globalFlags on declared commands and lets the command win on a clash", async () => {
    const globalFlags = {
      account: { type: "string" as const },
      limit: { type: "boolean" as const },
    };

    await runTool(["search", "--account", "me", "--limit", "5"], {
      globalFlags,
    });
    expect(run).toHaveBeenCalledWith(
      ["--account", "me", "--limit", "5"],
      undefined,
      {
        values: { account: "me", limit: "5", page: "1" },
        positionals: [],
      },
    );

    vi.clearAllMocks();
    await runTool(["search", "--bogus"], { globalFlags });
    expect(firstWrite()).toContain(
      "Valid flags for `search`: --account, --full, --limit, --offset, --page, --recursive (--help always allowed)",
    );

    vi.clearAllMocks();
    await runTool(["bare", "--account", "me", "--anything"], { globalFlags });
    expect(bare).toHaveBeenCalledWith(
      ["--account", "me", "--anything"],
      undefined,
    );
  });

  it("produces the same error through checkFlags as through runAxiCli", async () => {
    await runTool(["search", "--bogus"]);
    const viaCli = firstWrite();

    let viaHelper: AxiError | undefined;
    try {
      checkFlags(["--bogus"], search.flags, "search");
    } catch (error) {
      viaHelper = error as AxiError;
    }

    expect(viaHelper).toBeInstanceOf(AxiError);
    expect(
      `${renderError(viaHelper!.message, viaHelper!.code, viaHelper!.suggestions)}\n`,
    ).toBe(viaCli);
  });

  it("leaves home and the built-in update unaffected", async () => {
    await runTool([], {
      globalFlags: { account: { type: "string" as const } },
    });
    expect(home).toHaveBeenCalledWith([], undefined);

    vi.clearAllMocks();
    await runTool(["update", "--check"], {
      globalFlags: { account: { type: "string" as const } },
    });
    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["--check"] }),
    );
    expect(process.exitCode).toBeUndefined();
  });
});

describe("runAxiCli subprocess integration", () => {
  const failureCases = [
    {
      errorKind: "axi" as const,
      exitCode: 2,
      stdout:
        "error: Invalid fixture request\ncode: VALIDATION_ERROR\nhelp[1]: Run `fixture --help`\n",
    },
    {
      errorKind: "generic" as const,
      exitCode: 1,
      stdout: "error: Dependency exploded\ncode: UNKNOWN\n",
    },
  ];

  it.each(failureCases)(
    "formats $errorKind initialize failures on stdout",
    async ({ errorKind, exitCode, stdout }) => {
      const result = await runErrorBoundaryFixture(
        "initialize",
        errorKind,
        "home",
      );

      expect(result).toEqual({ exitCode, stdout, stderr: "" });
    },
  );

  it.each(failureCases)(
    "formats $errorKind asynchronous initialize rejections on stdout",
    async ({ errorKind, exitCode, stdout }) => {
      const result = await runErrorBoundaryFixture(
        "initialize-async",
        errorKind,
        "home",
      );

      expect(result).toEqual({ exitCode, stdout, stderr: "" });
    },
  );

  it.each(failureCases)(
    "formats $errorKind resolveContext failures for home on stdout",
    async ({ errorKind, exitCode, stdout }) => {
      const result = await runErrorBoundaryFixture(
        "resolveContext",
        errorKind,
        "home",
      );

      expect(result).toEqual({ exitCode, stdout, stderr: "" });
    },
  );

  it.each(failureCases)(
    "formats $errorKind resolveContext failures for commands on stdout",
    async ({ errorKind, exitCode, stdout }) => {
      const result = await runErrorBoundaryFixture(
        "resolveContext",
        errorKind,
        "command",
      );

      expect(result).toEqual({ exitCode, stdout, stderr: "" });
    },
  );

  it.each(["--version", "-v", "-V"])(
    "prints version from a real entrypoint for bare %s",
    async (flag) => {
      const fixturePath = fileURLToPath(
        new URL("./fixtures/version-bin.mjs", import.meta.url),
      );
      const viteNodePath = fileURLToPath(
        new URL("../node_modules/.bin/vite-node", import.meta.url),
      );
      const { stdout, stderr } = await execFileAsync(
        viteNodePath,
        [fixturePath, flag],
        {
          cwd: new URL("..", import.meta.url),
        },
      );

      expect(stdout).toBe("9.9.9\n");
      expect(stderr).toBe("");
    },
  );

  it("treats stdout EPIPE as a normal end", async () => {
    await expect(runStdoutErrorFixture("EPIPE")).resolves.toEqual({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
  });

  it("preserves normal stdout writes", async () => {
    const result = await runStdoutErrorFixture("control");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("fixture help");
    expect(result.stderr).toBe("");
  });

  it("does not swallow non-EPIPE stdout errors", async () => {
    const result = await runStdoutErrorFixture("EACCES");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Error: write EACCES");
    expect(result.stderr).toContain("code: 'EACCES'");
  });
});
