import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import * as sdk from "../src/index.js";
import { canonicalSha256 } from "../src/capability-policy.js";

const tempDirs: string[] = [];
const cliPath = fileURLToPath(
  new URL("../src/capability-hook-cli.ts", import.meta.url),
);
const viteNodePath = fileURLToPath(
  new URL("../node_modules/.bin/vite-node", import.meta.url),
);

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function capabilityFixture() {
  const root = mkdtempSync(join(tmpdir(), "axi-capability-hook-cli-"));
  tempDirs.push(root);
  const manifestPath = join(root, "capabilities.json");
  const policyPath = join(root, "policy.json");
  const identityPath = join(root, "identity.json");
  const evidencePath = join(root, "evidence.jsonl");
  const publisher = {
    oidcIssuer: "https://gitlab.com",
    projectPath: "axi-tooling/gl-axi",
  };
  const manifest = {
    schemaVersion: 1,
    tool: { name: "gl-axi", bin: "gl-axi" },
    routes: [
      {
        match: { tokens: ["issue", "list"] },
        effect: "read",
        reaches: ["gitlab"],
        scopes: ["read_api"],
      },
    ],
  };
  const policy = {
    schemaVersion: 1,
    engine: "builtin",
    pins: { manifestSha256: canonicalSha256(manifest), publisher },
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
  };
  const identity = { schemaVersion: 1, publisher };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(policyPath, JSON.stringify(policy));
  writeFileSync(identityPath, JSON.stringify(identity));
  return { manifestPath, policyPath, identityPath, evidencePath };
}

function runCli(
  args: string[],
  stdin: unknown,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(viteNodePath, [cliPath, ...args], {
      cwd: new URL("..", import.meta.url),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(stdin));
  });
}

describe("axi-capability-hook executable", () => {
  it("adapts a Claude PreToolUse event through required local artifact paths", async () => {
    const paths = capabilityFixture();
    const result = await runCli(
      [
        "pre-tool-use",
        "--manifest",
        paths.manifestPath,
        "--policy",
        paths.policyPath,
        "--identity",
        paths.identityPath,
        "--evidence",
        paths.evidencePath,
        "--tool-bin",
        "gl-axi",
        "--hook-version",
        "1.0.0-test",
      ],
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "gl-axi issue list" },
      },
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    });
    expect(JSON.parse(readFileSync(paths.evidencePath, "utf8"))).toMatchObject({
      hookVersion: "1.0.0-test",
      hookEventName: "PreToolUse",
      routeKey: "issue list|any",
      decision: "allow",
    });
  });

  it("adapts a Claude SessionStart event through the same local bundle", async () => {
    const paths = capabilityFixture();
    const result = await runCli(
      [
        "session-start",
        `--manifest=${paths.manifestPath}`,
        `--policy=${paths.policyPath}`,
        `--identity=${paths.identityPath}`,
        `--evidence=${paths.evidencePath}`,
        "--tool-bin=gl-axi",
      ],
      { hook_event_name: "SessionStart" },
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: expect.stringContaining(
          "AXI capability integrity verified for gl-axi",
        ),
      },
    });
    expect(JSON.parse(readFileSync(paths.evidencePath, "utf8"))).toMatchObject({
      hookEventName: "SessionStart",
      decision: "allow",
    });
  });

  it("fails with a structured usage error before reading hooks when a required path is missing", async () => {
    const paths = capabilityFixture();
    const result = await runCli(
      [
        "pre-tool-use",
        "--manifest",
        paths.manifestPath,
        "--policy",
        paths.policyPath,
        "--identity",
        paths.identityPath,
      ],
      { hook_event_name: "PreToolUse" },
    );

    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        code: "INVALID_USAGE",
        message: "Missing required flag: --evidence.",
      },
      help: [
        "Usage: axi-capability-hook <session-start|pre-tool-use> --manifest <path> --policy <path> --identity <path> --evidence <path> --tool-bin <name> [--hook-version <version>]",
      ],
    });
  });

  it("requires --tool-bin so Bash scoping cannot depend on readable artifacts", async () => {
    const paths = capabilityFixture();
    const result = await runCli(
      [
        "pre-tool-use",
        "--manifest",
        paths.manifestPath,
        "--policy",
        paths.policyPath,
        "--identity",
        paths.identityPath,
        "--evidence",
        paths.evidencePath,
      ],
      { hook_event_name: "PreToolUse" },
    );

    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: "INVALID_USAGE",
        message: "Missing required flag: --tool-bin.",
      },
    });
  });
});

describe("capability policy public package boundary", () => {
  it("publishes the executable and policy/hook APIs without requiring a tool package", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );

    expect(packageJson.bin).toEqual({
      "axi-capability-hook": "./dist/capability-hook-cli.js",
    });
    expect(packageJson.exports).toMatchObject({
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
      "./capability-policy": {
        types: "./dist/capability-policy.d.ts",
        import: "./dist/capability-policy.js",
      },
      "./capability-hooks": {
        types: "./dist/capability-hooks.d.ts",
        import: "./dist/capability-hooks.js",
      },
    });
    expect(packageJson.files).toContain("dist");
    expect(sdk.parseCapabilityManifest).toBeTypeOf("function");
    expect(sdk.evaluateCapabilityPolicy).toBeTypeOf("function");
    expect(sdk.verifyCapabilityPins).toBeTypeOf("function");
    expect(sdk.installCapabilityHooks).toBeTypeOf("function");
    expect(sdk.installClaudeCapabilityHooks).toBeTypeOf("function");
    expect(sdk.runCapabilityHookProcess).toBeTypeOf("function");
  });

  it("keeps the independent hook install exactly versioned through Release Please", () => {
    const readme = readFileSync(
      new URL("../README.md", import.meta.url),
      "utf8",
    );
    const releaseConfig = JSON.parse(
      readFileSync(
        new URL("../../../release-please-config.json", import.meta.url),
        "utf8",
      ),
    );
    const installBlock = readme.match(
      /<!-- x-release-please-start-version -->([\s\S]*?)<!-- x-release-please-end -->/,
    )?.[1];

    expect(
      releaseConfig.packages["packages/axi-sdk-js"]["extra-files"],
    ).toContainEqual({
      type: "generic",
      path: "packages/axi-sdk-js/README.md",
    });
    expect(installBlock).toBeDefined();
    const packageVersion = installBlock?.match(
      /npm install[^\n]*axi-sdk-js@(\d+\.\d+\.\d+)/,
    )?.[1];
    const prefixVersion = installBlock?.match(
      /\/opt\/axi-sdk-js\/(\d+\.\d+\.\d+)/,
    )?.[1];
    expect(packageVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(prefixVersion).toBe(packageVersion);
    expect(installBlock).toContain(
      `/opt/axi-sdk-js/${packageVersion}/node_modules/.bin/axi-capability-hook`,
    );
    expect(installBlock).not.toMatch(
      /(?:^|["'`\s])axi-capability-hook (?:session-start|pre-tool-use)/m,
    );
  });
});
