import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeCodexConfigUpdate,
  computeSessionStartHookRemoval,
  computeSessionStartHookUpdate,
  extractNpmShimScriptPath,
  installSessionStartHooks,
  resolvePortableHookCommand,
  sessionStartHookStatus,
  shouldInstallHooksForNodeAxiExecPath,
  uninstallSessionStartHooks,
} from "../src/hooks.js";

describe("computeSessionStartHookUpdate", () => {
  it("installs a managed hook when no hooks exist", () => {
    const [updated, changed] = computeSessionStartHookUpdate(
      {},
      {
        marker: "gh-axi",
        command: "/usr/local/bin/gh-axi",
      },
    );

    expect(changed).toBe(true);
    expect(updated.hooks?.SessionStart).toEqual([
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: "/usr/local/bin/gh-axi",
            timeout: 10,
          },
        ],
      },
    ]);
  });

  it("preserves unrelated hook groups while adding a managed hook", () => {
    const [updated, changed] = computeSessionStartHookUpdate(
      {
        hooks: {
          SessionStart: [
            {
              matcher: "",
              hooks: [{ type: "command", command: "/usr/local/bin/other" }],
            },
          ],
        },
      },
      {
        marker: "gh-axi",
        command: "/usr/local/bin/gh-axi",
      },
    );

    expect(changed).toBe(true);
    expect(updated.hooks?.SessionStart).toHaveLength(2);
    expect(updated.hooks?.SessionStart?.[0]?.hooks?.[0]?.command).toBe(
      "/usr/local/bin/other",
    );
    expect(updated.hooks?.SessionStart?.[1]?.hooks?.[0]?.command).toBe(
      "/usr/local/bin/gh-axi",
    );
  });

  it("repairs a stale managed hook path in place", () => {
    const [updated, changed] = computeSessionStartHookUpdate(
      {
        hooks: {
          SessionStart: [
            {
              matcher: "",
              hooks: [
                {
                  type: "command",
                  command: "/old/path/gh-axi",
                  timeout: 10,
                },
              ],
            },
          ],
        },
      },
      {
        marker: "gh-axi",
        command: "/new/path/gh-axi",
        timeoutSeconds: 15,
      },
    );

    expect(changed).toBe(true);
    expect(updated.hooks?.SessionStart?.[0]?.hooks?.[0]).toEqual({
      type: "command",
      command: "/new/path/gh-axi",
      timeout: 15,
    });
  });

  it("removes managed legacy codex hooks when migrating to SessionStart", () => {
    const [updated, changed] = computeSessionStartHookUpdate(
      {
        hooks: {
          session_start: [
            { type: "command", command: "/old/path/gh-axi" },
            { type: "command", command: "/usr/local/bin/other" },
          ],
        },
      },
      {
        marker: "gh-axi",
        command: "/new/path/gh-axi",
      },
    );

    expect(changed).toBe(true);
    expect(updated.hooks?.session_start).toEqual([
      { type: "command", command: "/usr/local/bin/other" },
    ]);
    expect(updated.hooks?.SessionStart?.[0]?.hooks?.[0]?.command).toBe(
      "/new/path/gh-axi",
    );
  });

  it("is a no-op when the managed hook is already correct", () => {
    const settings = {
      hooks: {
        SessionStart: [
          {
            matcher: "",
            hooks: [
              {
                type: "command" as const,
                command: "/usr/local/bin/gh-axi",
                timeout: 10,
              },
            ],
          },
        ],
      },
    };

    const [updated, changed] = computeSessionStartHookUpdate(settings, {
      marker: "gh-axi",
      command: "/usr/local/bin/gh-axi",
    });

    expect(changed).toBe(false);
    expect(updated).toBe(settings);
  });
});

describe("computeSessionStartHookRemoval", () => {
  it("is a no-op when there are no hooks at all", () => {
    const settings = {};
    const [updated, changed] = computeSessionStartHookRemoval(
      settings,
      "gh-axi",
    );

    expect(changed).toBe(false);
    expect(updated).toBe(settings);
  });

  it("is a no-op when the marker is not present", () => {
    const settings = {
      hooks: {
        SessionStart: [
          {
            matcher: "",
            hooks: [{ type: "command", command: "/usr/local/bin/other" }],
          },
        ],
      },
    };

    const [updated, changed] = computeSessionStartHookRemoval(
      settings,
      "gh-axi",
    );

    expect(changed).toBe(false);
    expect(updated).toBe(settings);
  });

  it("removes a managed hook while preserving unrelated groups", () => {
    const [updated, changed] = computeSessionStartHookRemoval(
      {
        hooks: {
          SessionStart: [
            {
              matcher: "",
              hooks: [{ type: "command", command: "/usr/local/bin/other" }],
            },
            {
              matcher: "",
              hooks: [{ type: "command", command: "/usr/local/bin/gh-axi" }],
            },
          ],
        },
      },
      "gh-axi",
    );

    expect(changed).toBe(true);
    expect(updated.hooks?.SessionStart).toEqual([
      {
        matcher: "",
        hooks: [{ type: "command", command: "/usr/local/bin/other" }],
      },
    ]);
  });

  it("drops the hooks key entirely once the last managed entry is removed", () => {
    const [updated, changed] = computeSessionStartHookRemoval(
      {
        hooks: {
          SessionStart: [
            {
              matcher: "",
              hooks: [{ type: "command", command: "/usr/local/bin/gh-axi" }],
            },
          ],
        },
      },
      "gh-axi",
    );

    expect(changed).toBe(true);
    expect(updated.hooks).toBeUndefined();
  });

  it("removes managed legacy codex session_start entries", () => {
    const [updated, changed] = computeSessionStartHookRemoval(
      {
        hooks: {
          session_start: [
            { type: "command", command: "/old/path/gh-axi" },
            { type: "command", command: "/usr/local/bin/other" },
          ],
        },
      },
      "gh-axi",
    );

    expect(changed).toBe(true);
    expect(updated.hooks?.session_start).toEqual([
      { type: "command", command: "/usr/local/bin/other" },
    ]);
  });

  it("leaves SessionStart untouched when only a legacy entry is removed", () => {
    const [updated, changed] = computeSessionStartHookRemoval(
      {
        hooks: {
          session_start: [{ type: "command", command: "/old/path/gh-axi" }],
          SessionStart: [],
        },
      },
      "gh-axi",
    );

    expect(changed).toBe(true);
    expect(updated.hooks?.session_start).toBeUndefined();
    expect(updated.hooks?.SessionStart).toEqual([]);
  });
});

describe("computeCodexConfigUpdate", () => {
  it("creates a features section for empty config", () => {
    expect(computeCodexConfigUpdate("")).toEqual([
      "[features]\nhooks = true\n",
      true,
    ]);
  });

  it("adds hooks inside an existing features section", () => {
    const [updated, changed] = computeCodexConfigUpdate(
      "[features]\nother = true\n",
    );

    expect(changed).toBe(true);
    expect(updated).toBe("[features]\nother = true\nhooks = true\n");
  });

  it("repairs hooks when it is disabled", () => {
    const [updated, changed] = computeCodexConfigUpdate(
      "[features]\nhooks = false\n",
    );

    expect(changed).toBe(true);
    expect(updated).toBe("[features]\nhooks = true\n");
  });

  it("is a no-op when hooks is already enabled", () => {
    const original = "[features]\nhooks = true\n";
    expect(computeCodexConfigUpdate(original)).toEqual([original, false]);
  });

  it("does not treat legacy codex_hooks as sufficient", () => {
    const [updated, changed] = computeCodexConfigUpdate(
      "[features]\ncodex_hooks = true\n",
    );

    expect(changed).toBe(true);
    expect(updated).toBe("[features]\ncodex_hooks = true\nhooks = true\n");
  });
});

describe("resolvePortableHookCommand", () => {
  const makeContext = (mapping: Record<string, string>) => ({
    pathEntries: ["/usr/local/bin", "/opt/homebrew/bin"],
    pathExtensions: [""],
    resolveRealPath: (p: string) => mapping[p],
  });

  it("returns the plain binary name when PATH resolves to the same file", () => {
    const exec = "/opt/homebrew/lib/node_modules/gh-axi/dist/bin/gh-axi.js";
    const context = makeContext({
      [exec]: exec,
      "/opt/homebrew/bin/gh-axi": exec,
    });

    expect(
      resolvePortableHookCommand(exec, ["gh-axi"], "gh-axi", context),
    ).toBe("gh-axi");
  });

  it("returns the absolute exec path when the binary is not on PATH", () => {
    const exec = "/opt/homebrew/lib/node_modules/gh-axi/dist/bin/gh-axi.js";
    const context = makeContext({ [exec]: exec });

    expect(
      resolvePortableHookCommand(exec, ["gh-axi"], "gh-axi", context),
    ).toBe(exec);
  });

  it("returns the absolute exec path when PATH resolves to a different file", () => {
    const exec = "/Users/me/src/gh-axi/dist/bin/gh-axi.js";
    const context = makeContext({
      [exec]: exec,
      "/usr/local/bin/gh-axi": "/other/install/gh-axi.js",
    });

    expect(
      resolvePortableHookCommand(exec, ["gh-axi"], "gh-axi", context),
    ).toBe(exec);
  });

  it("skips a binary name that doesn't contain the marker", () => {
    const exec = "/real/my-binary.js";
    const context = makeContext({
      [exec]: exec,
      "/usr/local/bin/my-binary": exec,
    });

    expect(
      resolvePortableHookCommand(exec, ["my-binary"], "custom-marker", context),
    ).toBe(exec);
  });

  it("tries multiple binary names and returns the first match", () => {
    const exec = "/real/gh-axi.js";
    const context = makeContext({
      [exec]: exec,
      "/usr/local/bin/gh-axi": exec,
    });

    expect(
      resolvePortableHookCommand(
        exec,
        ["nonexistent", "gh-axi"],
        "gh-axi",
        context,
      ),
    ).toBe("gh-axi");
  });

  it("tries multiple path extensions", () => {
    const exec = "/real/gh-axi.js";
    const context = {
      pathEntries: ["/usr/local/bin"],
      pathExtensions: ["", ".EXE", ".CMD"],
      resolveRealPath: (p: string) =>
        ({
          [exec]: exec,
          "/usr/local/bin/gh-axi.CMD": exec,
        })[p],
    };

    expect(
      resolvePortableHookCommand(exec, ["gh-axi"], "gh-axi", context),
    ).toBe("gh-axi");
  });

  it("returns exec path if execPath cannot be resolved", () => {
    const context = makeContext({});
    expect(
      resolvePortableHookCommand(
        "/missing/gh-axi.js",
        ["gh-axi"],
        "gh-axi",
        context,
      ),
    ).toBe("/missing/gh-axi.js");
  });

  it("returns exec path when no binary names are provided", () => {
    const exec = "/real/gh-axi.js";
    const context = makeContext({ [exec]: exec });
    expect(resolvePortableHookCommand(exec, [], "gh-axi", context)).toBe(exec);
  });

  it("returns the plain binary name when a shim wrapper targets the exec file", () => {
    const exec = "/npm/node_modules/gh-axi/dist/bin/gh-axi.js";
    const shim = join("/npm", "gh-axi");
    const context = {
      pathEntries: ["/npm"],
      pathExtensions: ["", ".CMD"],
      // npm shims are wrappers, so realpath equals the shim itself, never exec.
      resolveRealPath: (p: string) => ({ [exec]: exec, [shim]: shim })[p],
      resolveShimTarget: (p: string) => (p === shim ? exec : undefined),
    };

    expect(
      resolvePortableHookCommand(exec, ["gh-axi"], "gh-axi", context),
    ).toBe("gh-axi");
  });

  it("ignores a shim wrapper that targets a different install", () => {
    const exec = "/src/gh-axi/dist/bin/gh-axi.js";
    const shim = join("/npm", "gh-axi");
    const context = {
      pathEntries: ["/npm"],
      pathExtensions: ["", ".CMD"],
      resolveRealPath: (p: string) => ({ [exec]: exec, [shim]: shim })[p],
      resolveShimTarget: (p: string) =>
        p === shim ? "/other/gh-axi.js" : undefined,
    };

    expect(
      resolvePortableHookCommand(exec, ["gh-axi"], "gh-axi", context),
    ).toBe(exec);
  });
});

describe("extractNpmShimScriptPath", () => {
  it("reads the script reference from a Git Bash shim", () => {
    const shim = [
      "#!/bin/sh",
      'basedir=$(dirname "$(echo "$0" | sed -e \'s,\\\\,/,g\')")',
      'if [ -x "$basedir/node" ]; then',
      '  exec "$basedir/node"  "$basedir/node_modules/gh-axi/dist/bin/gh-axi.js" "$@"',
      "else",
      '  exec node  "$basedir/node_modules/gh-axi/dist/bin/gh-axi.js" "$@"',
      "fi",
    ].join("\n");

    expect(extractNpmShimScriptPath(shim)).toBe(
      "node_modules/gh-axi/dist/bin/gh-axi.js",
    );
  });

  it("reads the script reference from a Windows .cmd shim", () => {
    const shim = [
      "@ECHO off",
      "SETLOCAL",
      "SET dp0=%~dp0",
      '"%_prog%"  "%dp0%\\node_modules\\gh-axi\\dist\\bin\\gh-axi.js" %*',
    ].join("\r\n");

    expect(extractNpmShimScriptPath(shim)).toBe(
      "node_modules\\gh-axi\\dist\\bin\\gh-axi.js",
    );
  });

  it("returns undefined when no script reference is present", () => {
    expect(extractNpmShimScriptPath("#!/bin/sh\nexec node --version\n")).toBe(
      undefined,
    );
  });
});

describe("shouldInstallHooksForNodeAxiExecPath", () => {
  it("rejects development TypeScript entrypoints", () => {
    expect(
      shouldInstallHooksForNodeAxiExecPath(
        "/Users/me/src/gh-axi/bin/gh-axi.ts",
        {
          marker: "gh-axi",
          binaryNames: ["gh-axi"],
          distEntrypoints: ["dist/bin/gh-axi.js"],
        },
      ),
    ).toBe(false);
  });

  it("accepts packaged dist entrypoints", () => {
    expect(
      shouldInstallHooksForNodeAxiExecPath(
        "/Users/me/src/gh-axi/dist/bin/gh-axi.js",
        {
          marker: "gh-axi",
          binaryNames: ["gh-axi"],
          distEntrypoints: ["dist/bin/gh-axi.js"],
        },
      ),
    ).toBe(true);
  });
});

describe("installSessionStartHooks (portable command)", () => {
  let tmp: string;
  let originalPath: string | undefined;
  let originalArgv: string[];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "axi-sdk-js-hooks-"));
    originalPath = process.env.PATH;
    originalArgv = [...process.argv];
  });

  afterEach(() => {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    process.argv = originalArgv;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("infers current CLI hook options when no identity options are provided", () => {
    const home = join(tmp, "home");
    const pkgBin = join(tmp, "pkg", "dist", "bin");
    mkdirSync(home, { recursive: true });
    mkdirSync(pkgBin, { recursive: true });

    const execFile = join(pkgBin, "gh-axi.js");
    writeFileSync(execFile, "// stub\n", "utf-8");
    process.argv = ["node", execFile];

    installSessionStartHooks({ homeDir: home });

    const settings = JSON.parse(
      readFileSync(join(home, ".claude", "settings.json"), "utf-8"),
    );
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe(execFile);
    expect(settings.hooks.SessionStart[0].hooks[0].timeout).toBe(10);
  });

  it("skips inferred current CLI hooks for development TypeScript entrypoints", () => {
    const home = join(tmp, "home");
    const execFile = join(tmp, "gh-axi", "bin", "gh-axi.ts");
    mkdirSync(join(tmp, "gh-axi", "bin"), { recursive: true });
    writeFileSync(execFile, "// stub\n", "utf-8");
    process.argv = ["node", execFile];

    installSessionStartHooks({ homeDir: home });

    expect(existsSync(join(home, ".claude", "settings.json"))).toBe(false);
  });

  it("skips explicit marker hooks for development TypeScript entrypoints", () => {
    const home = join(tmp, "home");
    const execFile = join(tmp, "gh-axi", "bin", "gh-axi.ts");
    mkdirSync(join(tmp, "gh-axi", "bin"), { recursive: true });
    writeFileSync(execFile, "// stub\n", "utf-8");

    installSessionStartHooks({
      marker: "gh-axi",
      execPath: execFile,
      homeDir: home,
    });

    expect(existsSync(join(home, ".claude", "settings.json"))).toBe(false);
  });

  it("writes the plain binary name when a PATH symlink points at the exec file", () => {
    const home = join(tmp, "home");
    const pkgBin = join(tmp, "pkg", "dist", "bin");
    const pathDir = join(tmp, "path-bin");
    mkdirSync(home, { recursive: true });
    mkdirSync(pkgBin, { recursive: true });
    mkdirSync(pathDir, { recursive: true });

    const execFile = join(pkgBin, "gh-axi.js");
    writeFileSync(execFile, "// stub\n", "utf-8");
    symlinkSync(execFile, join(pathDir, "gh-axi"));

    process.env.PATH = pathDir;

    installSessionStartHooks({
      marker: "gh-axi",
      execPath: execFile,
      binaryNames: ["gh-axi"],
      homeDir: home,
    });

    const settings = JSON.parse(
      readFileSync(join(home, ".claude", "settings.json"), "utf-8"),
    );
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe("gh-axi");
  });

  it("writes the plain binary name when a PATH npm wrapper shim targets the exec file", () => {
    const home = join(tmp, "home");
    const pathDir = join(tmp, "path-bin");
    const pkgBin = join(pathDir, "node_modules", "gh-axi", "dist", "bin");
    mkdirSync(home, { recursive: true });
    mkdirSync(pkgBin, { recursive: true });

    const execFile = join(pkgBin, "gh-axi.js");
    writeFileSync(execFile, "// stub\n", "utf-8");

    // npm installs an extensionless wrapper shim on PATH (not a symlink); Git
    // Bash runs it and it execs the .js relative to its own directory.
    writeFileSync(
      join(pathDir, "gh-axi"),
      [
        "#!/bin/sh",
        'basedir=$(dirname "$0")',
        '  exec node  "$basedir/node_modules/gh-axi/dist/bin/gh-axi.js" "$@"',
      ].join("\n"),
      "utf-8",
    );

    process.env.PATH = pathDir;

    installSessionStartHooks({
      marker: "gh-axi",
      execPath: execFile,
      binaryNames: ["gh-axi"],
      homeDir: home,
    });

    const settings = JSON.parse(
      readFileSync(join(home, ".claude", "settings.json"), "utf-8"),
    );
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe("gh-axi");
  });

  it("keeps the absolute exec path when the binary is not on PATH", () => {
    const home = join(tmp, "home");
    const pkgBin = join(tmp, "pkg", "dist", "bin");
    const pathDir = join(tmp, "path-bin");
    mkdirSync(home, { recursive: true });
    mkdirSync(pkgBin, { recursive: true });
    mkdirSync(pathDir, { recursive: true });

    const execFile = join(pkgBin, "gh-axi.js");
    writeFileSync(execFile, "// stub\n", "utf-8");

    process.env.PATH = pathDir;

    installSessionStartHooks({
      marker: "gh-axi",
      execPath: execFile,
      binaryNames: ["gh-axi"],
      homeDir: home,
    });

    const settings = JSON.parse(
      readFileSync(join(home, ".claude", "settings.json"), "utf-8"),
    );
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe(execFile);
  });

  it("keeps the absolute exec path when PATH resolves to a different binary", () => {
    const home = join(tmp, "home");
    const pkgBin = join(tmp, "pkg", "dist", "bin");
    const otherBin = join(tmp, "other", "dist", "bin");
    const pathDir = join(tmp, "path-bin");
    mkdirSync(home, { recursive: true });
    mkdirSync(pkgBin, { recursive: true });
    mkdirSync(otherBin, { recursive: true });
    mkdirSync(pathDir, { recursive: true });

    const execFile = join(pkgBin, "gh-axi.js");
    const otherFile = join(otherBin, "gh-axi.js");
    writeFileSync(execFile, "// stub\n", "utf-8");
    writeFileSync(otherFile, "// other\n", "utf-8");
    symlinkSync(otherFile, join(pathDir, "gh-axi"));

    process.env.PATH = pathDir;

    installSessionStartHooks({
      marker: "gh-axi",
      execPath: execFile,
      binaryNames: ["gh-axi"],
      homeDir: home,
    });

    const settings = JSON.parse(
      readFileSync(join(home, ".claude", "settings.json"), "utf-8"),
    );
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe(execFile);
  });
});

describe("installSessionStartHooks (OpenCode plugin)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "axi-sdk-js-opencode-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function pluginPath(home: string, marker = "gh-axi") {
    return join(home, ".config", "opencode", "plugins", `axi-${marker}.js`);
  }

  it("writes a managed OpenCode plugin that injects AXI home context", () => {
    const home = join(tmp, "home");
    const execFile = join(tmp, "pkg", "dist", "bin", "gh-axi.js");
    mkdirSync(join(tmp, "pkg", "dist", "bin"), { recursive: true });
    writeFileSync(execFile, "// stub\n", "utf-8");

    installSessionStartHooks({
      marker: "gh-axi",
      execPath: execFile,
      binaryNames: ["gh-axi"],
      homeDir: home,
    });

    const plugin = readFileSync(pluginPath(home), "utf-8");
    expect(plugin).toContain("axi-sdk-js managed opencode plugin: gh-axi");
    expect(plugin).toContain("experimental.chat.system.transform");
    expect(plugin).toContain("## AXI ambient context: gh-axi");
    expect(plugin).toContain('ambientHeader + "\\n" + homeView');
    expect(plugin).toContain(JSON.stringify(execFile));
    expect(plugin).toContain("spawn(command, [],");
    expect(plugin).toContain("cwd: directory");
    expect(plugin).not.toContain("tool:");
  });

  it("runs the generated OpenCode plugin and appends ambient context", async () => {
    const home = join(tmp, "home");
    const workspace = join(tmp, "workspace");
    const execFile = join(tmp, "pkg", "dist", "bin", "gh-axi.js");
    mkdirSync(join(tmp, "pkg", "dist", "bin"), { recursive: true });
    mkdirSync(workspace, { recursive: true });
    writeFileSync(
      execFile,
      '#!/usr/bin/env node\nconsole.log("home cwd:" + process.cwd())\n',
      "utf-8",
    );
    chmodSync(execFile, 0o755);

    installSessionStartHooks({
      marker: "gh-axi",
      execPath: execFile,
      binaryNames: ["gh-axi"],
      homeDir: home,
    });

    const pluginModule = await import(pathToFileURL(pluginPath(home)).href);
    const plugin = await pluginModule.AxiGhAxiAmbientContextPlugin({
      directory: workspace,
    });
    const output = { system: [] as string[] };

    await plugin["experimental.chat.system.transform"](
      { sessionID: "session-1" },
      output,
    );

    expect(output.system).toEqual([
      `## AXI ambient context: gh-axi\nhome cwd:${realpathSync(workspace)}`,
    ]);
  });

  it("repairs the managed OpenCode plugin when the executable path changes", () => {
    const home = join(tmp, "home");
    const oldExec = join(tmp, "old", "dist", "bin", "gh-axi.js");
    const newExec = join(tmp, "new", "dist", "bin", "gh-axi.js");
    mkdirSync(join(tmp, "old", "dist", "bin"), { recursive: true });
    mkdirSync(join(tmp, "new", "dist", "bin"), { recursive: true });
    writeFileSync(oldExec, "// old\n", "utf-8");
    writeFileSync(newExec, "// new\n", "utf-8");

    installSessionStartHooks({
      marker: "gh-axi",
      execPath: oldExec,
      binaryNames: ["gh-axi"],
      homeDir: home,
    });
    installSessionStartHooks({
      marker: "gh-axi",
      execPath: newExec,
      binaryNames: ["gh-axi"],
      homeDir: home,
    });

    const plugin = readFileSync(pluginPath(home), "utf-8");
    expect(plugin).toContain(JSON.stringify(newExec));
    expect(plugin).not.toContain(JSON.stringify(oldExec));
  });

  it("does not overwrite an unmarked OpenCode plugin file", () => {
    const home = join(tmp, "home");
    const target = pluginPath(home);
    mkdirSync(join(home, ".config", "opencode", "plugins"), {
      recursive: true,
    });
    writeFileSync(
      target,
      "export const UserPlugin = async () => ({})\n",
      "utf-8",
    );
    const errors: string[] = [];

    installSessionStartHooks({
      marker: "gh-axi",
      execPath: join(tmp, "pkg", "dist", "bin", "gh-axi.js"),
      binaryNames: ["gh-axi"],
      homeDir: home,
      onError: (message) => errors.push(message),
    });

    expect(readFileSync(target, "utf-8")).toBe(
      "export const UserPlugin = async () => ({})\n",
    );
    expect(errors[0]).toContain(
      "refusing to overwrite unmanaged OpenCode plugin",
    );
  });

  it("skips the OpenCode plugin when hook installation policy rejects the executable", () => {
    const home = join(tmp, "home");

    installSessionStartHooks({
      marker: "gh-axi",
      execPath: join(tmp, "gh-axi", "bin", "gh-axi.ts"),
      homeDir: home,
      shouldInstall: () => false,
    });

    expect(existsSync(pluginPath(home))).toBe(false);
  });
});

describe("session hook scope (user vs project)", () => {
  let tmp: string;
  let home: string;
  let projectDir: string;
  let execFile: string;

  function claudeSettingsPath(root: string) {
    return join(root, ".claude", "settings.json");
  }

  function codexHooksPath(root: string) {
    return join(root, ".codex", "hooks.json");
  }

  function openCodePluginPath(root: string, isProjectScope: boolean) {
    return isProjectScope
      ? join(root, ".opencode", "plugins", "axi-gh-axi.js")
      : join(root, ".config", "opencode", "plugins", "axi-gh-axi.js");
  }

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "axi-sdk-js-hook-scope-"));
    home = join(tmp, "home");
    projectDir = join(tmp, "project");
    mkdirSync(home, { recursive: true });
    mkdirSync(projectDir, { recursive: true });

    const pkgBin = join(tmp, "pkg", "dist", "bin");
    mkdirSync(pkgBin, { recursive: true });
    execFile = join(pkgBin, "gh-axi.js");
    writeFileSync(execFile, "// stub\n", "utf-8");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("defaults to user scope: omitting `scope` only touches home paths, even when projectDir is passed", () => {
    installSessionStartHooks({
      marker: "gh-axi",
      execPath: execFile,
      homeDir: home,
      projectDir,
    });

    expect(existsSync(claudeSettingsPath(home))).toBe(true);
    expect(existsSync(codexHooksPath(home))).toBe(true);
    expect(existsSync(openCodePluginPath(home, false))).toBe(true);

    expect(existsSync(claudeSettingsPath(projectDir))).toBe(false);
    expect(existsSync(codexHooksPath(projectDir))).toBe(false);
    expect(existsSync(openCodePluginPath(projectDir, true))).toBe(false);

    const status = sessionStartHookStatus({ marker: "gh-axi", homeDir: home });
    expect(status.scope).toBe("user");
    expect(status.claude.installed).toBe(true);
    expect(status.codex.installed).toBe(true);
    expect(status.opencode.installed).toBe(true);
  });

  it("installs project-scoped Claude/Codex hooks and an OpenCode plugin under projectDir, while the Codex feature flag stays at user scope", () => {
    installSessionStartHooks({
      marker: "gh-axi",
      execPath: execFile,
      homeDir: home,
      scope: "project",
      projectDir,
    });

    const claudeSettings = JSON.parse(
      readFileSync(claudeSettingsPath(projectDir), "utf-8"),
    );
    expect(claudeSettings.hooks.SessionStart[0].hooks[0].command).toBe(
      execFile,
    );

    const codexHooks = JSON.parse(
      readFileSync(codexHooksPath(projectDir), "utf-8"),
    );
    expect(codexHooks.hooks.SessionStart[0].hooks[0].command).toBe(execFile);

    expect(existsSync(openCodePluginPath(projectDir, true))).toBe(true);

    // Never writes the user-scope hook files or plugin.
    expect(existsSync(claudeSettingsPath(home))).toBe(false);
    expect(existsSync(codexHooksPath(home))).toBe(false);
    expect(existsSync(openCodePluginPath(home, false))).toBe(false);

    // Repo-level Codex hooks still require the USER-level feature flag.
    const codexConfig = readFileSync(
      join(home, ".codex", "config.toml"),
      "utf-8",
    );
    expect(codexConfig).toContain("hooks = true");
  });

  it("reports scope-accurate status, including the shared Codex user-level flag", () => {
    installSessionStartHooks({
      marker: "gh-axi",
      execPath: execFile,
      homeDir: home,
      scope: "project",
      projectDir,
    });

    const projectStatus = sessionStartHookStatus({
      marker: "gh-axi",
      homeDir: home,
      scope: "project",
      projectDir,
    });
    expect(projectStatus.scope).toBe("project");
    expect(projectStatus.claude).toEqual({
      installed: true,
      path: claudeSettingsPath(projectDir),
    });
    expect(projectStatus.codex.installed).toBe(true);
    expect(projectStatus.codex.path).toBe(codexHooksPath(projectDir));
    expect(projectStatus.codex.userFeatureEnabled).toBe(true);
    expect(projectStatus.codex.userFeaturePath).toBe(
      join(home, ".codex", "config.toml"),
    );
    expect(projectStatus.opencode).toEqual({
      installed: true,
      path: openCodePluginPath(projectDir, true),
    });

    const userStatus = sessionStartHookStatus({
      marker: "gh-axi",
      homeDir: home,
    });
    expect(userStatus.scope).toBe("user");
    expect(userStatus.claude.installed).toBe(false);
    expect(userStatus.codex.installed).toBe(false);
    expect(userStatus.opencode.installed).toBe(false);
    // The feature flag is user-level and shared, so it reads enabled from
    // either scope once the project-scoped install has ensured it.
    expect(userStatus.codex.userFeatureEnabled).toBe(true);
  });

  it("uninstall removes only marker-matched entries at the requested scope", () => {
    installSessionStartHooks({
      marker: "gh-axi",
      execPath: execFile,
      homeDir: home,
      scope: "user",
    });
    installSessionStartHooks({
      marker: "gh-axi",
      execPath: execFile,
      homeDir: home,
      scope: "project",
      projectDir,
    });

    uninstallSessionStartHooks({
      marker: "gh-axi",
      homeDir: home,
      scope: "project",
      projectDir,
    });

    const projectSettings = JSON.parse(
      readFileSync(claudeSettingsPath(projectDir), "utf-8"),
    );
    expect(projectSettings.hooks).toBeUndefined();
    expect(existsSync(openCodePluginPath(projectDir, true))).toBe(false);

    // The user-scope install is untouched.
    const userSettings = JSON.parse(
      readFileSync(claudeSettingsPath(home), "utf-8"),
    );
    expect(userSettings.hooks.SessionStart[0].hooks[0].command).toBe(execFile);
    expect(existsSync(openCodePluginPath(home, false))).toBe(true);

    // Uninstall never touches the shared user-level Codex feature flag.
    const codexConfig = readFileSync(
      join(home, ".codex", "config.toml"),
      "utf-8",
    );
    expect(codexConfig).toContain("hooks = true");

    const projectStatus = sessionStartHookStatus({
      marker: "gh-axi",
      homeDir: home,
      scope: "project",
      projectDir,
    });
    expect(projectStatus.claude.installed).toBe(false);
    expect(projectStatus.codex.installed).toBe(false);
    expect(projectStatus.opencode.installed).toBe(false);
  });

  it("uninstall does not remove an unmanaged project-scope OpenCode plugin", () => {
    const target = openCodePluginPath(projectDir, true);
    mkdirSync(join(projectDir, ".opencode", "plugins"), { recursive: true });
    writeFileSync(
      target,
      "export const UserPlugin = async () => ({})\n",
      "utf-8",
    );
    const errors: string[] = [];

    uninstallSessionStartHooks({
      marker: "gh-axi",
      homeDir: home,
      scope: "project",
      projectDir,
      onError: (message) => errors.push(message),
    });

    expect(readFileSync(target, "utf-8")).toBe(
      "export const UserPlugin = async () => ({})\n",
    );
    expect(errors[0]).toContain("refusing to remove unmanaged OpenCode plugin");
  });

  it("throws from sessionStartHookStatus when the hook marker cannot be inferred", () => {
    expect(() =>
      sessionStartHookStatus({
        execPath: join(tmp, "random", "script.mjs"),
        homeDir: home,
      }),
    ).toThrow(/unable to infer/);
  });

  it("is a no-op from uninstallSessionStartHooks when the hook marker cannot be inferred", () => {
    expect(() =>
      uninstallSessionStartHooks({
        execPath: join(tmp, "random", "script.mjs"),
        homeDir: home,
      }),
    ).not.toThrow();
    expect(existsSync(claudeSettingsPath(home))).toBe(false);
  });
});
