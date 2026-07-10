import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  CapabilityPolicyError,
  canonicalSha256,
  evaluateCapabilityPolicy,
  parseCapabilityManifest,
  parseCapabilityPolicy,
  resolveCapabilityInvocation,
  verifyCapabilityPins,
  type CapabilityManifest,
  type CapabilityPolicy,
  type PublisherIdentityDocument,
  type ResolvedCapabilityInvocation,
} from "./capability-policy.js";
import {
  computeCodexConfigUpdate,
  type HookGroup,
  type HookSettings,
} from "./hooks.js";

export interface ClaudeCapabilityHookSpec {
  marker: string;
  sessionStartCommand: string;
  preToolUseCommand: string;
  timeoutSeconds?: number;
}

export interface InstallClaudeCapabilityHooksOptions {
  spec: ClaudeCapabilityHookSpec;
  homeDir?: string;
  settingsPath?: string;
  onError?: (message: string) => void;
}

export interface InstallCapabilityHooksOptions {
  spec: ClaudeCapabilityHookSpec;
  homeDir?: string;
  claudeSettingsPath?: string;
  codexHooksPath?: string;
  codexConfigPath?: string;
  openCodePluginPath?: string;
  onError?: (message: string) => void;
}

export interface CapabilityHookRuntimeOptions {
  manifestPath: string;
  policyPath: string;
  identityPath: string;
  evidencePath: string;
  hookVersion?: string;
  toolBin?: string;
  now?: () => string;
}

export interface ClaudeHookOutput {
  hookSpecificOutput?: {
    hookEventName: "PreToolUse" | "SessionStart";
    permissionDecision?: "allow" | "deny";
    permissionDecisionReason?: string;
    additionalContext?: string;
  };
}

export type CapabilityHookMode = "session-start" | "pre-tool-use";

export interface CapabilityHookProcessIo {
  readStdin?: () => string;
  writeStdout?: (text: string) => void;
}

function managed(command: string | undefined, marker: string): boolean {
  return typeof command === "string" && command.includes(marker);
}

function updateManagedEvent(
  groups: HookGroup[] | undefined,
  marker: string,
  matcher: string,
  command: string,
  timeout: number,
): HookGroup[] {
  const next = structuredClone(groups ?? []).flatMap((group) => {
    if (!Array.isArray(group.hooks)) return [group];
    const foreignHooks = group.hooks.filter(
      (hook) => !managed(hook.command, marker),
    );
    return foreignHooks.length > 0 ? [{ ...group, hooks: foreignHooks }] : [];
  });
  next.push({
    matcher,
    hooks: [{ type: "command", command, timeout }],
  });
  return next;
}

export function computeClaudeCapabilityHookUpdate(
  settings: HookSettings,
  spec: ClaudeCapabilityHookSpec,
): [HookSettings, boolean] {
  const updated = structuredClone(settings);
  updated.hooks ??= {};
  const timeout = spec.timeoutSeconds ?? 10;

  updated.hooks.SessionStart = updateManagedEvent(
    updated.hooks.SessionStart as HookGroup[] | undefined,
    spec.marker,
    "",
    spec.sessionStartCommand,
    timeout,
  );
  updated.hooks.PreToolUse = updateManagedEvent(
    updated.hooks.PreToolUse as HookGroup[] | undefined,
    spec.marker,
    "Bash",
    spec.preToolUseCommand,
    timeout,
  );

  if (JSON.stringify(updated) === JSON.stringify(settings)) {
    return [settings, false];
  }
  return [updated, true];
}

export function computeCapabilitySessionStartHookUpdate(
  settings: HookSettings,
  spec: ClaudeCapabilityHookSpec,
): [HookSettings, boolean] {
  const updated = structuredClone(settings);
  updated.hooks ??= {};
  updated.hooks.SessionStart = updateManagedEvent(
    updated.hooks.SessionStart as HookGroup[] | undefined,
    spec.marker,
    "",
    spec.sessionStartCommand,
    spec.timeoutSeconds ?? 10,
  );

  if (JSON.stringify(updated) === JSON.stringify(settings)) {
    return [settings, false];
  }
  return [updated, true];
}

export function installClaudeCapabilityHooks(
  options: InstallClaudeCapabilityHooksOptions,
): boolean {
  const settingsPath =
    options.settingsPath ??
    join(options.homeDir ?? homedir(), ".claude", "settings.json");

  try {
    const settings = existsSync(settingsPath)
      ? (JSON.parse(readFileSync(settingsPath, "utf8")) as HookSettings)
      : {};
    const [updated, changed] = computeClaudeCapabilityHookUpdate(
      settings,
      options.spec,
    );
    if (!changed) return false;

    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(
      settingsPath,
      `${JSON.stringify(updated, null, 2)}\n`,
      "utf8",
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.onError?.(`${settingsPath}: ${message}`);
    return false;
  }
}

const OPENCODE_CAPABILITY_PLUGIN_MARKER =
  "axi-sdk-js managed capability integrity plugin:";

function sanitizeFilePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_");
}

function sanitizeExportName(value: string): string {
  const name = value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
  return `Axi${name || "Capability"}IntegrityPlugin`;
}

function buildOpenCodeCapabilityPlugin(spec: ClaudeCapabilityHookSpec): string {
  const timeoutMs = (spec.timeoutSeconds ?? 10) * 1000;
  const managedMarker = `${OPENCODE_CAPABILITY_PLUGIN_MARKER} ${spec.marker}`;
  const exportName = sanitizeExportName(spec.marker);
  return `// ${managedMarker}
// Generated by axi-sdk-js. Remove the managed marker before taking ownership.
import { spawn } from "node:child_process";

const command = ${JSON.stringify(spec.sessionStartCommand)};
const timeoutMs = ${JSON.stringify(timeoutMs)};

function runIntegrityCheck(cwd, sessionID) {
  return new Promise((resolve) => {
    const child = spawn(command, [], {
      cwd: typeof cwd === "string" && cwd.length > 0 ? cwd : process.cwd(),
      env: process.env,
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (context) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(context);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish("POLICY_DENIED: INTEGRITY_HOOK_TIMEOUT. No AXI invocation is trusted for this session.");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      finish("POLICY_DENIED: INTEGRITY_HOOK_FAILED: " + error.message + ". No AXI invocation is trusted for this session.");
    });
    child.on("close", (code) => {
      if (code !== 0) {
        const detail = (stderr || stdout || "exit " + code).trim();
        finish("POLICY_DENIED: INTEGRITY_HOOK_FAILED: " + detail + ". No AXI invocation is trusted for this session.");
        return;
      }
      try {
        const output = JSON.parse(stdout);
        const context = output?.hookSpecificOutput?.additionalContext;
        if (typeof context !== "string" || context.length === 0) throw new Error("missing additionalContext");
        finish(context);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        finish("POLICY_DENIED: INTEGRITY_HOOK_INVALID_OUTPUT: " + detail + ". No AXI invocation is trusted for this session.");
      }
    });
    child.stdin.end(JSON.stringify({
      hook_event_name: "SessionStart",
      source: "startup",
      session_id: sessionID,
    }));
  });
}

export const ${exportName} = async ({ directory }) => {
  const sessions = new Map();
  return {
    "experimental.chat.system.transform": async (input, output) => {
      const sessionID = input.sessionID ?? "__global__";
      let context = sessions.get(sessionID);
      if (context === undefined) {
        context = await runIntegrityCheck(directory, sessionID);
        sessions.set(sessionID, context);
      }
      output.system.push(context);
    },
  };
};
`;
}

function writeHookSettings(
  path: string,
  compute: (settings: HookSettings) => [HookSettings, boolean],
  onError?: (message: string) => void,
): boolean {
  try {
    const current = existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as HookSettings)
      : {};
    const [updated, changed] = compute(current);
    if (!changed) return false;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onError?.(`${path}: ${message}`);
    return false;
  }
}

function installOpenCodeCapabilityPlugin(
  path: string,
  spec: ClaudeCapabilityHookSpec,
  onError?: (message: string) => void,
): boolean {
  const source = buildOpenCodeCapabilityPlugin(spec);
  const marker = `${OPENCODE_CAPABILITY_PLUGIN_MARKER} ${spec.marker}`;
  try {
    const current = existsSync(path) ? readFileSync(path, "utf8") : undefined;
    if (current !== undefined && !current.includes(marker)) {
      onError?.(`${path}: refusing to overwrite unmanaged OpenCode plugin`);
      return false;
    }
    if (current === source) return false;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source, "utf8");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onError?.(`${path}: ${message}`);
    return false;
  }
}

export function installCapabilityHooks(
  options: InstallCapabilityHooksOptions,
): boolean {
  const home = options.homeDir ?? homedir();
  const claudePath =
    options.claudeSettingsPath ?? join(home, ".claude", "settings.json");
  const codexHooksPath =
    options.codexHooksPath ?? join(home, ".codex", "hooks.json");
  const codexConfigPath =
    options.codexConfigPath ?? join(home, ".codex", "config.toml");
  const openCodePluginPath =
    options.openCodePluginPath ??
    join(
      home,
      ".config",
      "opencode",
      "plugins",
      `axi-${sanitizeFilePart(options.spec.marker)}-integrity.js`,
    );
  let changed = false;

  changed =
    writeHookSettings(
      claudePath,
      (settings) => computeClaudeCapabilityHookUpdate(settings, options.spec),
      options.onError,
    ) || changed;
  changed =
    writeHookSettings(
      codexHooksPath,
      (settings) =>
        computeCapabilitySessionStartHookUpdate(settings, options.spec),
      options.onError,
    ) || changed;

  try {
    const current = existsSync(codexConfigPath)
      ? readFileSync(codexConfigPath, "utf8")
      : "";
    const [updated, configChanged] = computeCodexConfigUpdate(current);
    if (configChanged) {
      mkdirSync(dirname(codexConfigPath), { recursive: true });
      writeFileSync(codexConfigPath, updated, "utf8");
      changed = true;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.onError?.(`${codexConfigPath}: ${message}`);
  }

  changed =
    installOpenCodeCapabilityPlugin(
      openCodePluginPath,
      options.spec,
      options.onError,
    ) || changed;
  return changed;
}

interface VerifiedBundle {
  manifest: CapabilityManifest;
  policy: CapabilityPolicy;
  manifestSha256: string;
  policySha256: string;
}

interface LoadedEvidenceContext {
  manifestSha256: string | null;
  policySha256: string | null;
  manifestSchemaVersion: unknown;
  policySchemaVersion: unknown;
}

interface TokenizedInvocation {
  argv?: string[];
  reason?: string;
}

function readJson(path: string): { raw: string; value: unknown } {
  const raw = readFileSync(path, "utf8");
  return { raw, value: JSON.parse(raw) };
}

function evidenceContext(
  options: CapabilityHookRuntimeOptions,
): LoadedEvidenceContext {
  let manifestSha256: string | null = null;
  let policySha256: string | null = null;
  let manifestSchemaVersion: unknown = null;
  let policySchemaVersion: unknown = null;

  try {
    const loaded = readJson(options.manifestPath);
    manifestSha256 = canonicalSha256(loaded.raw);
    manifestSchemaVersion = (loaded.value as { schemaVersion?: unknown })
      ?.schemaVersion;
  } catch {
    // A missing local artifact is itself a fail-closed decision input.
  }
  try {
    const loaded = readJson(options.policyPath);
    policySha256 = canonicalSha256(loaded.raw);
    policySchemaVersion = (loaded.value as { schemaVersion?: unknown })
      ?.schemaVersion;
  } catch {
    // A missing local artifact is itself a fail-closed decision input.
  }

  return {
    manifestSha256,
    policySha256,
    manifestSchemaVersion,
    policySchemaVersion,
  };
}

function loadVerifiedBundle(
  options: CapabilityHookRuntimeOptions,
): VerifiedBundle {
  const manifestFile = readJson(options.manifestPath);
  const policyFile = readJson(options.policyPath);
  const identityFile = readJson(options.identityPath);
  const manifest = parseCapabilityManifest(manifestFile.value);
  const policy = parseCapabilityPolicy(policyFile.value);
  const identity = identityFile.value as PublisherIdentityDocument;
  const verified = verifyCapabilityPins({ manifest, policy, identity });
  return {
    manifest,
    policy,
    manifestSha256: verified.manifestSha256,
    policySha256: verified.policySha256,
  };
}

function commandName(token: string): string {
  return token.replaceAll("\\", "/").split("/").pop() ?? token;
}

function commandMentionsTool(command: string, bin: string): boolean {
  const escaped = bin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(^|[^A-Za-z0-9._-])${escaped}(?:@[^\\s'"]+)?(?=$|[^A-Za-z0-9._-])`,
  ).test(command);
}

function tokenizeSimpleShell(command: string): string[] | undefined {
  const tokens: string[] = [];
  let token = "";
  let quote: "single" | "double" | undefined;
  let tokenStarted = false;

  for (let index = 0; index < command.length; index++) {
    const char = command[index] ?? "";
    if (quote === "single") {
      if (char === "'") quote = undefined;
      else token += char;
      tokenStarted = true;
      continue;
    }
    if (quote === "double") {
      if (char === '"') {
        quote = undefined;
      } else if (char === "\\") {
        const next = command[++index];
        if (next === undefined) return undefined;
        if (["$", "`", '"', "\\"].includes(next)) token += next;
        else if (next !== "\n") token += `\\${next}`;
      } else {
        if (char === "$" || char === "`") return undefined;
        token += char;
      }
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (tokenStarted) {
        tokens.push(token);
        token = "";
        tokenStarted = false;
      }
      continue;
    }
    if (char === "'") {
      quote = "single";
      tokenStarted = true;
      continue;
    }
    if (char === '"') {
      quote = "double";
      tokenStarted = true;
      continue;
    }
    if (char === "\\") {
      const next = command[++index];
      if (next === undefined) return undefined;
      token += next;
      tokenStarted = true;
      continue;
    }
    if (";&|<>\n\r`()$".includes(char)) return undefined;
    if ("*?[]".includes(char)) return undefined;
    if (char === "#" && !tokenStarted) return undefined;
    token += char;
    tokenStarted = true;
  }

  if (quote) return undefined;
  if (tokenStarted) tokens.push(token);
  return tokens;
}

function tokenizeToolInvocation(
  command: string,
  bin: string,
): TokenizedInvocation {
  const tokens = tokenizeSimpleShell(command);
  if (!tokens || tokens.length === 0) {
    return { reason: "COMMAND_UNDECOMPOSABLE" };
  }
  if (commandName(tokens[0] ?? "") === bin) {
    return { argv: tokens.slice(1) };
  }

  if (["npx", "npx.cmd"].includes(commandName(tokens[0] ?? "").toLowerCase())) {
    let index = 1;
    while (
      ["--yes", "-y", "--no-install", "--quiet"].includes(tokens[index] ?? "")
    ) {
      index++;
    }
    const packageSpec = tokens[index] ?? "";
    if (packageSpec === bin || packageSpec.startsWith(`${bin}@`)) {
      return { argv: tokens.slice(index + 1) };
    }
  }

  return { reason: "COMMAND_NOT_STANDALONE" };
}

function policyDeniedReason(reason: string): string {
  return [
    `POLICY_DENIED: ${reason}.`,
    "help:",
    "  - Invoke gl-axi as a standalone command.",
    "  - Use only routes and effects allowed by the pinned capability policy.",
  ].join("\n");
}

function permissionOutput(
  decision: "allow" | "deny",
  reason: string,
): ClaudeHookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  };
}

function appendEvidence(
  options: CapabilityHookRuntimeOptions,
  record: Record<string, unknown>,
): boolean {
  try {
    appendFileSync(options.evidencePath, `${JSON.stringify(record)}\n`, {
      encoding: "utf8",
      flag: "a",
    });
    return true;
  } catch {
    return false;
  }
}

function makeEvidenceRecord(
  options: CapabilityHookRuntimeOptions,
  toolInput: unknown,
  context: LoadedEvidenceContext,
  decision: "allow" | "deny",
  reason: string | null,
  resolution?: Partial<ResolvedCapabilityInvocation>,
): Record<string, unknown> {
  return {
    timestamp: options.now?.() ?? new Date().toISOString(),
    hookVersion: options.hookVersion ?? "1",
    hookEventName: "PreToolUse",
    toolInputSha256: canonicalSha256(toolInput),
    routeKey: resolution?.routeKey ?? null,
    declaredEffect: resolution?.declaredEffect ?? null,
    effect: resolution?.effect ?? null,
    decision,
    reason,
    manifestSha256: context.manifestSha256,
    manifestSchemaVersion: context.manifestSchemaVersion,
    policySha256: context.policySha256,
    policySchemaVersion: context.policySchemaVersion,
  };
}

export function runClaudeCapabilityPreToolUse(
  input: unknown,
  options: CapabilityHookRuntimeOptions,
): ClaudeHookOutput {
  const event = input as {
    tool_name?: unknown;
    tool_input?: { command?: unknown };
  };
  if (typeof event?.tool_name !== "string") {
    return malformedHookInputOutput(
      "pre-tool-use",
      JSON.stringify(input) ?? String(input),
      options,
    );
  }
  if (event.tool_name !== "Bash") return {};

  const command = event.tool_input?.command;
  if (typeof command !== "string") {
    return malformedHookInputOutput(
      "pre-tool-use",
      JSON.stringify(input) ?? String(input),
      options,
    );
  }
  const bin = options.toolBin ?? "gl-axi";
  if (!commandMentionsTool(command, bin)) {
    return {};
  }

  const context = evidenceContext(options);
  let resolution: ResolvedCapabilityInvocation | undefined;
  let decision: "allow" | "deny";
  let reason: string | null;

  try {
    const invocation = tokenizeToolInvocation(command, bin);
    if (!invocation.argv) {
      throw new CapabilityPolicyError(
        invocation.reason ?? "COMMAND_UNDECOMPOSABLE",
        "The shell command is not one standalone AXI invocation.",
      );
    }
    const bundle = loadVerifiedBundle(options);
    context.manifestSha256 = bundle.manifestSha256;
    context.policySha256 = bundle.policySha256;
    resolution = resolveCapabilityInvocation(bundle.manifest, invocation.argv);
    const evaluated = evaluateCapabilityPolicy(bundle.policy, resolution);
    decision = evaluated.decision;
    reason = evaluated.reason ?? null;
  } catch (error) {
    reason =
      error instanceof CapabilityPolicyError
        ? error.code
        : "CAPABILITY_HOOK_ERROR";
    decision = "deny";
  }

  const record = makeEvidenceRecord(
    options,
    event.tool_input,
    context,
    decision,
    reason,
    resolution,
  );
  if (!appendEvidence(options, record)) {
    return permissionOutput("deny", policyDeniedReason("EVIDENCE_UNWRITABLE"));
  }

  if (decision === "allow" && resolution) {
    return permissionOutput(
      "allow",
      `Capability policy allows ${resolution.routeKey} (${resolution.effect}).`,
    );
  }
  return permissionOutput(
    "deny",
    policyDeniedReason(reason ?? "POLICY_DENIED"),
  );
}

export function runCapabilitySessionStart(
  input: unknown,
  options: CapabilityHookRuntimeOptions,
): ClaudeHookOutput {
  const context = evidenceContext(options);
  let decision: "allow" | "deny" = "deny";
  let reason: string | null = null;
  let toolName = options.toolBin ?? "gl-axi";

  try {
    const bundle = loadVerifiedBundle(options);
    context.manifestSha256 = bundle.manifestSha256;
    context.policySha256 = bundle.policySha256;
    toolName = bundle.manifest.tool.bin;
    decision = "allow";
  } catch (error) {
    reason =
      error instanceof CapabilityPolicyError
        ? error.code
        : "CAPABILITY_HOOK_ERROR";
  }

  const record = {
    timestamp: options.now?.() ?? new Date().toISOString(),
    hookVersion: options.hookVersion ?? "1",
    hookEventName: "SessionStart",
    toolInputSha256: canonicalSha256(input),
    routeKey: null,
    declaredEffect: null,
    effect: null,
    decision,
    reason,
    manifestSha256: context.manifestSha256,
    manifestSchemaVersion: context.manifestSchemaVersion,
    policySha256: context.policySha256,
    policySchemaVersion: context.policySchemaVersion,
  };

  if (!appendEvidence(options, record)) {
    decision = "deny";
    reason = "EVIDENCE_UNWRITABLE";
  }

  const additionalContext =
    decision === "allow"
      ? `AXI capability integrity verified for ${toolName} (manifest ${context.manifestSha256}).`
      : `${policyDeniedReason(reason ?? "INTEGRITY_CHECK_FAILED")} No ${toolName} invocation will be allowed.`;
  return {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext,
    },
  };
}

function malformedHookInputOutput(
  mode: CapabilityHookMode,
  rawInput: string,
  options: CapabilityHookRuntimeOptions,
): ClaudeHookOutput {
  const context = evidenceContext(options);
  let reason = "HOOK_INPUT_INVALID";
  const record = {
    timestamp: options.now?.() ?? new Date().toISOString(),
    hookVersion: options.hookVersion ?? "1",
    hookEventName: mode === "pre-tool-use" ? "PreToolUse" : "SessionStart",
    toolInputSha256: canonicalSha256(rawInput),
    routeKey: null,
    declaredEffect: null,
    effect: null,
    decision: "deny",
    reason,
    manifestSha256: context.manifestSha256,
    manifestSchemaVersion: context.manifestSchemaVersion,
    policySha256: context.policySha256,
    policySchemaVersion: context.policySchemaVersion,
  };
  if (!appendEvidence(options, record)) reason = "EVIDENCE_UNWRITABLE";

  if (mode === "pre-tool-use") {
    return permissionOutput("deny", policyDeniedReason(reason));
  }
  return {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `${policyDeniedReason(reason)} No gl-axi invocation will be allowed.`,
    },
  };
}

export function runCapabilityHookProcess(
  mode: CapabilityHookMode,
  options: CapabilityHookRuntimeOptions,
  io: CapabilityHookProcessIo = {},
): number {
  const rawInput = io.readStdin?.() ?? readFileSync(0, "utf8");
  let output: ClaudeHookOutput;
  try {
    const input = JSON.parse(rawInput) as unknown;
    output =
      mode === "pre-tool-use"
        ? runClaudeCapabilityPreToolUse(input, options)
        : runCapabilitySessionStart(input, options);
  } catch {
    output = malformedHookInputOutput(mode, rawInput, options);
  }

  const serialized = `${JSON.stringify(output)}\n`;
  if (io.writeStdout) io.writeStdout(serialized);
  else process.stdout.write(serialized);
  return 0;
}
