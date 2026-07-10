import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeClaudeCapabilityHookUpdate,
  computeCapabilitySessionStartHookUpdate,
  installClaudeCapabilityHooks,
  installCapabilityHooks,
  runCapabilitySessionStart,
  runCapabilityHookProcess,
  runClaudeCapabilityPreToolUse,
} from "../src/capability-hooks.js";

const tempDirs: string[] = [];
const glAxiFixtureRoot = fileURLToPath(
  new URL("./fixtures/gl-axi-v1/", import.meta.url),
);

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("computeClaudeCapabilityHookUpdate", () => {
  it("adds managed integrity and policy hooks while preserving foreign hooks repeat-safely", () => {
    const settings = {
      hooks: {
        SessionStart: [
          {
            matcher: "startup",
            hooks: [{ type: "command", command: "/usr/local/bin/foreign" }],
          },
        ],
      },
    };

    const [updated, changed] = computeClaudeCapabilityHookUpdate(settings, {
      marker: "axi-capability-policy",
      sessionStartCommand: "axi-capability-policy session-start",
      preToolUseCommand: "axi-capability-policy pre-tool-use",
    });

    expect(changed).toBe(true);
    expect(updated.hooks?.SessionStart?.[0]).toEqual(
      settings.hooks.SessionStart[0],
    );
    expect(updated.hooks?.SessionStart?.[1]).toEqual({
      matcher: "",
      hooks: [
        {
          type: "command",
          command: "axi-capability-policy session-start",
          timeout: 10,
        },
      ],
    });
    expect(updated.hooks?.PreToolUse).toEqual([
      {
        matcher: "Bash",
        hooks: [
          {
            type: "command",
            command: "axi-capability-policy pre-tool-use",
            timeout: 10,
          },
        ],
      },
    ]);

    const [again, changedAgain] = computeClaudeCapabilityHookUpdate(updated, {
      marker: "axi-capability-policy",
      sessionStartCommand: "axi-capability-policy session-start",
      preToolUseCommand: "axi-capability-policy pre-tool-use",
    });
    expect(changedAgain).toBe(false);
    expect(again).toBe(updated);
  });

  it("repairs stale managed matchers without changing a foreign hook in the same group", () => {
    const [updated] = computeClaudeCapabilityHookUpdate(
      {
        hooks: {
          PreToolUse: [
            {
              matcher: "Edit",
              hooks: [
                {
                  type: "command",
                  command: "old axi-capability-policy pre-tool-use",
                },
                { type: "command", command: "/foreign/edit-hook" },
              ],
            },
          ],
        },
      },
      {
        marker: "axi-capability-policy",
        sessionStartCommand: "axi-capability-policy session-start",
        preToolUseCommand: "axi-capability-policy pre-tool-use",
      },
    );

    expect(updated.hooks?.PreToolUse).toEqual([
      {
        matcher: "Edit",
        hooks: [{ type: "command", command: "/foreign/edit-hook" }],
      },
      {
        matcher: "Bash",
        hooks: [
          {
            type: "command",
            command: "axi-capability-policy pre-tool-use",
            timeout: 10,
          },
        ],
      },
    ]);
  });
});

describe("computeCapabilitySessionStartHookUpdate", () => {
  it("adds only integrity SessionStart while preserving foreign Codex events", () => {
    const [updated, changed] = computeCapabilitySessionStartHookUpdate(
      {
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "/foreign/pre-tool" }],
            },
          ],
        },
      },
      {
        marker: "axi-capability-hook",
        sessionStartCommand:
          "axi-capability-hook session-start --manifest /pins/capabilities.json",
        preToolUseCommand:
          "axi-capability-hook pre-tool-use --manifest /pins/capabilities.json",
      },
    );

    expect(changed).toBe(true);
    expect(updated.hooks?.PreToolUse).toEqual([
      {
        matcher: "Bash",
        hooks: [{ type: "command", command: "/foreign/pre-tool" }],
      },
    ]);
    expect(updated.hooks?.SessionStart).toEqual([
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command:
              "axi-capability-hook session-start --manifest /pins/capabilities.json",
            timeout: 10,
          },
        ],
      },
    ]);
  });
});

describe("installClaudeCapabilityHooks", () => {
  it("updates Claude user settings and leaves a repeated install untouched", () => {
    const home = mkdtempSync(join(tmpdir(), "axi-capability-hooks-"));
    tempDirs.push(home);
    const settingsPath = join(home, ".claude", "settings.json");
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Edit",
              hooks: [{ type: "command", command: "/foreign/edit-hook" }],
            },
          ],
        },
      }),
    );

    const options = {
      homeDir: home,
      spec: {
        marker: "axi-capability-policy",
        sessionStartCommand: "axi-capability-policy session-start",
        preToolUseCommand: "axi-capability-policy pre-tool-use",
      },
    };
    expect(installClaudeCapabilityHooks(options)).toBe(true);
    const installed = readFileSync(settingsPath, "utf8");
    const mtime = statSync(settingsPath).mtimeMs;

    expect(installed).toContain("/foreign/edit-hook");
    expect(installed).toContain("axi-capability-policy session-start");
    expect(installed).toContain("axi-capability-policy pre-tool-use");
    expect(installClaudeCapabilityHooks(options)).toBe(false);
    expect(readFileSync(settingsPath, "utf8")).toBe(installed);
    expect(statSync(settingsPath).mtimeMs).toBe(mtime);
  });
});

describe("installCapabilityHooks", () => {
  it("installs integrity on all harnesses and PreToolUse only on Claude repeat-safely", () => {
    const home = mkdtempSync(join(tmpdir(), "axi-all-capability-hooks-"));
    tempDirs.push(home);
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(
      join(home, ".codex", "hooks.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "/foreign/codex-hook" }],
            },
          ],
        },
      }),
    );
    writeFileSync(join(home, ".codex", "config.toml"), "[model]\nname = 'x'\n");

    const options = {
      homeDir: home,
      spec: {
        marker: "axi-capability-hook",
        sessionStartCommand:
          "axi-capability-hook session-start --manifest /pins/capabilities.json --policy /pins/policy.json --identity /pins/identity.json --evidence /logs/decisions.jsonl",
        preToolUseCommand:
          "axi-capability-hook pre-tool-use --manifest /pins/capabilities.json --policy /pins/policy.json --identity /pins/identity.json --evidence /logs/decisions.jsonl",
      },
    };

    expect(installCapabilityHooks(options)).toBe(true);
    const claude = readFileSync(join(home, ".claude", "settings.json"), "utf8");
    const codex = readFileSync(join(home, ".codex", "hooks.json"), "utf8");
    const codexConfig = readFileSync(
      join(home, ".codex", "config.toml"),
      "utf8",
    );
    const pluginPath = join(
      home,
      ".config",
      "opencode",
      "plugins",
      "axi-axi-capability-hook-integrity.js",
    );
    const plugin = readFileSync(pluginPath, "utf8");
    const mtimes = [
      join(home, ".claude", "settings.json"),
      join(home, ".codex", "hooks.json"),
      join(home, ".codex", "config.toml"),
      pluginPath,
    ].map((path) => statSync(path).mtimeMs);

    expect(claude).toContain("session-start");
    expect(claude).toContain("pre-tool-use");
    expect(codex).toContain("/foreign/codex-hook");
    expect(codex).toContain("session-start");
    expect(codex.match(/pre-tool-use/g)).toBeNull();
    expect(codexConfig).toContain("[model]\nname = 'x'");
    expect(codexConfig).toContain("[features]\nhooks = true");
    expect(plugin).toContain("axi-sdk-js managed capability integrity plugin");
    expect(plugin).toContain(JSON.stringify(options.spec.sessionStartCommand));

    expect(installCapabilityHooks(options)).toBe(false);
    expect(
      [
        join(home, ".claude", "settings.json"),
        join(home, ".codex", "hooks.json"),
        join(home, ".codex", "config.toml"),
        pluginPath,
      ].map((path) => statSync(path).mtimeMs),
    ).toEqual(mtimes);
  });

  it("runs the independently installed integrity command from the OpenCode session plugin", async () => {
    const home = mkdtempSync(join(tmpdir(), "axi-opencode-integrity-"));
    tempDirs.push(home);
    const receivedPath = join(home, "received.json");
    const commandPath = join(home, "axi-capability-hook");
    writeFileSync(
      commandPath,
      `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const input = readFileSync(0, "utf8");
writeFileSync(${JSON.stringify(receivedPath)}, input);
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "integrity verified from external SDK" } }));
`,
    );
    chmodSync(commandPath, 0o755);
    installCapabilityHooks({
      homeDir: home,
      spec: {
        marker: "axi-capability-hook",
        sessionStartCommand: commandPath,
        preToolUseCommand: `${commandPath} pre-tool-use`,
      },
    });

    const pluginPath = join(
      home,
      ".config",
      "opencode",
      "plugins",
      "axi-axi-capability-hook-integrity.js",
    );
    const pluginModule = await import(pathToFileURL(pluginPath).href);
    const plugin = await pluginModule.AxiAxiCapabilityHookIntegrityPlugin({
      directory: home,
    });
    const output = { system: [] as string[] };
    await plugin["experimental.chat.system.transform"](
      { sessionID: "session-42" },
      output,
    );

    expect(output.system).toEqual(["integrity verified from external SDK"]);
    expect(JSON.parse(readFileSync(receivedPath, "utf8"))).toMatchObject({
      hook_event_name: "SessionStart",
      source: "startup",
      session_id: "session-42",
    });
  });

  it("aborts the OpenCode system transform when integrity output is invalid", async () => {
    const home = mkdtempSync(join(tmpdir(), "axi-opencode-integrity-fail-"));
    tempDirs.push(home);
    const commandPath = join(home, "axi-capability-hook");
    writeFileSync(
      commandPath,
      '#!/usr/bin/env node\nprocess.stdout.write("{}");\n',
    );
    chmodSync(commandPath, 0o755);
    installCapabilityHooks({
      homeDir: home,
      spec: {
        marker: "axi-capability-hook",
        sessionStartCommand: commandPath,
        preToolUseCommand: `${commandPath} pre-tool-use`,
      },
    });
    const pluginPath = join(
      home,
      ".config",
      "opencode",
      "plugins",
      "axi-axi-capability-hook-integrity.js",
    );
    const pluginModule = await import(pathToFileURL(pluginPath).href);
    const plugin = await pluginModule.AxiAxiCapabilityHookIntegrityPlugin({
      directory: home,
    });
    const output = { system: [] as string[] };

    await expect(
      plugin["experimental.chat.system.transform"](
        { sessionID: "session-failed" },
        output,
      ),
    ).rejects.toThrow("INTEGRITY_HOOK_INVALID_OUTPUT");
    expect(output.system).toEqual([]);
  });

  it("does not overwrite a foreign OpenCode plugin at the managed target", () => {
    const home = mkdtempSync(join(tmpdir(), "axi-opencode-foreign-"));
    tempDirs.push(home);
    const pluginPath = join(
      home,
      ".config",
      "opencode",
      "plugins",
      "axi-axi-capability-hook-integrity.js",
    );
    mkdirSync(join(pluginPath, ".."), { recursive: true });
    writeFileSync(pluginPath, "// maintained by operator\n");
    const errors: string[] = [];

    installCapabilityHooks({
      homeDir: home,
      spec: {
        marker: "axi-capability-hook",
        sessionStartCommand: "axi-capability-hook session-start",
        preToolUseCommand: "axi-capability-hook pre-tool-use",
      },
      onError: (message) => errors.push(message),
    });

    expect(readFileSync(pluginPath, "utf8")).toBe(
      "// maintained by operator\n",
    );
    expect(errors).toEqual([
      `${pluginPath}: refusing to overwrite unmanaged OpenCode plugin`,
    ]);
  });
});

function capabilityFixture() {
  const root = mkdtempSync(join(tmpdir(), "axi-capability-runtime-"));
  tempDirs.push(root);
  const manifestPath = join(root, "capabilities.json");
  const identityPath = join(root, "identity.json");
  const policyPath = join(root, "policy.json");
  const evidencePath = join(root, "evidence.jsonl");
  copyFileSync(join(glAxiFixtureRoot, "manifest.valid.json"), manifestPath);
  copyFileSync(join(glAxiFixtureRoot, "identity.json"), identityPath);
  writeFileSync(
    policyPath,
    JSON.stringify({
      schemaVersion: 1,
      engine: "builtin",
      pins: {
        manifestSha256:
          "1b1be094396a248337e14a199a557bfb79103a156745a6910966f4d2ab94edb7",
        publisher: {
          oidcIssuer: "https://gitlab.com",
          projectPath: "axi-tooling/gl-axi",
        },
      },
      effects: { none: "allow", read: "allow", mutate: "deny" },
      passthrough: {
        methods: {
          GET: "allow",
          HEAD: "allow",
          POST: "deny",
          PUT: "deny",
          PATCH: "deny",
          DELETE: "deny",
        },
      },
    }),
  );
  return {
    manifestPath,
    identityPath,
    policyPath,
    evidencePath,
    toolBin: "gl-axi-fixture",
  };
}

describe("runClaudeCapabilityPreToolUse", () => {
  it("allows a standalone invocation permitted by pinned policy and records its decision", () => {
    const paths = capabilityFixture();
    const input = {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "gl-axi-fixture issue list" },
    };

    const output = runClaudeCapabilityPreToolUse(input, {
      ...paths,
      hookVersion: "1.0.0-test",
      now: () => "2026-07-10T12:00:00.000Z",
    });

    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason:
          "Capability policy allows issue list|any (read).",
      },
    });
    const records = readFileSync(paths.evidencePath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      timestamp: "2026-07-10T12:00:00.000Z",
      hookVersion: "1.0.0-test",
      hookEventName: "PreToolUse",
      routeKey: "issue list|any",
      declaredEffect: "read",
      effect: "read",
      decision: "allow",
      manifestSha256:
        "1b1be094396a248337e14a199a557bfb79103a156745a6910966f4d2ab94edb7",
      manifestSchemaVersion: 1,
      policySchemaVersion: 1,
    });
    expect(records[0].toolInputSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(records[0].policySha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    [
      "compound commands",
      "gl-axi-fixture issue list && echo done",
      "COMMAND_UNDECOMPOSABLE",
      null,
    ],
    ["unknown routes", "gl-axi-fixture surprise", "ROUTE_UNKNOWN", null],
    [
      "absolute executable paths",
      "/opt/sdk/bin/gl-axi-fixture issue list",
      "COMMAND_NOT_STANDALONE",
      null,
    ],
    [
      "npx package execution",
      "npx gl-axi-fixture issue list",
      "COMMAND_NOT_STANDALONE",
      null,
    ],
    [
      "policy-denied effects",
      "gl-axi-fixture issue close 42",
      "EFFECT_DENIED",
      "issue close|any",
    ],
  ])("denies %s and records the reason", (_name, command, reason, routeKey) => {
    const paths = capabilityFixture();
    const output = runClaudeCapabilityPreToolUse(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command },
      },
      paths,
    );

    expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput?.permissionDecisionReason).toContain(
      `POLICY_DENIED: ${reason}`,
    );
    expect(output.hookSpecificOutput?.permissionDecisionReason).toContain(
      "Invoke gl-axi-fixture as a standalone command.",
    );
    const record = JSON.parse(readFileSync(paths.evidencePath, "utf8").trim());
    expect(record).toMatchObject({ decision: "deny", reason, routeKey });
  });

  it("keeps typed policy error detail in the permission reason and a stable evidence code", () => {
    const paths = capabilityFixture();
    const output = runClaudeCapabilityPreToolUse(
      {
        tool_name: "Bash",
        tool_input: { command: "gl-axi-fixture surprise" },
      },
      paths,
    );

    expect(output.hookSpecificOutput?.permissionDecisionReason).toContain(
      "Invocation does not match a declared capability route.",
    );
    expect(
      JSON.parse(readFileSync(paths.evidencePath, "utf8").trim()),
    ).toMatchObject({ reason: "ROUTE_UNKNOWN" });
  });

  it("denies a manifest pin mismatch", () => {
    const paths = capabilityFixture();
    const policy = JSON.parse(readFileSync(paths.policyPath, "utf8"));
    policy.pins.manifestSha256 = "0".repeat(64);
    writeFileSync(paths.policyPath, JSON.stringify(policy));

    const output = runClaudeCapabilityPreToolUse(
      {
        tool_name: "Bash",
        tool_input: { command: "gl-axi-fixture issue list" },
      },
      paths,
    );

    expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput?.permissionDecisionReason).toContain(
      "MANIFEST_HASH_MISMATCH",
    );
    expect(
      JSON.parse(readFileSync(paths.evidencePath, "utf8").trim()),
    ).toMatchObject({ decision: "deny", reason: "MANIFEST_HASH_MISMATCH" });
  });

  it("does not trust a tampered manifest to rename the policed executable", () => {
    const paths = capabilityFixture();
    const manifest = JSON.parse(readFileSync(paths.manifestPath, "utf8"));
    manifest.tool.bin = "unrelated-bin";
    writeFileSync(paths.manifestPath, JSON.stringify(manifest));

    const output = runClaudeCapabilityPreToolUse(
      {
        tool_name: "Bash",
        tool_input: { command: "gl-axi issue list" },
      },
      { ...paths, toolBin: "gl-axi" },
    );

    expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput?.permissionDecisionReason).toContain(
      "MANIFEST_HASH_MISMATCH",
    );
  });

  it("denies when evidence cannot be appended", () => {
    const paths = capabilityFixture();
    paths.evidencePath = join(paths.evidencePath, "missing", "evidence.jsonl");

    const output = runClaudeCapabilityPreToolUse(
      {
        tool_name: "Bash",
        tool_input: { command: "gl-axi-fixture issue list" },
      },
      paths,
    );

    expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput?.permissionDecisionReason).toContain(
      "EVIDENCE_UNWRITABLE",
    );
  });

  it("does not decide or log unrelated Bash commands", () => {
    const paths = capabilityFixture();
    expect(
      runClaudeCapabilityPreToolUse(
        { tool_name: "Bash", tool_input: { command: "git status --short" } },
        paths,
      ),
    ).toEqual({});
    expect(existsSync(paths.evidencePath)).toBe(false);
  });

  it("fails closed on malformed matched hook input", () => {
    const paths = capabilityFixture();
    const output = runClaudeCapabilityPreToolUse(
      { tool_name: "Bash", tool_input: {} },
      paths,
    );

    expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput?.permissionDecisionReason).toContain(
      "HOOK_INPUT_INVALID",
    );
    expect(
      JSON.parse(readFileSync(paths.evidencePath, "utf8").trim()),
    ).toMatchObject({ decision: "deny", reason: "HOOK_INPUT_INVALID" });
  });
});

describe("runCapabilitySessionStart", () => {
  it("verifies local integrity pins and records the session decision without network input", () => {
    const paths = capabilityFixture();
    const input = {
      hook_event_name: "SessionStart",
      source: "startup",
      session_id: "session-1",
    };

    const output = runCapabilitySessionStart(input, {
      ...paths,
      hookVersion: "1.0.0-test",
      now: () => "2026-07-10T12:00:00.000Z",
    });

    expect(output.hookSpecificOutput).toMatchObject({
      hookEventName: "SessionStart",
      additionalContext:
        "AXI capability integrity verified for gl-axi-fixture (manifest 1b1be094396a248337e14a199a557bfb79103a156745a6910966f4d2ab94edb7).",
    });
    const record = JSON.parse(readFileSync(paths.evidencePath, "utf8").trim());
    expect(record).toMatchObject({
      timestamp: "2026-07-10T12:00:00.000Z",
      hookVersion: "1.0.0-test",
      hookEventName: "SessionStart",
      decision: "allow",
      reason: null,
      manifestSha256:
        "1b1be094396a248337e14a199a557bfb79103a156745a6910966f4d2ab94edb7",
      manifestSchemaVersion: 1,
      policySchemaVersion: 1,
    });
  });
});

describe("runCapabilityHookProcess", () => {
  it("adapts PreToolUse stdin to one Claude JSON stdout decision", () => {
    const paths = capabilityFixture();
    let stdout = "";

    const exitCode = runCapabilityHookProcess("pre-tool-use", paths, {
      readStdin: () =>
        JSON.stringify({
          tool_name: "Bash",
          tool_input: { command: "gl-axi-fixture issue list" },
        }),
      writeStdout: (text) => {
        stdout += text;
      },
    });

    expect(exitCode).toBe(0);
    expect(stdout.endsWith("\n")).toBe(true);
    expect(JSON.parse(stdout)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    });
  });

  it("returns nonzero when SessionStart integrity fails", () => {
    const paths = capabilityFixture();
    const policy = JSON.parse(readFileSync(paths.policyPath, "utf8"));
    policy.pins.manifestSha256 = "0".repeat(64);
    writeFileSync(paths.policyPath, JSON.stringify(policy));
    let stdout = "";

    const exitCode = runCapabilityHookProcess("session-start", paths, {
      readStdin: () => JSON.stringify({ hook_event_name: "SessionStart" }),
      writeStdout: (text) => {
        stdout += text;
      },
    });

    expect(exitCode).toBe(2);
    expect(JSON.parse(stdout).hookSpecificOutput.additionalContext).toContain(
      "gl-axi-fixture",
    );
    expect(stdout).not.toContain("Invoke gl-axi as");
  });
});
