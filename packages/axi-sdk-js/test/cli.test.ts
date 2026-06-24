import { execFile } from "node:child_process";
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

const execFileAsync = promisify(execFile);

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

describe("runAxiCli subprocess integration", () => {
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
});
