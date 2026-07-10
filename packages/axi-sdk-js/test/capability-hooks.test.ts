import {
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
import { afterEach, describe, expect, it } from "vitest";
import {
  computeClaudeCapabilityHookUpdate,
  installClaudeCapabilityHooks,
  runCapabilitySessionStart,
  runCapabilityHookProcess,
  runClaudeCapabilityPreToolUse,
} from "../src/capability-hooks.js";

const tempDirs: string[] = [];

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

function capabilityFixture() {
  const root = mkdtempSync(join(tmpdir(), "axi-capability-runtime-"));
  tempDirs.push(root);
  const manifestPath = join(root, "capabilities.json");
  const identityPath = join(root, "identity.json");
  const policyPath = join(root, "policy.json");
  const evidencePath = join(root, "evidence.jsonl");
  copyFileSync(
    "/home/mgibs/workspace/gl-axi/fixtures/capabilities/manifest.valid.json",
    manifestPath,
  );
  copyFileSync("/home/mgibs/workspace/gl-axi/identity.json", identityPath);
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
      "Invoke gl-axi as a standalone command.",
    );
    const record = JSON.parse(readFileSync(paths.evidencePath, "utf8").trim());
    expect(record).toMatchObject({ decision: "deny", reason, routeKey });
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
});
