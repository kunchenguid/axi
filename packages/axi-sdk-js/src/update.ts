import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { AxiError } from "./errors.js";
import type { AxiRenderable } from "./output.js";

const execFileAsync = promisify(execFile);

const REGISTRY_BASE = "https://registry.npmjs.org";

/**
 * Minimal `fetch`-like shape so registry lookups stay decoupled from the global
 * `fetch` typings and trivially mockable in tests.
 */
export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

/** Parse a semver string. Returns `null` when the version is not valid semver. */
export function parseSemver(version: string): ParsedSemver | null {
  const match =
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?(?:\+[0-9A-Za-z-.]+)?$/.exec(
      version.trim(),
    );
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function comparePrerelease(a: string[], b: string[]): number {
  // A version without prerelease identifiers is greater than one with them.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (index >= a.length) return -1;
    if (index >= b.length) return 1;

    const left = a[index];
    const right = b[index];
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);

    if (leftNumeric && rightNumeric) {
      const delta = Number(left) - Number(right);
      if (delta !== 0) return delta < 0 ? -1 : 1;
    } else if (leftNumeric) {
      return -1;
    } else if (rightNumeric) {
      return 1;
    } else if (left !== right) {
      return left < right ? -1 : 1;
    }
  }

  return 0;
}

/**
 * Compare two semver strings. Returns -1, 0, or 1. Unparseable versions fall
 * back to a deterministic lexical comparison so the caller never throws.
 */
export function compareSemver(a: string, b: string): number {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);

  if (!parsedA || !parsedB) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }

  if (parsedA.major !== parsedB.major) {
    return parsedA.major < parsedB.major ? -1 : 1;
  }
  if (parsedA.minor !== parsedB.minor) {
    return parsedA.minor < parsedB.minor ? -1 : 1;
  }
  if (parsedA.patch !== parsedB.patch) {
    return parsedA.patch < parsedB.patch ? -1 : 1;
  }

  return comparePrerelease(parsedA.prerelease, parsedB.prerelease);
}

/** True when `latest` is a strictly newer version than `current`. */
export function isUpdateAvailable(current: string, latest: string): boolean {
  return compareSemver(latest, current) > 0;
}

export interface PackageIdentity {
  packageName?: string;
  version?: string;
  packageJsonPath?: string;
}

export interface IdentityFs {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: "utf-8") => string;
}

const nodeFs: IdentityFs = {
  existsSync,
  readFileSync: (path, encoding) => readFileSync(path, encoding),
};

/**
 * Walk up from `startPath` to the nearest `package.json` that declares a name,
 * returning the tool's npm package name and version. This is how a tool gains
 * `update` with zero per-tool wiring: its own published `package.json` ships
 * inside the install tree next to the running entrypoint.
 */
export function readNearestPackageJson(
  startPath: string,
  fs: IdentityFs = nodeFs,
): PackageIdentity {
  let dir = dirname(startPath);
  let previous = "";

  while (dir !== previous) {
    const packageJsonPath = join(dir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const parsed = JSON.parse(
          fs.readFileSync(packageJsonPath, "utf-8"),
        ) as {
          name?: unknown;
          version?: unknown;
        };
        if (typeof parsed.name === "string" && parsed.name.length > 0) {
          return {
            packageName: parsed.name,
            version:
              typeof parsed.version === "string" ? parsed.version : undefined,
            packageJsonPath,
          };
        }
      } catch {
        // Malformed package.json: keep walking upward.
      }
    }

    previous = dir;
    dir = dirname(dir);
  }

  return {};
}

export type InstallMethod =
  | { kind: "npm-global" }
  | { kind: "pnpm-global" }
  | { kind: "homebrew"; formula: string | null }
  | { kind: "npx" }
  | { kind: "unknown" };

/**
 * Infer how the running tool was installed from its realpath-resolved entry and
 * the environment. Order matters: ephemeral caches and Homebrew Cellars are
 * checked before the generic global-install layouts they can contain.
 */
export function detectInstallMethod(options: {
  entry: string;
  env?: NodeJS.ProcessEnv;
}): InstallMethod {
  const env = options.env ?? process.env;
  const path = options.entry.replaceAll("\\", "/");

  // npx / ephemeral runner caches: nothing is persistently installed.
  if (
    path.includes("/_npx/") ||
    /\/dlx-[^/]+\//.test(path) ||
    path.includes("/pnpm/dlx/") ||
    path.includes("/bun/install/cache/")
  ) {
    return { kind: "npx" };
  }

  // Homebrew formula: the Cellar segment names the formula.
  const cellar = path.match(/\/Cellar\/([^/]+)\//);
  if (cellar) {
    return { kind: "homebrew", formula: cellar[1] };
  }

  // pnpm global store (virtual store + global root, or PNPM_HOME).
  const pnpmHome = env.PNPM_HOME?.replaceAll("\\", "/");
  if (
    path.includes("/pnpm/global/") ||
    path.includes("/pnpm-global/") ||
    path.includes("/.pnpm/") ||
    /\/Library\/pnpm\//.test(path) ||
    (pnpmHome && pnpmHome.length > 0 && path.startsWith(pnpmHome))
  ) {
    return { kind: "pnpm-global" };
  }

  // npm global (also covers npm-installed-under-Homebrew-node).
  if (path.includes("/lib/node_modules/")) {
    return { kind: "npm-global" };
  }

  return { kind: "unknown" };
}

export interface UpgradePlan {
  method: InstallMethod["kind"];
  /** Human-readable command, used both for announcing and print-only output. */
  command: string;
  /** Spawn argv, or `null` when the upgrade must not be run automatically. */
  argv: string[] | null;
  /** Why the plan is print-only, when applicable. */
  note?: string;
}

/** Map a detected install method to the exact upgrade command for it. */
export function planUpgrade(
  method: InstallMethod,
  packageName: string,
): UpgradePlan {
  switch (method.kind) {
    case "npm-global":
      return {
        method: method.kind,
        command: `npm install -g ${packageName}@latest`,
        argv: ["npm", "install", "-g", `${packageName}@latest`],
      };
    case "pnpm-global":
      return {
        method: method.kind,
        command: `pnpm add -g ${packageName}@latest`,
        argv: ["pnpm", "add", "-g", `${packageName}@latest`],
      };
    case "homebrew":
      if (method.formula) {
        return {
          method: method.kind,
          command: `brew upgrade ${method.formula}`,
          argv: ["brew", "upgrade", method.formula],
        };
      }
      return {
        method: method.kind,
        command: `brew upgrade ${packageName}`,
        argv: null,
        note: "Could not determine the Homebrew formula automatically",
      };
    case "npx":
      return {
        method: method.kind,
        command: `npx -y ${packageName}@latest`,
        argv: null,
        note: "npx always runs the latest published version, so no install is needed",
      };
    case "unknown":
      return {
        method: method.kind,
        command: `npm install -g ${packageName}@latest`,
        argv: null,
        note: "Could not determine how this tool was installed",
      };
  }
}

async function npmViewVersion(packageName: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "npm",
      ["view", packageName, "version"],
      { timeout: 20_000 },
    );
    const version = stdout.trim();
    return version.length > 0 ? version : null;
  } catch {
    return null;
  }
}

function registryPath(packageName: string): string {
  // Scoped names encode only the slash; the registry expects a literal `@`.
  return packageName.startsWith("@")
    ? packageName.replace("/", "%2f")
    : packageName;
}

function notPublishedError(packageName: string): AxiError {
  return new AxiError(
    `${packageName} is not published to the npm registry`,
    "UPDATE_ERROR",
    [
      "Confirm the package name is correct",
      `Run \`npm view ${packageName} version\` to check manually`,
    ],
  );
}

export interface FetchLatestOptions {
  fetchImpl?: FetchLike | null;
  npmView?: (packageName: string) => Promise<string | null>;
}

/**
 * Resolve the latest published version. Prefers the registry HTTP endpoint and
 * falls back to `npm view`. Network, registry, and not-found failures surface as
 * `AxiError` with actionable suggestions, never a raw stack trace.
 */
export async function fetchLatestVersion(
  packageName: string,
  options: FetchLatestOptions = {},
): Promise<string> {
  const fetchImpl =
    options.fetchImpl === undefined
      ? (globalThis.fetch as unknown as FetchLike | undefined)
      : (options.fetchImpl ?? undefined);

  if (typeof fetchImpl === "function") {
    try {
      const response = await fetchImpl(
        `${REGISTRY_BASE}/${registryPath(packageName)}/latest`,
        { headers: { accept: "application/json" } },
      );
      if (response.ok) {
        const data = (await response.json()) as { version?: unknown };
        if (typeof data.version === "string" && data.version.length > 0) {
          return data.version;
        }
      } else if (response.status === 404) {
        throw notPublishedError(packageName);
      }
    } catch (error) {
      if (error instanceof AxiError) {
        throw error;
      }
      // Network/parse failure: fall through to the npm CLI fallback.
    }
  }

  const viewed = await (options.npmView ?? npmViewVersion)(packageName);
  if (viewed) {
    return viewed;
  }

  throw new AxiError(
    `Could not reach the npm registry to check for updates to ${packageName}`,
    "UPDATE_ERROR",
    [
      "Check your network connection and try again",
      `Run \`npm view ${packageName} version\` to check manually`,
    ],
  );
}

export interface InstallResult {
  ok: boolean;
  message?: string;
}

async function defaultRunInstall(
  plan: UpgradePlan,
  stdout: { write: (chunk: string) => unknown },
): Promise<InstallResult> {
  const argv = plan.argv;
  if (!argv || argv.length === 0) {
    return { ok: false, message: "No runnable upgrade command" };
  }

  // Announce the command, then stream the installer's output straight through.
  stdout.write(`running: ${plan.command}\n`);

  return new Promise<InstallResult>((resolve) => {
    const [command, ...args] = argv;
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    child.on("error", (error) => {
      resolve({ ok: false, message: error.message });
    });
    child.on("close", (code) => {
      resolve(
        code === 0
          ? { ok: true }
          : { ok: false, message: `${plan.command} exited with code ${code}` },
      );
    });
  });
}

function binNameFromArgv(invokedAs: string | undefined): string {
  return basename(invokedAs ?? "tool") || "tool";
}

function resolveEntry(
  invokedAs: string | undefined,
  realpath: (path: string) => string,
): string | undefined {
  if (!invokedAs) {
    return undefined;
  }
  try {
    return realpath(invokedAs);
  } catch {
    return invokedAs;
  }
}

export interface RunUpdateOptions {
  /** Args after the `update` command (e.g. `["--check"]`). */
  args: string[];
  stdout: { write: (chunk: string) => unknown };
  /** Explicit npm package name override (escape hatch). */
  packageName?: string;
  /** Current version, normally `options.version` from `runAxiCli`. */
  version?: string;

  // Injectable seams (default to real implementations).
  invokedAs?: string;
  env?: NodeJS.ProcessEnv;
  realpath?: (path: string) => string;
  fs?: IdentityFs;
  fetchLatest?: (packageName: string) => Promise<string>;
  runInstall?: (
    plan: UpgradePlan,
    stdout: { write: (chunk: string) => unknown },
  ) => Promise<InstallResult>;
}

function isCheckOnly(args: string[]): boolean {
  return args.includes("--check") || args.includes("--dry-run");
}

/**
 * Execute the built-in `update` flow: resolve identity, query the registry,
 * compare versions, and (unless `--check`) upgrade via the detected install
 * method. Returns the renderable result; throws `AxiError` on failure.
 */
export async function runUpdate(
  options: RunUpdateOptions,
): Promise<AxiRenderable> {
  const checkOnly = isCheckOnly(options.args);
  const invokedAs = options.invokedAs ?? process.argv[1];
  const binName = binNameFromArgv(invokedAs);
  const realpath = options.realpath ?? ((path: string) => realpathSync(path));
  const entry = resolveEntry(invokedAs, realpath);

  const fromPackageJson = entry
    ? readNearestPackageJson(entry, options.fs ?? nodeFs)
    : {};
  const packageName = options.packageName ?? fromPackageJson.packageName;
  const current = options.version ?? fromPackageJson.version;

  if (!packageName) {
    throw new AxiError(
      "Could not determine the package name to update",
      "UPDATE_ERROR",
      [
        "Reinstall the tool from npm so its package.json is available",
        "Tool authors can pass `packageName` to runAxiCli()",
      ],
    );
  }

  if (!current) {
    throw new AxiError(
      `Could not determine the current version of ${packageName}`,
      "UPDATE_ERROR",
      [
        "Reinstall the tool from npm so its version is available",
        "Tool authors can pass `version` to runAxiCli()",
      ],
    );
  }

  const fetchLatest =
    options.fetchLatest ?? ((name: string) => fetchLatestVersion(name));
  const latest = await fetchLatest(packageName);
  const available = isUpdateAvailable(current, latest);

  if (checkOnly) {
    const output: AxiRenderable = {
      update: { package: packageName, current, latest, available },
    };
    if (available) {
      output.help = [`Run \`${binName} update\` to upgrade`];
    }
    return output;
  }

  if (!available) {
    return {
      update: `${packageName} is already on the latest version (${current})`,
    };
  }

  const method: InstallMethod = entry
    ? detectInstallMethod({ entry, env: options.env })
    : { kind: "unknown" };
  const plan = planUpgrade(method, packageName);

  if (!plan.argv) {
    const help =
      method.kind === "npx"
        ? `Re-run with \`${plan.command}\` to use the latest version`
        : `Run \`${plan.command}\` to upgrade`;
    return {
      update: {
        package: packageName,
        current,
        latest,
        available: true,
        action: "manual",
        ...(plan.note ? { reason: plan.note } : {}),
        run: plan.command,
      },
      help: [help],
    };
  }

  const runInstall = options.runInstall ?? defaultRunInstall;
  const result = await runInstall(plan, options.stdout);
  if (!result.ok) {
    throw new AxiError(`Failed to upgrade ${packageName}`, "UPDATE_ERROR", [
      `Run \`${plan.command}\` manually`,
      ...(result.message ? [result.message] : []),
    ]);
  }

  return {
    update: `${packageName} upgraded ${current} -> ${latest}`,
    command: plan.command,
  };
}
