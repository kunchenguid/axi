import { execFile, spawn, spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { basename, delimiter, dirname, join, win32 } from "node:path";
import { promisify } from "node:util";
import { AxiError } from "./errors.js";
import { collapseHomeDirectory, type AxiRenderable } from "./output.js";

const execFileAsync = promisify(execFile);

const REGISTRY_BASE = "https://registry.npmjs.org";
const REGISTRY_FETCH_TIMEOUT_MS = 20_000;

/**
 * Minimal `fetch`-like shape so registry lookups stay decoupled from the global
 * `fetch` typings and trivially mockable in tests.
 */
export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/** Structured semver components returned by `parseSemver()`. */
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

/** Package metadata resolved from the nearest named `package.json`. */
export interface PackageIdentity {
  /** npm package name, when a named package.json was found. */
  packageName?: string;
  /** package.json version, when declared. */
  version?: string;
  /** Absolute path to the package.json that supplied the identity. */
  packageJsonPath?: string;
}

/** Small filesystem seam used by updater tests and custom embedders. */
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

/** Node version managers whose own npm owns a global install. */
export type NodeVersionManager = "nvm" | "fnm" | "asdf" | "mise" | "volta";

/** System package databases that can own a file under `/usr`. */
export type SystemPackageManager = "dpkg" | "rpm" | "pacman" | "apk";

/** Package managers that can own a project-local dependency. */
export type ProjectPackageManager = "npm" | "pnpm" | "yarn" | "bun";

/** Installation source inferred from the realpath-resolved CLI entrypoint. */
export type InstallMethod =
  | { kind: "npm-global" }
  | { kind: "pnpm-global" }
  | { kind: "yarn-global" }
  | { kind: "bun-global" }
  | { kind: "homebrew"; formula: string | null }
  | { kind: "volta" }
  | {
      kind: "node-version-manager";
      manager: NodeVersionManager;
      /** Absolute path to the npm that belongs to the running Node. */
      npm: string;
    }
  | { kind: "mise-npm-backend" }
  | { kind: "nix" }
  | { kind: "system-package"; manager: SystemPackageManager; package: string }
  | { kind: "system-package-unverified" }
  | {
      kind: "project-local";
      project: string;
      packageManager: ProjectPackageManager;
      declaresPackage: boolean;
    }
  | {
      kind: "read-only";
      /** Package directory the current user cannot write. */
      path: string;
      /** Manager that would otherwise have run the upgrade. */
      manager: string;
    }
  | { kind: "npx" }
  | { kind: "unknown" };

/** Result of a synchronous package-database query used during detection. */
export interface ExecSyncResult {
  /** Exit status, or `null` when the command could not start or was killed. */
  status: number | null;
  stdout: string;
  /** True when the query executable is absent, so ownership could not be verified. */
  unavailable?: boolean;
}

/** Runs an argv synchronously; used to ask system package databases who owns a file. */
export type ExecSyncLike = (
  argv: string[],
  timeoutMs: number,
) => ExecSyncResult;

const PACKAGE_QUERY_TIMEOUT_MS = 5_000;

const defaultExecSync: ExecSyncLike = ([command, ...args], timeoutMs) => {
  if (!command) {
    return { status: null, stdout: "" };
  }
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: timeoutMs,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    ...((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
      ? { unavailable: true }
      : {}),
  };
};

function defaultRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Options for `detectInstallMethod()`. */
export interface DetectInstallMethodOptions {
  /** Realpath-resolved CLI entrypoint. */
  entry: string;
  env?: NodeJS.ProcessEnv;
  /** npm package name; enables project-local detection. */
  packageName?: string;
  /** Filesystem seam for lockfile, package.json, and package-database checks. */
  fs?: IdentityFs;
  /** Package-database query seam. Defaults to a synchronous child process. */
  exec?: ExecSyncLike;
  /** Canonicalizes configured roots (for example `/tmp` -> `/private/tmp`). */
  realpath?: (path: string) => string;
}

/**
 * Infer who manages the running tool from its realpath-resolved entry and the
 * environment. Order matters: immutable stores, ephemeral caches, and Homebrew
 * Cellars are checked before the generic global-install layouts they can
 * contain, and version-manager Node installs before plain npm globals.
 */
export function detectInstallMethod(
  options: DetectInstallMethodOptions,
): InstallMethod {
  const env = options.env ?? process.env;
  const fs = options.fs ?? nodeFs;
  const realpath = options.realpath ?? defaultRealpath;
  const root = (value: string | undefined) => {
    const normalized = normalizePathRoot(value);
    return normalized ? normalizePathRoot(realpath(normalized)) : undefined;
  };
  const path = options.entry.replaceAll("\\", "/");
  const home = root(env.HOME ?? env.USERPROFILE);

  if (path.startsWith("/nix/store/")) {
    return { kind: "nix" };
  }

  // npx / ephemeral runner caches: nothing is persistently installed.
  if (
    path.includes("/_npx/") ||
    path.includes("/_dlx/") ||
    /\/dlx-[^/]+\//.test(path) ||
    path.includes("/pnpm/dlx/") ||
    path.includes("/bun/install/cache/") ||
    /\/bunx-[^/]+\//.test(path)
  ) {
    return { kind: "npx" };
  }

  const homebrewFormula = homebrewFormulaFromPath(path, env, root);
  if (homebrewFormula) {
    return { kind: "homebrew", formula: homebrewFormula };
  }

  const voltaHome = root(env.VOLTA_HOME) ?? (home && `${home}/.volta`);
  if (
    isPathInsideRoot(path, voltaHome && `${voltaHome}/tools/image/packages`)
  ) {
    return { kind: "volta" };
  }

  const versionManager = versionManagerInstall(path, env, home, root);
  if (versionManager) {
    return versionManager;
  }

  const miseData =
    root(env.MISE_DATA_DIR) ?? (home && `${home}/.local/share/mise`);
  if (
    isPathInsideRoot(path, miseData && `${miseData}/installs`) &&
    path.slice(`${miseData}/installs/`.length).startsWith("npm-")
  ) {
    return { kind: "mise-npm-backend" };
  }

  const pnpmHome = root(env.PNPM_HOME);
  if (
    isPathInsideRoot(path, pnpmHome) ||
    isKnownPnpmGlobalStore(path, env, root)
  ) {
    return { kind: "pnpm-global" };
  }

  const yarnRoots = [
    home && `${home}/.config/yarn/global/node_modules`,
    root(env.LOCALAPPDATA) && `${root(env.LOCALAPPDATA)}/Yarn/Data/global`,
  ];
  if (yarnRoots.some((yarnRoot) => isPathInsideRoot(path, yarnRoot))) {
    return { kind: "yarn-global" };
  }

  const bunInstall = root(env.BUN_INSTALL) ?? (home && `${home}/.bun`);
  if (isPathInsideRoot(path, bunInstall && `${bunInstall}/install/global`)) {
    return { kind: "bun-global" };
  }

  // `/usr/lib/node_modules` is also npm's prefix on many distros, so only a
  // package database that claims the file makes it a system package.
  const systemPackage = systemPackageOwner(
    path,
    fs,
    options.exec ?? defaultExecSync,
  );
  if (systemPackage) {
    return systemPackage;
  }

  // npm global (also covers npm-installed-under-Homebrew-node).
  if (
    npmGlobalNodeModulesRoots(env, root).some((npmRoot) =>
      isPathInsideRoot(path, npmRoot),
    )
  ) {
    return { kind: "npm-global" };
  }

  if (options.packageName) {
    const projectLocal = projectLocalInstall(path, options.packageName, fs);
    if (projectLocal) {
      return projectLocal;
    }
  }

  return { kind: "unknown" };
}

function normalizePathRoot(path: string | undefined): string | undefined {
  const normalized = path?.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function isPathInsideRoot(
  path: string,
  root: string | undefined | null | false | "",
): boolean {
  return Boolean(root) && (path === root || path.startsWith(`${root}/`));
}

function homebrewFormulaFromPath(
  path: string,
  env: NodeJS.ProcessEnv,
  root: (value: string | undefined) => string | undefined,
): string | null {
  for (const cellar of homebrewCellarRoots(env, root)) {
    if (!isPathInsideRoot(path, cellar)) {
      continue;
    }

    const relative = path.slice(cellar.length).replace(/^\/+/, "");
    const formula = relative.split("/")[0];
    if (formula) {
      return formula;
    }
  }

  return null;
}

function homebrewCellarRoots(
  env: NodeJS.ProcessEnv,
  root: (value: string | undefined) => string | undefined,
): string[] {
  const roots: string[] = [];
  const explicitCellar = root(env.HOMEBREW_CELLAR);
  if (explicitCellar) {
    roots.push(explicitCellar);
  }

  const prefixes = [
    root(env.HOMEBREW_PREFIX),
    "/opt/homebrew",
    "/usr/local",
    "/home/linuxbrew/.linuxbrew",
  ];
  for (const prefix of prefixes) {
    if (prefix) {
      roots.push(`${prefix}/Cellar`);
    }
  }

  return [...new Set(roots)];
}

function isKnownPnpmGlobalStore(
  path: string,
  env: NodeJS.ProcessEnv,
  canonical: (value: string | undefined) => string | undefined,
): boolean {
  return pnpmGlobalStoreRoots(env, canonical).some((root) => {
    if (!isPathInsideRoot(path, root)) {
      return false;
    }

    const relative = path.slice(root.length).replace(/^\/+/, "");
    return /^\d+\/\.pnpm\//.test(relative);
  });
}

function pnpmGlobalStoreRoots(
  env: NodeJS.ProcessEnv,
  canonical: (value: string | undefined) => string | undefined,
): string[] {
  const roots: string[] = [];
  const home = canonical(env.HOME ?? env.USERPROFILE);
  if (home) {
    roots.push(`${home}/Library/pnpm/global`);
    roots.push(`${home}/.local/share/pnpm/global`);
    roots.push(`${home}/AppData/Local/pnpm/global`);
  }

  const localAppData = canonical(env.LOCALAPPDATA);
  if (localAppData) {
    roots.push(`${localAppData}/pnpm/global`);
  }

  return [...new Set(roots)];
}

function npmGlobalNodeModulesRoots(
  env: NodeJS.ProcessEnv,
  canonical: (value: string | undefined) => string | undefined,
): string[] {
  const roots = [
    "/usr/local/lib/node_modules",
    "/usr/lib/node_modules",
    "/opt/homebrew/lib/node_modules",
    "/opt/local/lib/node_modules",
  ];
  const prefixes = [env.npm_config_prefix, env.NPM_CONFIG_PREFIX];

  for (const prefix of prefixes) {
    const normalized = canonical(prefix);
    if (normalized) {
      roots.push(
        `${normalized}/lib/node_modules`,
        `${normalized}/node_modules`,
      );
    }
  }

  const appData = canonical(env.APPDATA);
  if (appData) {
    roots.push(`${appData}/npm/node_modules`);
  }

  const home = canonical(env.HOME ?? env.USERPROFILE);
  if (home) {
    roots.push(
      `${home}/.npm-global/lib/node_modules`,
      `${home}/.npm-packages/lib/node_modules`,
    );
  }

  return [...new Set(roots)];
}

/**
 * A global install under a version manager's Node belongs to that Node's own
 * npm. Running whichever `npm` is first on PATH could update a different Node.
 */
function versionManagerInstall(
  path: string,
  env: NodeJS.ProcessEnv,
  home: string | undefined,
  root: (value: string | undefined) => string | undefined,
): InstallMethod | undefined {
  const marker = "/lib/node_modules/";
  const markerIndex = path.indexOf(marker);
  if (markerIndex < 0) {
    return undefined;
  }

  const fromHome = (suffix: string) => (home ? `${home}/${suffix}` : undefined);
  const roots: Array<[NodeVersionManager, string | undefined, string]> = [
    ["nvm", root(env.NVM_DIR) ?? fromHome(".nvm"), "versions/node"],
    ["fnm", root(env.FNM_DIR) ?? fromHome(".local/share/fnm"), "node-versions"],
    ["asdf", root(env.ASDF_DATA_DIR) ?? fromHome(".asdf"), "installs/nodejs"],
    [
      "mise",
      root(env.MISE_DATA_DIR) ?? fromHome(".local/share/mise"),
      "installs/node",
    ],
    ["volta", root(env.VOLTA_HOME) ?? fromHome(".volta"), "tools/image/node"],
  ];

  for (const [manager, base, suffix] of roots) {
    if (base && isPathInsideRoot(path, `${base}/${suffix}`)) {
      return {
        kind: "node-version-manager",
        manager,
        npm: `${path.slice(0, markerIndex)}${/^[A-Za-z]:\//.test(path) ? "/npm" : "/bin/npm"}`,
      };
    }
  }

  return undefined;
}

const SYSTEM_PACKAGE_DATABASES: Array<{
  manager: SystemPackageManager;
  markers: string[];
  query: string[];
}> = [
  {
    manager: "dpkg",
    markers: ["/var/lib/dpkg/status"],
    query: ["dpkg-query", "-S"],
  },
  {
    manager: "rpm",
    markers: ["/var/lib/rpm", "/usr/lib/sysimage/rpm"],
    query: ["rpm", "-qf", "--qf", "%{NAME}\\n"],
  },
  {
    manager: "pacman",
    markers: ["/var/lib/pacman/local"],
    query: ["pacman", "-Qqo"],
  },
  {
    manager: "apk",
    markers: ["/lib/apk/db/installed"],
    query: ["apk", "info", "-W"],
  },
];

function systemPackageOwner(
  path: string,
  fs: IdentityFs,
  exec: ExecSyncLike,
): InstallMethod | undefined {
  if (!/^\/usr\/(?:lib|lib64|share)\//.test(path)) {
    return undefined;
  }

  const deadline = Date.now() + PACKAGE_QUERY_TIMEOUT_MS;
  let unverified = false;
  for (const database of SYSTEM_PACKAGE_DATABASES) {
    if (!database.markers.some((marker) => fs.existsSync(marker))) {
      continue;
    }

    const timeoutMs = deadline - Date.now();
    if (timeoutMs <= 0) {
      unverified = true;
      break;
    }
    let result: ExecSyncResult;
    try {
      result = exec([...database.query, path], timeoutMs);
    } catch {
      unverified = true;
      break;
    }
    if (result.unavailable || result.status === null) {
      unverified = true;
      break;
    }
    if (result.status === 0) {
      const owner = parseSystemPackageOwner(database.manager, result.stdout);
      if (!owner) {
        unverified = true;
        break;
      }
      return {
        kind: "system-package",
        manager: database.manager,
        package: owner,
      };
    }
    if (result.status !== 1) {
      unverified = true;
      break;
    }
  }

  return unverified ? { kind: "system-package-unverified" } : undefined;
}

function parseSystemPackageOwner(
  manager: SystemPackageManager,
  stdout: string,
): string | undefined {
  const line = stdout.trim().split("\n")[0]?.trim() ?? "";
  switch (manager) {
    case "dpkg":
      // `nodejs: /usr/lib/...` or `pkg:amd64: /usr/lib/...`
      return line.split(":")[0]?.trim() || undefined;
    case "rpm":
    case "pacman":
      return line || undefined;
    case "apk": {
      const match = /^.+ is owned by (.+)-[^-]+-r\d+$/.exec(line);
      return match?.[1];
    }
  }
}

function declaresDependency(value: unknown, packageName: string): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ].some((field) => {
    const dependencies = Reflect.get(value, field);
    return (
      typeof dependencies === "object" &&
      dependencies !== null &&
      Object.hasOwn(dependencies, packageName)
    );
  });
}

function projectLocalInstall(
  path: string,
  packageName: string,
  fs: IdentityFs,
): InstallMethod | undefined {
  const nodeModules = path.indexOf("/node_modules/");
  if (nodeModules < 0 || !path.includes(`/node_modules/${packageName}/`)) {
    return undefined;
  }

  const project = path.slice(0, nodeModules);
  const packageJsonPath = join(project, "package.json");
  let declaresPackage = false;
  try {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(packageJsonPath, "utf-8"),
    );
    declaresPackage = declaresDependency(parsed, packageName);
  } catch {
    // The install remains project-local; without metadata, guidance is print-only.
  }

  return {
    kind: "project-local",
    project,
    packageManager: projectPackageManager(project, fs),
    declaresPackage,
  };
}

const LOCKFILES: Array<[string, ProjectPackageManager]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

/** Nearest lockfile wins, so workspace members inherit the workspace's manager. */
function projectPackageManager(
  project: string,
  fs: IdentityFs,
): ProjectPackageManager {
  let dir = project;
  let previous = "";
  while (dir !== previous) {
    for (const [lockfile, manager] of LOCKFILES) {
      if (fs.existsSync(join(dir, lockfile))) {
        return manager;
      }
    }
    previous = dir;
    dir = dirname(dir);
  }
  return "npm";
}

/** Upgrade command selected for a detected install method. */
export interface UpgradePlan {
  method: InstallMethod["kind"];
  /** Who manages this installation, for example `npm`, `homebrew`, or `nix`. */
  manager: string;
  /**
   * Human-readable command, used both for announcing and print-only output, or
   * `null` when no single command updates this installation.
   */
  command: string | null;
  /** Spawn argv, or `null` when the upgrade must not be run automatically. */
  argv: string[] | null;
  /** Why the plan is print-only, when applicable. */
  note?: string;
  /** What to do instead, when the plan is print-only and needs more than `command`. */
  instruction?: string;
}

function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

function runnablePlan(
  method: InstallMethod,
  manager: string,
  argv: string[],
): UpgradePlan {
  return {
    method: method.kind,
    manager,
    command: argv.map(shellQuote).join(" "),
    argv,
  };
}

function manualPlan(
  method: InstallMethod,
  manager: string,
  plan: { command?: string; note: string; instruction?: string },
): UpgradePlan {
  return {
    method: method.kind,
    manager,
    command: plan.command ?? null,
    argv: null,
    note: plan.note,
    ...(plan.instruction ? { instruction: plan.instruction } : {}),
  };
}

const SYSTEM_UPGRADE_COMMAND: Record<SystemPackageManager, string> = {
  dpkg: "sudo apt install --only-upgrade",
  rpm: "sudo dnf upgrade",
  pacman: "sudo pacman -S",
  apk: "sudo apk upgrade",
};

/**
 * Map a detected install method to the exact upgrade command for it. Only the
 * manager that owns the installation is ever planned as runnable; every other
 * case is print-only and says who manages the installation.
 */
export function planUpgrade(
  method: InstallMethod,
  packageName: string,
): UpgradePlan {
  const latest = `${packageName}@latest`;
  switch (method.kind) {
    case "npm-global":
      return runnablePlan(method, "npm", ["npm", "install", "-g", latest]);
    case "pnpm-global":
      return runnablePlan(method, "pnpm", ["pnpm", "add", "-g", latest]);
    case "yarn-global":
      return runnablePlan(method, "yarn", ["yarn", "global", "add", latest]);
    case "bun-global":
      return runnablePlan(method, "bun", ["bun", "add", "-g", latest]);
    case "volta":
      return runnablePlan(method, "volta", ["volta", "install", latest]);
    case "node-version-manager":
      return runnablePlan(method, method.manager, [
        method.npm,
        "install",
        "-g",
        latest,
      ]);
    case "homebrew":
      if (method.formula) {
        return runnablePlan(method, "homebrew", [
          "brew",
          "upgrade",
          method.formula,
        ]);
      }
      return manualPlan(method, "homebrew", {
        command: `brew upgrade ${packageName}`,
        note: "Could not determine the Homebrew formula automatically",
      });
    case "nix":
      return manualPlan(method, "nix", {
        note: "This installation is managed by Nix, which owns the read-only store",
        instruction:
          "Update the package in your Nix configuration or flake inputs, then rebuild (for example `home-manager switch` or `nixos-rebuild switch`)",
      });
    case "system-package-unverified":
      return manualPlan(method, "system package manager", {
        note: "System package ownership could not be verified",
        instruction:
          "Update through the system package manager, or retry when its package database is available",
      });
    case "system-package": {
      const command = `${SYSTEM_UPGRADE_COMMAND[method.manager]} ${method.package}`;
      return manualPlan(method, method.manager, {
        command,
        note: `This installation is managed by the system package manager (${method.manager} package ${method.package})`,
        instruction: `Run \`${command}\` to upgrade it through the system package manager`,
      });
    }
    case "mise-npm-backend": {
      const command = `mise upgrade npm:${packageName}`;
      return manualPlan(method, "mise", {
        command,
        note: "This installation is managed by mise's npm backend",
        instruction: `Run \`${command}\`, or raise its version in your mise config`,
      });
    }
    case "project-local":
      return manualPlan(method, method.packageManager, {
        command: method.declaresPackage
          ? `${method.packageManager} add ${latest}`
          : null,
        note: "This installation is a project dependency",
        instruction: method.declaresPackage
          ? `Run this in the workspace package that declares ${packageName}`
          : `Update ${packageName} in the package that declares it`,
      });
    case "read-only":
      return manualPlan(method, method.manager, {
        note: `This installation is managed by ${method.manager}, but ${method.path} is not writable by the current user`,
        instruction:
          "Update it through the image, deployment, or account that installed it",
      });
    case "npx":
      return manualPlan(method, "npx", {
        command: `npx -y ${latest}`,
        note: "npx always runs the latest published version, so no install is needed",
      });
    case "unknown":
      return manualPlan(method, "unknown", {
        command: `npm install -g ${latest}`,
        note: "Could not determine how this tool was installed",
      });
  }
}

const UPDATABLE_IN_PLACE = new Set<InstallMethod["kind"]>([
  "npm-global",
  "pnpm-global",
  "yarn-global",
  "bun-global",
  "volta",
  "node-version-manager",
  "homebrew",
]);

/** Only a permission or read-only-filesystem denial counts as not writable. */
function defaultIsWritable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return !(code === "EACCES" || code === "EPERM" || code === "EROFS");
  }
}

/** Downgrade an in-place plan to print-only when its package directory is read-only. */
function withWritableCheck(
  method: InstallMethod,
  packageDir: string | undefined,
  isWritable: (path: string) => boolean,
  packageName: string,
): InstallMethod {
  if (
    !packageDir ||
    !UPDATABLE_IN_PLACE.has(method.kind) ||
    isWritable(packageDir)
  ) {
    return method;
  }

  return {
    kind: "read-only",
    path: packageDir,
    manager: planUpgrade(method, packageName).manager,
  };
}

function packageManagerExecutable(
  command: string,
  platform: NodeJS.Platform,
): string {
  if (
    platform === "win32" &&
    (command === "npm" ||
      command === "pnpm" ||
      command === "yarn" ||
      command === "npx")
  ) {
    return `${command}.cmd`;
  }
  return command;
}

function shouldUseWindowsPackageManagerShell(
  command: string,
  platform: NodeJS.Platform,
): boolean {
  return (
    platform === "win32" &&
    (command === "npm" ||
      command === "pnpm" ||
      command === "yarn" ||
      command === "npx")
  );
}

async function npmViewVersion(
  packageName: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  try {
    const command = packageManagerExecutable("npm", platform);
    const { stdout } = await execFileAsync(
      command,
      ["view", packageName, "version"],
      {
        timeout: 20_000,
        shell: shouldUseWindowsPackageManagerShell("npm", platform),
      },
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

class RegistryNotFoundError extends Error {}

/** Injection points for fetching the latest published npm version. */
export interface FetchLatestOptions {
  /** Custom fetch implementation. Pass `null` to skip HTTP and use npm only. */
  fetchImpl?: FetchLike | null;
  /** Custom `npm view` fallback. */
  npmView?: (packageName: string) => Promise<string | null>;
  /** Registry HTTP timeout in milliseconds. */
  fetchTimeoutMs?: number;
  /** Platform used when invoking npm through the fallback path. */
  platform?: NodeJS.Platform;
}

async function withRegistryTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Registry fetch timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
  });

  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function fetchRegistryVersion(
  fetchImpl: FetchLike,
  packageName: string,
  timeoutMs: number,
): Promise<string | null> {
  return withRegistryTimeout(timeoutMs, async (signal) => {
    const response = await fetchImpl(
      `${REGISTRY_BASE}/${registryPath(packageName)}/latest`,
      { headers: { accept: "application/json" }, signal },
    );
    if (response.ok) {
      const data = (await response.json()) as { version?: unknown };
      if (typeof data.version === "string" && data.version.length > 0) {
        return data.version;
      }
    } else if (response.status === 404) {
      throw new RegistryNotFoundError();
    }

    return null;
  });
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
  let registryNotFound = false;

  if (typeof fetchImpl === "function") {
    try {
      const version = await fetchRegistryVersion(
        fetchImpl,
        packageName,
        options.fetchTimeoutMs ?? REGISTRY_FETCH_TIMEOUT_MS,
      );
      if (version) {
        return version;
      }
    } catch (error) {
      if (error instanceof RegistryNotFoundError) {
        registryNotFound = true;
      } else if (error instanceof AxiError) {
        throw error;
      }
      // Network/parse failure: fall through to the npm CLI fallback.
    }
  }

  const viewed = await (
    options.npmView ??
    ((name: string) => npmViewVersion(name, options.platform))
  )(packageName);
  if (viewed) {
    return viewed;
  }

  if (registryNotFound) {
    throw notPublishedError(packageName);
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

/** Result returned by the install runner used by `runUpdate()`. */
export interface InstallResult {
  ok: boolean;
  message?: string;
}

/** Runtime context passed to a custom install runner. */
export interface RunInstallContext {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
}

async function defaultRunInstall(
  plan: UpgradePlan,
  stdout: { write: (chunk: string) => unknown },
  context: RunInstallContext,
): Promise<InstallResult> {
  const argv = plan.argv;
  if (!argv || argv.length === 0) {
    return { ok: false, message: "No runnable upgrade command" };
  }

  stdout.write(`running: ${plan.command}\n`);

  return new Promise<InstallResult>((resolve) => {
    const [command, ...args] = argv;
    const absolute = command.startsWith("/") || win32.isAbsolute(command);
    const windowsAbsoluteNpm =
      context.platform === "win32" &&
      absolute &&
      command.replaceAll("\\", "/").toLowerCase().endsWith("/npm");
    const executable = windowsAbsoluteNpm
      ? `"${command}.cmd"`
      : packageManagerExecutable(command, context.platform);
    // A version manager's own npm must run on that Node, not whichever `node`
    // is first on PATH.
    const env = absolute
      ? {
          env: {
            ...context.env,
            PATH: `${absolute && context.platform === "win32" ? win32.dirname(command) : dirname(command)}${context.platform === "win32" ? ";" : delimiter}${context.env.PATH ?? ""}`,
          },
        }
      : {};
    const child = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell:
        windowsAbsoluteNpm ||
        shouldUseWindowsPackageManagerShell(command, context.platform),
      ...env,
    });
    child.stdout?.on("data", (chunk: string | Buffer) => {
      process.stderr.write(chunk);
    });
    child.stderr?.on("data", (chunk: string | Buffer) => {
      process.stderr.write(chunk);
    });
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

function resolveInstalledVersion(
  invokedAs: string | undefined,
  realpath: (path: string) => string,
  fs: IdentityFs,
): string | undefined {
  const installedEntry = resolveEntry(invokedAs, realpath);
  return installedEntry
    ? readNearestPackageJson(installedEntry, fs).version
    : undefined;
}

function homebrewUpgradeOutput(options: {
  packageName: string;
  current: string;
  latest: string;
  installedVersion: string | undefined;
  command: string;
}): AxiRenderable {
  const update: Record<string, unknown> = {
    package: options.packageName,
    previous: options.current,
    latest: options.latest,
  };

  if (options.installedVersion) {
    update.installed = options.installedVersion;
    update.available = isUpdateAvailable(
      options.installedVersion,
      options.latest,
    );
  } else {
    update.action = "upgrade-command-ran";
    update.result = "installed version unknown";
  }

  return {
    update,
    command: options.command,
  };
}

/** Options for invoking the built-in self-update flow directly. */
export interface RunUpdateOptions {
  /** Args after the `update` command (e.g. `["--check"]`). */
  args: string[];
  /** Output stream used for the `running:` announcement. */
  stdout: { write: (chunk: string) => unknown };
  /** Explicit npm package name override (escape hatch). */
  packageName?: string;
  /** Current version, normally `options.version` from `runAxiCli`. */
  version?: string;

  /** CLI entrypoint path, normally `process.argv[1]`. */
  invokedAs?: string;
  /** Environment used for install-method detection. */
  env?: NodeJS.ProcessEnv;
  /** Realpath resolver for the invoked entrypoint. */
  realpath?: (path: string) => string;
  /** Filesystem seam used to read package metadata. */
  fs?: IdentityFs;
  /** Latest-version resolver. */
  fetchLatest?: (packageName: string) => Promise<string>;
  /** Installer seam. Defaults to spawning the planned package-manager command. */
  runInstall?: (
    plan: UpgradePlan,
    stdout: { write: (chunk: string) => unknown },
    context: RunInstallContext,
  ) => Promise<InstallResult>;
  /** Platform used for package-manager command shims. */
  platform?: NodeJS.Platform;
  /** Package-database query seam used by install-method detection. */
  exec?: ExecSyncLike;
  /** Writability check for the installed package directory. */
  isWritable?: (path: string) => boolean;
}

type UpdateMode = "check" | "install";

function parseUpdateArgs(args: string[], binName: string): UpdateMode {
  if (args.length === 0) {
    return "install";
  }

  if (args.length === 1 && (args[0] === "--check" || args[0] === "--dry-run")) {
    return "check";
  }

  const unknown = args.find((arg) => arg !== "--check" && arg !== "--dry-run");
  throw new AxiError(
    unknown ? `Unknown update option: ${unknown}` : "Invalid update arguments",
    "VALIDATION_ERROR",
    [
      `Run \`${binName} update --help\``,
      `Use \`${binName} update --check\` to check without installing`,
    ],
  );
}

/**
 * Execute the built-in `update` flow: resolve identity, query the registry,
 * compare versions, and (unless `--check`) upgrade via the detected install
 * method. Returns the renderable result; throws `AxiError` on failure.
 */
export async function runUpdate(
  options: RunUpdateOptions,
): Promise<AxiRenderable> {
  const invokedAs = options.invokedAs ?? process.argv[1];
  const binName = binNameFromArgv(invokedAs);
  const mode = parseUpdateArgs(options.args, binName);
  const platform = options.platform ?? process.platform;
  const realpath = options.realpath ?? ((path: string) => realpathSync(path));
  const entry = resolveEntry(invokedAs, realpath);
  const fs = options.fs ?? nodeFs;

  const fromPackageJson = entry ? readNearestPackageJson(entry, fs) : {};
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

  const detected: InstallMethod = entry
    ? detectInstallMethod({
        entry,
        env: options.env,
        packageName,
        fs,
        exec: options.exec,
      })
    : { kind: "unknown" };
  const packageDir = fromPackageJson.packageJsonPath
    ? dirname(fromPackageJson.packageJsonPath)
    : undefined;
  const method = withWritableCheck(
    detected,
    packageDir,
    options.isWritable ?? defaultIsWritable,
    packageName,
  );
  const plan = planUpgrade(method, packageName);
  const installation = {
    manager: plan.manager,
    ...(entry ? { path: collapseHomeDirectory(entry) } : {}),
  };

  const fetchLatest =
    options.fetchLatest ??
    ((name: string) => fetchLatestVersion(name, { platform }));
  const latest = await fetchLatest(packageName);
  const available = isUpdateAvailable(current, latest);

  if (mode === "check") {
    const output: AxiRenderable = {
      update: {
        package: packageName,
        current,
        latest,
        available,
        ...installation,
      },
    };
    if (available) {
      output.help = [
        plan.argv
          ? `Run \`${binName} update\` to upgrade`
          : manualHelp(plan, method),
      ];
    }
    return output;
  }

  if (!available) {
    return {
      update: `${packageName} is already on the latest version (${current})`,
    };
  }

  if (!plan.argv) {
    return {
      update: {
        package: packageName,
        current,
        latest,
        available: true,
        action: "manual",
        ...installation,
        ...(plan.note ? { reason: plan.note } : {}),
        ...(plan.command ? { run: plan.command } : {}),
      },
      help: [manualHelp(plan, method)],
    };
  }

  const command = plan.command ?? plan.argv.join(" ");
  const runInstall = options.runInstall ?? defaultRunInstall;
  const result = await runInstall(plan, options.stdout, {
    platform,
    env: options.env ?? process.env,
  });
  if (!result.ok) {
    throw new AxiError(`Failed to upgrade ${packageName}`, "UPDATE_ERROR", [
      `Run \`${command}\` manually`,
      ...(result.message ? [result.message] : []),
    ]);
  }

  if (method.kind === "homebrew") {
    return homebrewUpgradeOutput({
      packageName,
      current,
      latest,
      installedVersion: resolveInstalledVersion(invokedAs, realpath, fs),
      command,
    });
  }

  return {
    update: `${packageName} upgraded ${current} -> ${latest}`,
    command,
  };
}

function manualHelp(plan: UpgradePlan, method: InstallMethod): string {
  if (plan.instruction) {
    return plan.instruction;
  }
  return method.kind === "npx"
    ? `Re-run with \`${plan.command}\` to use the latest version`
    : `Run \`${plan.command}\` to upgrade`;
}
