import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";

export interface HookEntry {
  type?: string;
  command?: string;
  timeout?: number;
}

export interface HookGroup {
  matcher?: string | null;
  hooks?: HookEntry[];
}

export interface HookSettings {
  hooks?: {
    SessionStart?: HookGroup[];
    session_start?: HookEntry[];
    [event: string]: HookGroup[] | HookEntry[] | undefined;
  };
  [key: string]: unknown;
}

export interface ManagedHookSpec {
  marker: string;
  command: string;
  timeoutSeconds?: number;
}

export interface NodeAxiExecPathPolicy {
  marker: string;
  binaryNames?: string[];
  distEntrypoints?: string[];
}

export interface InstallSessionStartHooksOptions {
  marker?: string;
  execPath?: string;
  binaryNames?: string[];
  distEntrypoints?: string[];
  timeoutSeconds?: number;
  homeDir?: string;
  shouldInstall?: (execPath: string) => boolean;
  onError?: (message: string) => void;
}

const OPENCODE_PLUGIN_MANAGED_PREFIX = "axi-sdk-js managed opencode plugin:";

export interface PortableHookCommandContext {
  pathEntries: string[];
  pathExtensions: string[];
  resolveRealPath: (absolutePath: string) => string | undefined;
  resolveShimTarget?: (shimPath: string) => string | undefined;
}

function isManagedHook(hook: HookEntry | undefined, marker: string): boolean {
  return typeof hook?.command === "string" && hook.command.includes(marker);
}

export function computeSessionStartHookUpdate(
  settings: HookSettings,
  spec: ManagedHookSpec,
): [HookSettings, boolean] {
  const updated = structuredClone(settings);
  let changed = false;

  if (!updated.hooks) {
    updated.hooks = {};
    changed = true;
  }

  if (Array.isArray(updated.hooks.session_start)) {
    const legacyHooks = updated.hooks.session_start.filter(
      (hook) => !isManagedHook(hook, spec.marker),
    );

    if (legacyHooks.length !== updated.hooks.session_start.length) {
      changed = true;
      if (legacyHooks.length === 0) {
        delete updated.hooks.session_start;
      } else {
        updated.hooks.session_start = legacyHooks;
      }
    }
  }

  if (!Array.isArray(updated.hooks.SessionStart)) {
    updated.hooks.SessionStart = [];
    changed = true;
  }

  for (const group of updated.hooks.SessionStart) {
    if (!Array.isArray(group.hooks)) {
      continue;
    }

    for (const hook of group.hooks) {
      if (!isManagedHook(hook, spec.marker)) {
        continue;
      }

      const timeout = spec.timeoutSeconds ?? 10;
      const isCorrect =
        hook.command === spec.command &&
        hook.type === "command" &&
        hook.timeout === timeout;

      if (isCorrect && !changed) {
        return [settings, false];
      }

      hook.command = spec.command;
      hook.type = "command";
      hook.timeout = timeout;
      return [updated, true];
    }
  }

  updated.hooks.SessionStart.push({
    matcher: "",
    hooks: [
      {
        type: "command",
        command: spec.command,
        timeout: spec.timeoutSeconds ?? 10,
      },
    ],
  });

  return [updated, true];
}

export function computeCodexConfigUpdate(content: string): [string, boolean] {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const normalized = content.length === 0 ? "" : content;

  if (normalized.trim().length === 0) {
    return [`[features]${newline}hooks = true${newline}`, true];
  }

  const lines = normalized.split(/\r?\n/);
  const updated = [...lines];
  let inFeatures = false;
  let sawFeatures = false;

  for (let index = 0; index < updated.length; index++) {
    const line = updated[index];
    const section = line.match(/^\s*(\[{1,2})([^\]]+)(\]{1,2})\s*(?:#.*)?$/);

    if (section) {
      const isTableHeader =
        (section[1] === "[" && section[3] === "]") ||
        (section[1] === "[[" && section[3] === "]]");
      if (!isTableHeader) {
        continue;
      }

      const sectionName = section[2].trim();
      if (inFeatures) {
        updated.splice(index, 0, "hooks = true");
        return [updated.join(newline), true];
      }

      inFeatures = sectionName === "features";
      sawFeatures ||= inFeatures;
      continue;
    }

    if (!inFeatures) {
      continue;
    }

    const flag = line.match(/^\s*hooks\s*=\s*(true|false)\s*(?:#.*)?$/);
    if (!flag) {
      continue;
    }

    if (flag[1] === "true") {
      return [content, false];
    }

    updated[index] = line.replace(/false/, "true");
    return [updated.join(newline), true];
  }

  if (sawFeatures) {
    const suffix = normalized.endsWith(newline) ? "" : newline;
    return [`${normalized}${suffix}hooks = true${newline}`, true];
  }

  const separator = normalized.endsWith(newline)
    ? newline
    : `${newline}${newline}`;
  return [
    `${normalized}${separator}[features]${newline}hooks = true${newline}`,
    true,
  ];
}

function sanitizeOpenCodePluginFilePart(marker: string): string {
  return marker.replace(/[^A-Za-z0-9._-]+/g, "_");
}

function sanitizeOpenCodeExportName(marker: string): string {
  const name = marker
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");

  return `Axi${name || "Plugin"}AmbientContextPlugin`;
}

function buildOpenCodeAmbientPluginSource(
  marker: string,
  command: string,
  timeoutSeconds: number,
): string {
  const exportName = sanitizeOpenCodeExportName(marker);
  const managedMarker = `${OPENCODE_PLUGIN_MANAGED_PREFIX} ${marker}`;

  return `// ${managedMarker}
// This file is generated by axi-sdk-js. It is safe to edit only if you remove the managed marker above.
import { spawn } from "node:child_process";

const command = ${JSON.stringify(command)};
const marker = ${JSON.stringify(marker)};
const ambientHeader = ${JSON.stringify(`## AXI ambient context: ${marker}`)};
const timeoutMs = ${JSON.stringify(timeoutSeconds * 1000)};

function runAxiHomeView(cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, [], {
      cwd: directoryOrFallback(cwd),
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve("error: " + marker + " ambient context timed out after " + timeoutMs + "ms");
    }, timeoutMs);

    child.stdout?.setEncoding("utf-8");
    child.stderr?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve("error: " + marker + " ambient context failed: " + error.message);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      const message = (stderr || stdout || marker + " exited with code " + code).trim();
      resolve("error: " + marker + " ambient context failed: " + message);
    });
  });
}

function directoryOrFallback(directory) {
  return typeof directory === "string" && directory.length > 0
    ? directory
    : process.cwd();
}

export const ${exportName} = async ({ directory }) => {
  const sessionCache = new Map();

  return {
    "experimental.chat.system.transform": async (input, output) => {
      const sessionID = input.sessionID ?? "__global__";
      let homeView = sessionCache.get(sessionID);
      if (homeView === undefined) {
        homeView = await runAxiHomeView(directory);
        sessionCache.set(sessionID, homeView);
      }

      if (homeView.length === 0) return;
      output.system.push(ambientHeader + "\\n" + homeView);
    },
  };
};
`;
}

function installOpenCodeAmbientPlugin(
  home: string,
  marker: string,
  command: string,
  timeoutSeconds: number,
  onError?: (message: string) => void,
): void {
  const pluginPath = join(
    home,
    ".config",
    "opencode",
    "plugins",
    `axi-${sanitizeOpenCodePluginFilePart(marker)}.js`,
  );
  const managedMarker = `${OPENCODE_PLUGIN_MANAGED_PREFIX} ${marker}`;
  const next = buildOpenCodeAmbientPluginSource(
    marker,
    command,
    timeoutSeconds,
  );

  try {
    mkdirSync(dirname(pluginPath), { recursive: true });
    const current = existsSync(pluginPath)
      ? readFileSync(pluginPath, "utf-8")
      : undefined;

    if (current !== undefined && !current.includes(managedMarker)) {
      onError?.(
        `${pluginPath}: refusing to overwrite unmanaged OpenCode plugin`,
      );
      return;
    }

    if (current !== next) {
      writeFileSync(pluginPath, next, "utf-8");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onError?.(`${pluginPath}: ${message}`);
  }
}

export function resolvePortableHookCommand(
  execPath: string,
  binaryNames: string[],
  marker: string,
  context: PortableHookCommandContext,
): string {
  if (binaryNames.length === 0) {
    return execPath;
  }

  const resolvedExec = context.resolveRealPath(execPath);
  if (!resolvedExec) {
    return execPath;
  }

  for (const name of binaryNames) {
    if (!name.includes(marker)) {
      continue;
    }
    for (const dir of context.pathEntries) {
      if (!dir) continue;
      for (const ext of context.pathExtensions) {
        const candidate = join(dir, `${name}${ext}`);
        const resolvedCandidate = context.resolveRealPath(candidate);
        if (resolvedCandidate && resolvedCandidate === resolvedExec) {
          return name;
        }

        // npm global bins on Windows are wrapper shims, not symlinks, so the
        // realpath check above never matches. Parse the shim to recover the
        // script it ultimately runs and compare that instead.
        const shimTarget = context.resolveShimTarget?.(candidate);
        if (shimTarget && shimTarget === resolvedExec) {
          return name;
        }
      }
    }
  }

  return execPath;
}

const NPM_SHIM_SCRIPT_PATTERNS = [
  // Git Bash / POSIX shim: exec node "$basedir/node_modules/<pkg>/.../cli.js"
  /"\$basedir\/([^"]+\.[cm]?js)"/,
  // Windows .cmd shim: "%dp0%\node_modules\<pkg>\...\cli.js"
  /%~?dp0%?[\\/]([^"\r\n]+\.[cm]?js)/i,
];

export function extractNpmShimScriptPath(content: string): string | undefined {
  for (const pattern of NPM_SHIM_SCRIPT_PATTERNS) {
    const match = content.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

function buildDefaultPortableCommandContext(): PortableHookCommandContext {
  const rawPath = process.env.PATH ?? process.env.Path ?? "";
  const pathEntries = rawPath.split(delimiter).filter(Boolean);
  const pathExtensions =
    process.platform === "win32"
      ? // Git Bash resolves the extensionless shim, which PATHEXT omits.
        ["", ...(process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")]
      : [""];
  return {
    pathEntries,
    pathExtensions,
    resolveRealPath: (absolutePath) => {
      try {
        const stat = statSync(absolutePath);
        if (!stat.isFile()) {
          return undefined;
        }
        return realpathSync(absolutePath);
      } catch {
        return undefined;
      }
    },
    resolveShimTarget: (shimPath) => {
      try {
        const relative = extractNpmShimScriptPath(
          readFileSync(shimPath, "utf-8"),
        );
        if (!relative) {
          return undefined;
        }
        return realpathSync(resolve(dirname(shimPath), relative));
      } catch {
        return undefined;
      }
    },
  };
}

export function shouldInstallHooksForNodeAxiExecPath(
  execPath: string,
  policy: NodeAxiExecPathPolicy,
): boolean {
  const normalized = resolve(execPath).replaceAll("\\", "/");
  if (!normalized.includes(policy.marker) || normalized.endsWith(".ts")) {
    return false;
  }

  const fileName = basename(normalized);
  if (policy.binaryNames?.includes(fileName)) {
    return true;
  }

  return (
    policy.distEntrypoints?.some((entrypoint) =>
      normalized.endsWith(entrypoint.replaceAll("\\", "/")),
    ) ?? false
  );
}

interface InferredHookOptions {
  execPath: string;
  marker: string;
  binaryNames: string[];
  distEntrypoints: string[];
}

function inferHookOptions(
  execPath: string | undefined,
): InferredHookOptions | undefined {
  if (!execPath) {
    return undefined;
  }

  const normalized = execPath.replaceAll("\\", "/");
  const match = normalized.match(/(?:^|\/)dist\/bin\/([^/]+)\.js$/);
  if (match?.[1]) {
    const marker = match[1];
    return {
      execPath,
      marker,
      binaryNames: [marker],
      distEntrypoints: [`dist/bin/${marker}.js`],
    };
  }

  const fileName = normalized.split("/").pop() ?? "";
  if (!fileName || fileName.includes(".") || fileName === "node") {
    return undefined;
  }

  return {
    execPath,
    marker: fileName,
    binaryNames: [fileName],
    distEntrypoints: [`dist/bin/${fileName}.js`],
  };
}

function buildInferredHookInstallPolicy(
  marker: string,
  options: InstallSessionStartHooksOptions,
  inferred: InferredHookOptions,
): (execPath: string) => boolean {
  const binaryNames = options.binaryNames ?? inferred.binaryNames;
  const distEntrypoints = options.distEntrypoints ?? inferred.distEntrypoints;

  return (execPath: string) =>
    shouldInstallHooksForNodeAxiExecPath(execPath, {
      marker,
      binaryNames,
      distEntrypoints,
    });
}

export function installSessionStartHooks(
  options: InstallSessionStartHooksOptions = {},
): void {
  const inferred = inferHookOptions(options.execPath ?? process.argv[1]);
  const marker = options.marker ?? inferred?.marker;
  if (!marker) {
    return;
  }

  const execPath = resolve(
    options.execPath ?? inferred?.execPath ?? process.argv[1] ?? "",
  );
  if (!execPath) {
    return;
  }

  const defaultPolicyOptions = inferred ?? {
    execPath,
    marker,
    binaryNames: [marker],
    distEntrypoints: [`dist/bin/${marker}.js`],
  };
  const shouldInstall =
    options.shouldInstall ??
    buildInferredHookInstallPolicy(marker, options, defaultPolicyOptions);
  if (shouldInstall && !shouldInstall(execPath)) {
    return;
  }

  const binaryNames = options.binaryNames ?? inferred?.binaryNames ?? [];

  const command = resolvePortableHookCommand(
    execPath,
    binaryNames,
    marker,
    buildDefaultPortableCommandContext(),
  );

  const home = options.homeDir ?? homedir();
  const jsonTargets = [
    join(home, ".claude", "settings.json"),
    join(home, ".codex", "hooks.json"),
  ];
  const codexConfigPath = join(home, ".codex", "config.toml");

  installOpenCodeAmbientPlugin(
    home,
    marker,
    command,
    options.timeoutSeconds ?? 10,
    options.onError,
  );

  for (const target of jsonTargets) {
    try {
      mkdirSync(dirname(target), { recursive: true });
      const current = existsSync(target)
        ? (JSON.parse(readFileSync(target, "utf-8")) as HookSettings)
        : {};
      const [updated, changed] = computeSessionStartHookUpdate(current, {
        marker,
        command,
        timeoutSeconds: options.timeoutSeconds,
      });

      if (changed) {
        writeFileSync(target, `${JSON.stringify(updated, null, 2)}\n`, "utf-8");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.onError?.(`${target}: ${message}`);
    }
  }

  try {
    mkdirSync(dirname(codexConfigPath), { recursive: true });
    const current = existsSync(codexConfigPath)
      ? readFileSync(codexConfigPath, "utf-8")
      : "";
    const [updated, changed] = computeCodexConfigUpdate(current);

    if (changed) {
      writeFileSync(codexConfigPath, updated, "utf-8");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.onError?.(`${codexConfigPath}: ${message}`);
  }
}
