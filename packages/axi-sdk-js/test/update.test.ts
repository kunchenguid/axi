import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { AxiError } from "../src/errors.js";
import {
  compareSemver,
  detectInstallMethod,
  fetchLatestVersion,
  isUpdateAvailable,
  parseSemver,
  planUpgrade,
  readNearestPackageJson,
  runUpdate,
  type IdentityFs,
  type InstallResult,
  type UpgradePlan,
} from "../src/update.js";

describe("parseSemver", () => {
  it("parses a plain version", () => {
    expect(parseSemver("1.2.3")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
    });
  });

  it("parses a leading-v and prerelease", () => {
    expect(parseSemver("v2.0.0-beta.1")).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
      prerelease: ["beta", "1"],
    });
  });

  it("returns null for invalid versions", () => {
    expect(parseSemver("not-a-version")).toBeNull();
    expect(parseSemver("1.2")).toBeNull();
  });
});

describe("compareSemver", () => {
  it("orders major, minor, and patch", () => {
    expect(compareSemver("1.0.0", "2.0.0")).toBe(-1);
    expect(compareSemver("1.3.0", "1.2.9")).toBe(1);
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
    expect(compareSemver("1.2.10", "1.2.9")).toBe(1);
  });

  it("treats a release as newer than its prerelease", () => {
    expect(compareSemver("1.0.0", "1.0.0-rc.1")).toBe(1);
    expect(compareSemver("1.0.0-rc.1", "1.0.0")).toBe(-1);
  });

  it("orders prerelease identifiers", () => {
    expect(compareSemver("1.0.0-alpha.1", "1.0.0-alpha.2")).toBe(-1);
    expect(compareSemver("1.0.0-alpha.2", "1.0.0-alpha.10")).toBe(-1);
    expect(compareSemver("1.0.0-beta", "1.0.0-alpha")).toBe(1);
  });

  it("falls back to lexical comparison for unparseable input", () => {
    expect(compareSemver("abc", "abc")).toBe(0);
    expect(compareSemver("a", "b")).toBe(-1);
  });
});

describe("isUpdateAvailable", () => {
  it("is true only when latest is strictly newer", () => {
    expect(isUpdateAvailable("1.2.3", "1.3.0")).toBe(true);
    expect(isUpdateAvailable("1.3.0", "1.3.0")).toBe(false);
    expect(isUpdateAvailable("1.3.0", "1.2.9")).toBe(false);
  });
});

function fakeFs(files: Record<string, string>): IdentityFs {
  return {
    existsSync: (path) => Object.prototype.hasOwnProperty.call(files, path),
    readFileSync: (path) => {
      if (!Object.prototype.hasOwnProperty.call(files, path)) {
        throw new Error(`ENOENT: ${path}`);
      }
      return files[path];
    },
  };
}

describe("readNearestPackageJson", () => {
  it("returns the nearest package.json that declares a name", () => {
    const fs = fakeFs({
      "/app/pkg/dist/bin/package.json": JSON.stringify({ private: true }),
      "/app/pkg/package.json": JSON.stringify({
        name: "gh-axi",
        version: "1.2.3",
      }),
    });

    expect(
      readNearestPackageJson("/app/pkg/dist/bin/gh-axi.js", fs),
    ).toMatchObject({ packageName: "gh-axi", version: "1.2.3" });
  });

  it("skips malformed package.json while walking up", () => {
    const fs = fakeFs({
      "/app/pkg/dist/package.json": "{ not json",
      "/app/pkg/package.json": JSON.stringify({
        name: "tasks-axi",
        version: "0.4.0",
      }),
    });

    expect(readNearestPackageJson("/app/pkg/dist/cli.js", fs)).toMatchObject({
      packageName: "tasks-axi",
      version: "0.4.0",
    });
  });

  it("returns empty identity when no named package.json is found", () => {
    expect(readNearestPackageJson("/nowhere/cli.js", fakeFs({}))).toEqual({});
  });
});

describe("detectInstallMethod", () => {
  it("detects npm global installs", () => {
    expect(
      detectInstallMethod({
        entry: "/usr/local/lib/node_modules/gh-axi/dist/bin/gh-axi.js",
        env: {},
      }),
    ).toEqual({ kind: "npm-global" });
  });

  it("treats npm-under-Homebrew-node as npm global, not brew", () => {
    expect(
      detectInstallMethod({
        entry: "/opt/homebrew/lib/node_modules/gh-axi/dist/bin/gh-axi.js",
        env: {},
      }),
    ).toEqual({ kind: "npm-global" });
  });

  it("does not treat project lib/node_modules paths as npm global installs", () => {
    expect(
      detectInstallMethod({
        entry: "/Users/me/repo/lib/node_modules/gh-axi/dist/bin/gh-axi.js",
        env: {},
      }),
    ).toEqual({ kind: "unknown" });
  });

  it("does not trust generic PREFIX as an npm global root", () => {
    expect(
      detectInstallMethod({
        entry: "/Users/me/repo/node_modules/gh-axi/dist/bin/gh-axi.js",
        env: { PREFIX: "/Users/me/repo" },
      }),
    ).toEqual({ kind: "unknown" });
  });

  it("detects npm globals under configured version manager roots", () => {
    expect(
      detectInstallMethod({
        entry:
          "/Users/me/.nvm/versions/node/v24.13.1/lib/node_modules/gh-axi/dist/bin/gh-axi.js",
        env: { HOME: "/Users/me" },
      }),
    ).toEqual({ kind: "npm-global" });
  });

  it("detects pnpm global installs", () => {
    expect(
      detectInstallMethod({
        entry:
          "/Users/me/Library/pnpm/global/5/.pnpm/gh-axi@1.2.3/node_modules/gh-axi/dist/bin/gh-axi.js",
        env: { HOME: "/Users/me" },
      }),
    ).toEqual({ kind: "pnpm-global" });
  });

  it("does not treat local pnpm virtual stores as global installs", () => {
    expect(
      detectInstallMethod({
        entry:
          "/Users/me/repo/node_modules/.pnpm/gh-axi@1.2.3/node_modules/gh-axi/dist/bin/gh-axi.js",
        env: {},
      }),
    ).toEqual({ kind: "unknown" });
  });

  it("does not treat pnpm-shaped project paths as global installs", () => {
    expect(
      detectInstallMethod({
        entry:
          "/Users/me/repo/pnpm/global/5/.pnpm/gh-axi@1.2.3/node_modules/gh-axi/dist/bin/gh-axi.js",
        env: {},
      }),
    ).toEqual({ kind: "unknown" });
  });

  it("does not treat user-home pnpm lookalike project paths as global installs", () => {
    expect(
      detectInstallMethod({
        entry:
          "/Users/me/repo/Library/pnpm/global/5/.pnpm/gh-axi@1.2.3/node_modules/gh-axi/dist/bin/gh-axi.js",
        env: { HOME: "/Users/me" },
      }),
    ).toEqual({ kind: "unknown" });
  });

  it("detects pnpm via PNPM_HOME", () => {
    expect(
      detectInstallMethod({
        entry: "/custom/pnpm-root/store/gh-axi/dist/bin/gh-axi.js",
        env: { PNPM_HOME: "/custom/pnpm-root" },
      }),
    ).toEqual({ kind: "pnpm-global" });
  });

  it("requires PNPM_HOME matches to stay inside the configured root", () => {
    expect(
      detectInstallMethod({
        entry: "/custom/pnpm-root-other/store/gh-axi/dist/bin/gh-axi.js",
        env: { PNPM_HOME: "/custom/pnpm-root" },
      }),
    ).toEqual({ kind: "unknown" });
  });

  it("detects Homebrew formula from the Cellar segment", () => {
    expect(
      detectInstallMethod({
        entry:
          "/opt/homebrew/Cellar/gh-axi/1.2.3/libexec/lib/node_modules/gh-axi/dist/bin/gh-axi.js",
        env: {},
      }),
    ).toEqual({ kind: "homebrew", formula: "gh-axi" });
  });

  it("does not treat project Cellar paths as Homebrew installs", () => {
    expect(
      detectInstallMethod({
        entry:
          "/Users/me/repo/Cellar/gh-axi/1.2.3/libexec/lib/node_modules/gh-axi/dist/bin/gh-axi.js",
        env: { HOME: "/Users/me" },
      }),
    ).toEqual({ kind: "unknown" });
  });

  it("detects npx / ephemeral caches", () => {
    expect(
      detectInstallMethod({
        entry:
          "/Users/me/.npm/_npx/abc123/node_modules/gh-axi/dist/bin/gh-axi.js",
        env: {},
      }),
    ).toEqual({ kind: "npx" });
  });

  it("returns unknown for unrecognized paths", () => {
    expect(
      detectInstallMethod({
        entry: "/Users/me/src/gh-axi/dist/bin/gh-axi.js",
        env: {},
      }),
    ).toEqual({ kind: "unknown" });
  });
});

describe("planUpgrade", () => {
  it("plans runnable npm and pnpm upgrades", () => {
    expect(planUpgrade({ kind: "npm-global" }, "gh-axi")).toMatchObject({
      command: "npm install -g gh-axi@latest",
      argv: ["npm", "install", "-g", "gh-axi@latest"],
    });
    expect(planUpgrade({ kind: "pnpm-global" }, "gh-axi")).toMatchObject({
      command: "pnpm add -g gh-axi@latest",
      argv: ["pnpm", "add", "-g", "gh-axi@latest"],
    });
  });

  it("plans a runnable brew upgrade when the formula is known", () => {
    expect(
      planUpgrade({ kind: "homebrew", formula: "gh-axi" }, "gh-axi"),
    ).toMatchObject({
      command: "brew upgrade gh-axi",
      argv: ["brew", "upgrade", "gh-axi"],
    });
  });

  it("is print-only for brew without a formula, npx, and unknown", () => {
    expect(
      planUpgrade({ kind: "homebrew", formula: null }, "gh-axi").argv,
    ).toBeNull();
    expect(planUpgrade({ kind: "npx" }, "gh-axi").argv).toBeNull();
    expect(planUpgrade({ kind: "unknown" }, "gh-axi").argv).toBeNull();
  });
});

describe("fetchLatestVersion", () => {
  it("reads the version from the registry endpoint", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ version: "2.5.0" }),
    }));

    await expect(fetchLatestVersion("gh-axi", { fetchImpl })).resolves.toBe(
      "2.5.0",
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://registry.npmjs.org/gh-axi/latest",
      expect.objectContaining({
        headers: { accept: "application/json" },
        signal: expect.any(Object),
      }),
    );
  });

  it("encodes scoped package names", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ version: "1.0.0" }),
    }));

    await fetchLatestVersion("@scope/tool-axi", { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://registry.npmjs.org/@scope%2ftool-axi/latest",
      expect.objectContaining({
        headers: { accept: "application/json" },
        signal: expect.any(Object),
      }),
    );
  });

  it("falls back to npm view on network failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const npmView = vi.fn(async () => "3.1.4");

    await expect(
      fetchLatestVersion("gh-axi", { fetchImpl, npmView }),
    ).resolves.toBe("3.1.4");
    expect(npmView).toHaveBeenCalledWith("gh-axi");
  });

  it("aborts stalled registry fetches and falls back to npm view", async () => {
    const fetchImpl = vi.fn(
      async (_input: string, init?: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );
    const npmView = vi.fn(async () => "3.1.4");

    await expect(
      fetchLatestVersion("gh-axi", {
        fetchImpl,
        npmView,
        fetchTimeoutMs: 1,
      }),
    ).resolves.toBe("3.1.4");
    expect(npmView).toHaveBeenCalledWith("gh-axi");
  });

  it("aborts stalled registry response bodies and falls back to npm view", async () => {
    const fetchImpl = vi.fn(
      async (_input: string, init?: { signal?: AbortSignal }) => ({
        ok: true,
        status: 200,
        json: async () =>
          new Promise<never>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          }),
      }),
    );
    const npmView = vi.fn(async () => "3.1.4");

    await expect(
      fetchLatestVersion("gh-axi", {
        fetchImpl,
        npmView,
        fetchTimeoutMs: 1,
      }),
    ).resolves.toBe("3.1.4");
    expect(npmView).toHaveBeenCalledWith("gh-axi");
  });

  it("falls back to npm view on registry 404", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    }));
    const npmView = vi.fn(async () => "9.9.9");

    await expect(
      fetchLatestVersion("ghost-axi", { fetchImpl, npmView }),
    ).resolves.toBe("9.9.9");
    expect(npmView).toHaveBeenCalledWith("ghost-axi");
  });

  it("throws a not-published AxiError when registry and npm view miss", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    }));
    const npmView = vi.fn(async () => null);

    await expect(
      fetchLatestVersion("ghost-axi", { fetchImpl, npmView }),
    ).rejects.toMatchObject({
      code: "UPDATE_ERROR",
      message: expect.stringContaining("not published"),
    });
    expect(npmView).toHaveBeenCalledWith("ghost-axi");
  });

  it("throws a network AxiError when both paths fail", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    const npmView = vi.fn(async () => null);

    const error = await fetchLatestVersion("gh-axi", {
      fetchImpl,
      npmView,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AxiError);
    expect((error as AxiError).code).toBe("UPDATE_ERROR");
  });
});

describe("runUpdate", () => {
  const stdout = { write: vi.fn(() => true) };

  const baseDeps = {
    invokedAs: "/usr/local/bin/gh-axi",
    realpath: () => "/usr/local/lib/node_modules/gh-axi/dist/bin/gh-axi.js",
    fs: fakeFs({
      "/usr/local/lib/node_modules/gh-axi/package.json": JSON.stringify({
        name: "gh-axi",
        version: "1.2.3",
      }),
    }),
    env: {},
  };

  it("reports current vs latest for --check without installing", async () => {
    const runInstall = vi.fn();
    const output = await runUpdate({
      ...baseDeps,
      args: ["--check"],
      stdout,
      fetchLatest: async () => "1.3.0",
      runInstall,
    });

    expect(output).toMatchObject({
      update: {
        package: "gh-axi",
        current: "1.2.3",
        latest: "1.3.0",
        available: true,
      },
    });
    expect(runInstall).not.toHaveBeenCalled();
  });

  it("rejects unknown args before fetching or installing", async () => {
    const fetchLatest = vi.fn(async () => "1.3.0");
    const runInstall = vi.fn();
    const error = await runUpdate({
      ...baseDeps,
      args: ["--chek"],
      stdout,
      fetchLatest,
      runInstall,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AxiError);
    expect((error as AxiError).code).toBe("VALIDATION_ERROR");
    expect(fetchLatest).not.toHaveBeenCalled();
    expect(runInstall).not.toHaveBeenCalled();
  });

  it("reports up-to-date and skips install", async () => {
    const runInstall = vi.fn();
    const output = await runUpdate({
      ...baseDeps,
      args: [],
      version: "1.3.0",
      stdout,
      fetchLatest: async () => "1.3.0",
      runInstall,
    });

    expect(output).toEqual({
      update: "gh-axi is already on the latest version (1.3.0)",
    });
    expect(runInstall).not.toHaveBeenCalled();
  });

  it("prefers options.version over package.json for the current version", async () => {
    const output = await runUpdate({
      ...baseDeps,
      args: ["--check"],
      version: "2.0.0",
      stdout,
      fetchLatest: async () => "2.0.0",
      runInstall: vi.fn(),
    });

    expect(output).toMatchObject({
      update: { current: "2.0.0", available: false },
    });
  });

  it("runs the detected install method and reports old -> new", async () => {
    const runInstall = vi.fn(
      async (): Promise<InstallResult> => ({ ok: true }),
    );
    const output = await runUpdate({
      ...baseDeps,
      args: [],
      stdout,
      fetchLatest: async () => "1.3.0",
      runInstall,
    });

    const plan = runInstall.mock.calls[0]?.[0] as UpgradePlan;
    expect(plan.command).toBe("npm install -g gh-axi@latest");
    expect(output).toMatchObject({
      update: "gh-axi upgraded 1.2.3 -> 1.3.0",
      command: "npm install -g gh-axi@latest",
    });
  });

  it("does not auto-install from local lib/node_modules project paths", async () => {
    const runInstall = vi.fn();
    const output = await runUpdate({
      ...baseDeps,
      args: [],
      realpath: () =>
        "/Users/me/repo/lib/node_modules/gh-axi/dist/bin/gh-axi.js",
      fs: fakeFs({
        "/Users/me/repo/lib/node_modules/gh-axi/package.json": JSON.stringify({
          name: "gh-axi",
          version: "1.2.3",
        }),
      }),
      stdout,
      fetchLatest: async () => "1.3.0",
      runInstall,
    });

    expect(output).toMatchObject({
      update: { action: "manual", run: "npm install -g gh-axi@latest" },
    });
    expect(runInstall).not.toHaveBeenCalled();
  });

  it("does not auto-install local dependencies under generic PREFIX", async () => {
    const runInstall = vi.fn();
    const output = await runUpdate({
      ...baseDeps,
      args: [],
      realpath: () => "/Users/me/repo/node_modules/gh-axi/dist/bin/gh-axi.js",
      fs: fakeFs({
        "/Users/me/repo/node_modules/gh-axi/package.json": JSON.stringify({
          name: "gh-axi",
          version: "1.2.3",
        }),
      }),
      env: { PREFIX: "/Users/me/repo" },
      stdout,
      fetchLatest: async () => "1.3.0",
      runInstall,
    });

    expect(output).toMatchObject({
      update: { action: "manual", run: "npm install -g gh-axi@latest" },
    });
    expect(runInstall).not.toHaveBeenCalled();
  });

  it("does not auto-install from project Cellar paths", async () => {
    const runInstall = vi.fn();
    const output = await runUpdate({
      ...baseDeps,
      args: [],
      invokedAs: "/Users/me/repo/bin/gh-axi",
      realpath: () =>
        "/Users/me/repo/Cellar/gh-axi/1.2.3/libexec/lib/node_modules/gh-axi/dist/bin/gh-axi.js",
      fs: fakeFs({
        "/Users/me/repo/Cellar/gh-axi/1.2.3/libexec/lib/node_modules/gh-axi/package.json":
          JSON.stringify({ name: "gh-axi", version: "1.2.3" }),
      }),
      env: { HOME: "/Users/me" },
      stdout,
      fetchLatest: async () => "1.3.0",
      runInstall,
    });

    expect(output).toMatchObject({
      update: { action: "manual", run: "npm install -g gh-axi@latest" },
    });
    expect(runInstall).not.toHaveBeenCalled();
  });

  it("does not auto-install from project pnpm global-store lookalikes", async () => {
    const runInstall = vi.fn();
    const output = await runUpdate({
      ...baseDeps,
      args: [],
      invokedAs: "/Users/me/repo/bin/gh-axi",
      realpath: () =>
        "/Users/me/repo/Library/pnpm/global/5/.pnpm/gh-axi@1.2.3/node_modules/gh-axi/dist/bin/gh-axi.js",
      fs: fakeFs({
        "/Users/me/repo/Library/pnpm/global/5/.pnpm/gh-axi@1.2.3/node_modules/gh-axi/package.json":
          JSON.stringify({ name: "gh-axi", version: "1.2.3" }),
      }),
      env: { HOME: "/Users/me" },
      stdout,
      fetchLatest: async () => "1.3.0",
      runInstall,
    });

    expect(output).toMatchObject({
      update: { action: "manual", run: "npm install -g gh-axi@latest" },
    });
    expect(runInstall).not.toHaveBeenCalled();
  });

  it("is print-only for npx installs", async () => {
    const runInstall = vi.fn();
    const output = await runUpdate({
      ...baseDeps,
      args: [],
      realpath: () =>
        "/Users/me/.npm/_npx/abc/node_modules/gh-axi/dist/bin/gh-axi.js",
      fs: fakeFs({
        "/Users/me/.npm/_npx/abc/node_modules/gh-axi/package.json":
          JSON.stringify({ name: "gh-axi", version: "1.2.3" }),
      }),
      stdout,
      fetchLatest: async () => "1.3.0",
      runInstall,
    });

    expect(output).toMatchObject({
      update: { action: "manual", run: "npx -y gh-axi@latest" },
    });
    expect(runInstall).not.toHaveBeenCalled();
  });

  it("raises an AxiError when the install command fails", async () => {
    const error = await runUpdate({
      ...baseDeps,
      args: [],
      stdout,
      fetchLatest: async () => "1.3.0",
      runInstall: async () => ({ ok: false, message: "exit 1" }),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AxiError);
    expect((error as AxiError).code).toBe("UPDATE_ERROR");
  });

  it("reports the re-resolved Homebrew version after upgrade", async () => {
    const runInstall = vi.fn(
      async (): Promise<InstallResult> => ({ ok: true }),
    );
    const realpath = vi
      .fn()
      .mockReturnValueOnce(
        "/opt/homebrew/Cellar/gh-axi/1.2.3/libexec/lib/node_modules/gh-axi/dist/bin/gh-axi.js",
      )
      .mockReturnValueOnce(
        "/opt/homebrew/Cellar/gh-axi/1.2.4/libexec/lib/node_modules/gh-axi/dist/bin/gh-axi.js",
      );

    const output = await runUpdate({
      ...baseDeps,
      args: [],
      invokedAs: "/opt/homebrew/bin/gh-axi",
      realpath,
      fs: fakeFs({
        "/opt/homebrew/Cellar/gh-axi/1.2.3/libexec/lib/node_modules/gh-axi/package.json":
          JSON.stringify({ name: "gh-axi", version: "1.2.3" }),
        "/opt/homebrew/Cellar/gh-axi/1.2.4/libexec/lib/node_modules/gh-axi/package.json":
          JSON.stringify({ name: "gh-axi", version: "1.2.4" }),
      }),
      env: {},
      stdout,
      fetchLatest: async () => "1.3.0",
      runInstall,
    });

    const plan = runInstall.mock.calls[0]?.[0] as UpgradePlan;
    expect(plan.command).toBe("brew upgrade gh-axi");
    expect(output).toMatchObject({
      update: {
        package: "gh-axi",
        previous: "1.2.3",
        installed: "1.2.4",
        latest: "1.3.0",
        available: true,
      },
      command: "brew upgrade gh-axi",
    });
  });

  it("does not claim a Homebrew result version when it cannot re-resolve it", async () => {
    const output = await runUpdate({
      ...baseDeps,
      args: [],
      invokedAs: "/opt/homebrew/bin/gh-axi",
      realpath: vi
        .fn()
        .mockReturnValueOnce(
          "/opt/homebrew/Cellar/gh-axi/1.2.3/libexec/lib/node_modules/gh-axi/dist/bin/gh-axi.js",
        )
        .mockReturnValueOnce("/opt/homebrew/bin/gh-axi"),
      fs: fakeFs({
        "/opt/homebrew/Cellar/gh-axi/1.2.3/libexec/lib/node_modules/gh-axi/package.json":
          JSON.stringify({ name: "gh-axi", version: "1.2.3" }),
      }),
      env: {},
      stdout,
      fetchLatest: async () => "1.3.0",
      runInstall: async () => ({ ok: true }),
    });

    expect(output).toMatchObject({
      update: {
        package: "gh-axi",
        previous: "1.2.3",
        latest: "1.3.0",
        action: "upgrade-command-ran",
        result: "installed version unknown",
      },
      command: "brew upgrade gh-axi",
    });
    expect(output).not.toMatchObject({
      update: { installed: expect.any(String) },
    });
  });

  it("raises an AxiError when the package name cannot be resolved", async () => {
    const error = await runUpdate({
      args: ["--check"],
      stdout,
      invokedAs: "/nowhere/gh-axi",
      realpath: () => "/nowhere/gh-axi",
      fs: fakeFs({}),
      env: {},
      fetchLatest: async () => "1.3.0",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AxiError);
    expect((error as AxiError).message).toContain("package name");
  });
});

describe("default install runner", () => {
  it("forwards installer output to stderr", async () => {
    vi.resetModules();

    const spawn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.stdout.emit("data", "installer stdout\n");
        child.stderr.emit("data", Buffer.from("installer stderr\n"));
        child.emit("close", 0);
      });
      return child;
    });
    const execFile = vi.fn();
    vi.doMock("node:child_process", () => ({ execFile, spawn }));
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const stdout = { write: vi.fn(() => true) };

    try {
      const { runUpdate: runUpdateWithMockedSpawn } =
        await import("../src/update.js");
      const output = await runUpdateWithMockedSpawn({
        args: [],
        stdout,
        invokedAs: "/usr/local/bin/gh-axi",
        realpath: () => "/usr/local/lib/node_modules/gh-axi/dist/bin/gh-axi.js",
        fs: fakeFs({
          "/usr/local/lib/node_modules/gh-axi/package.json": JSON.stringify({
            name: "gh-axi",
            version: "1.2.3",
          }),
        }),
        env: {},
        fetchLatest: async () => "1.3.0",
      });

      expect(spawn).toHaveBeenCalledWith(
        "npm",
        ["install", "-g", "gh-axi@latest"],
        { stdio: ["ignore", "pipe", "pipe"], shell: false },
      );
      expect(stdout.write).toHaveBeenCalledWith(
        "running: npm install -g gh-axi@latest\n",
      );
      expect(stdout.write).not.toHaveBeenCalledWith(
        expect.stringContaining("installer stdout"),
      );
      expect(stderrWrite).toHaveBeenCalledWith("installer stdout\n");
      expect(stderrWrite).toHaveBeenCalledWith(
        Buffer.from("installer stderr\n"),
      );
      expect(output).toMatchObject({
        update: "gh-axi upgraded 1.2.3 -> 1.3.0",
      });
    } finally {
      stderrWrite.mockRestore();
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });

  it("runs Windows package-manager installs through command shims", async () => {
    vi.resetModules();

    const spawn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.emit("close", 0);
      });
      return child;
    });
    const execFile = vi.fn();
    vi.doMock("node:child_process", () => ({ execFile, spawn }));
    const stdout = { write: vi.fn(() => true) };

    try {
      const { runUpdate: runUpdateWithMockedSpawn } =
        await import("../src/update.js");
      await runUpdateWithMockedSpawn({
        args: [],
        stdout,
        invokedAs: "C:/Users/me/AppData/Roaming/npm/gh-axi",
        realpath: () =>
          "C:/Users/me/AppData/Roaming/npm/node_modules/gh-axi/dist/bin/gh-axi.js",
        fs: fakeFs({
          "C:/Users/me/AppData/Roaming/npm/node_modules/gh-axi/package.json":
            JSON.stringify({ name: "gh-axi", version: "1.2.3" }),
        }),
        env: { APPDATA: "C:/Users/me/AppData/Roaming" },
        fetchLatest: async () => "1.3.0",
        platform: "win32",
      });
      await runUpdateWithMockedSpawn({
        args: [],
        stdout,
        invokedAs: "C:/Users/me/AppData/Local/pnpm/gh-axi",
        realpath: () =>
          "C:/Users/me/AppData/Local/pnpm/global/5/.pnpm/gh-axi@1.2.3/node_modules/gh-axi/dist/bin/gh-axi.js",
        fs: fakeFs({
          "C:/Users/me/AppData/Local/pnpm/global/5/.pnpm/gh-axi@1.2.3/node_modules/gh-axi/package.json":
            JSON.stringify({ name: "gh-axi", version: "1.2.3" }),
        }),
        env: { LOCALAPPDATA: "C:/Users/me/AppData/Local" },
        fetchLatest: async () => "1.3.0",
        platform: "win32",
      });

      expect(spawn).toHaveBeenNthCalledWith(
        1,
        "npm.cmd",
        ["install", "-g", "gh-axi@latest"],
        { stdio: ["ignore", "pipe", "pipe"], shell: true },
      );
      expect(spawn).toHaveBeenNthCalledWith(
        2,
        "pnpm.cmd",
        ["add", "-g", "gh-axi@latest"],
        { stdio: ["ignore", "pipe", "pipe"], shell: true },
      );
    } finally {
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });
});
