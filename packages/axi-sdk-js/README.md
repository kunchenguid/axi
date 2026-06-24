<h1 align="center">axi-sdk-js</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/axi-sdk-js"><img alt="npm" src="https://img.shields.io/npm/v/axi-sdk-js?style=flat-square" /></a>
  <a href="https://github.com/kunchenguid/axi/actions/workflows/axi-sdk-js-ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/kunchenguid/axi/axi-sdk-js-ci.yml?style=flat-square&label=ci" /></a>
  <a href="https://github.com/kunchenguid/axi/actions/workflows/axi-sdk-js-release-please.yml"><img alt="Release" src="https://img.shields.io/github/actions/workflow/status/kunchenguid/axi/axi-sdk-js-release-please.yml?style=flat-square&label=release" /></a>
  <a href="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue?style=flat-square"><img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue?style=flat-square" /></a>
  <a href="https://x.com/kunchenguid"><img alt="X" src="https://img.shields.io/badge/X-@kunchenguid-black?style=flat-square" /></a>
  <a href="https://discord.gg/Wsy2NpnZDu"><img alt="Discord" src="https://img.shields.io/discord/1439901831038763092?style=flat-square&label=discord" /></a>
</p>

<h3 align="center">Ship AXIs without rewriting the boring parts.</h3>

Every Node-based AXI ends up redoing the same work: top-level dispatch, structured errors, TOON output, and optional hook installation for a few agents.

`axi-sdk-js` pulls those shared runtime pieces into one package.
Your AXI can stay focused on business logic, work with plain JavaScript objects, and let the runtime handle official TOON serialization.
If you want agent session context plumbing, wire `installSessionStartHooks()` into an explicit setup command.

`runAxiCli()` assumes a command-first CLI shape: `<bin> <command> ...args ...flags`. Bare `--help` is still supported, but flags are not allowed before the top-level command.

Every tool built on `runAxiCli()` also gets a built-in `update` self-update command for free (alongside `--help` and `-v`/`--version`). See [Built-in self-update](#built-in-self-update).

If your executable boundary needs to normalize loader-specific arguments before dispatch, pass `argv` explicitly to `runAxiCli()` instead of relying on `process.argv.slice(2)`.

## Quick Start

```sh
$ npm install axi-sdk-js
added 1 package
```

```ts
import { runAxiCli } from "axi-sdk-js";

await runAxiCli({
  description: "Manage GitHub state in the current repository",
  version: "1.2.3",
  argv: process.argv.slice(2),
  topLevelHelp: TOP_LEVEL_HELP,
  resolveContext: ({ command, args }) =>
    command === "issue" || command === "pr"
      ? resolveRepoFromArgs(args)
      : undefined,
  home: async () => ({
    issues: [{ number: 12, title: "Fix auth bug", state: "open" }],
    help: ["Run `gh-axi issue view <number>` for details"],
  }),
  commands: {
    issue: issueCommand,
    pr: prCommand,
  },
});
```

## Built-in self-update

`runAxiCli()` reserves `update` as a built-in command, so every tool gains `<tool> update` and `<tool> update --check` with **zero per-tool code**.
`<tool> update --dry-run` is accepted as an alias for `--check`.

```sh
$ gh-axi update --check
update:
  package: gh-axi
  current: 1.2.3
  latest: 1.3.0
  available: true
help[1]: Run `gh-axi update` to upgrade

$ gh-axi update
running: npm install -g gh-axi@latest
update: gh-axi upgraded 1.2.3 -> 1.3.0
command: npm install -g gh-axi@latest
```

How it works:

- **Identity is auto-derived.** The package name and version are read from the nearest `package.json` (walking up from the realpath-resolved entrypoint). `version` from `runAxiCli()` is preferred when present. No wiring needed.
- **The latest version comes from the registry.** It queries `https://registry.npmjs.org/<pkg>/latest`, falling back to `npm view <pkg> version`, and compares with proper semver. Network, registry, and not-found failures surface as structured `AxiError`s.
- **The upgrade matches the install method**, detected from the entrypoint path and environment:
  - npm global -> `npm install -g <pkg>@latest`
  - pnpm global -> `pnpm add -g <pkg>@latest`
  - Homebrew (`/Cellar/`) -> `brew upgrade <formula>`
  - npx / ephemeral cache -> reports that `npx -y <pkg>@latest` already runs the latest (print-only)
  - unknown -> prints the recommended command without guessing (print-only)
- **`update --check`** (a/k/a `--dry-run`) reports current vs latest and whether an update is available, installing nothing. When already on the latest version, `update` reports up-to-date and exits 0.
- **Discoverability is SDK-owned.** Bare `--help` gets a compact built-in command footer when the tool has not registered its own `update`, and `<tool> update --help` shows the command reference.

`update` is a **reserved command name**. A tool that registers its own `update` in `commands` keeps full control - the built-in never shadows it. Pass `packageName` to `runAxiCli()` only as an escape hatch when the package name cannot be derived from `package.json`:

```ts
await runAxiCli({
  // ...other options
  version: "1.2.3",
  packageName: "gh-axi", // optional override; normally auto-derived
});
```

## Reference

`axi-sdk-js` is a library package. In normal use, `runAxiCli()` should be the main entry point.

| API           | Description                                                                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runAxiCli()` | Shared runtime for command-first dispatch, bare `--help`/`--version` fast paths, the built-in `update` command, lazy context resolution, home header injection, TOON serialization, and errors |

### Advanced Exports

Most AXI authors should not need these directly.

| API                                      | Description                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `AxiError`                               | Throw structured AXI errors from command handlers                                               |
| `RESERVED_COMMANDS`                      | SDK-owned built-in command names, currently `update`                                            |
| `runUpdate()`                            | The built-in self-update flow (registry lookup, install-method detection, upgrade)              |
| `fetchLatestVersion()`                   | Resolve the latest npm version through the registry endpoint with an `npm view` fallback        |
| `detectInstallMethod()`, `planUpgrade()` | Inspect an entrypoint path and map it to the upgrade command the built-in updater would use     |
| `compareSemver()`, `isUpdateAvailable()` | Semver helpers used by the updater, including prerelease ordering                               |
| `installSessionStartHooks()`             | Install or repair Claude Code hooks, Codex hooks, and OpenCode ambient context plugins directly |
| `resolvePortableHookCommand()`           | Resolve a hook command to a safe binary name or absolute path                                   |
| `PortableHookCommandContext`             | Context for resolving portable hook commands                                                    |
| `shouldInstallHooksForNodeAxiExecPath()` | Check whether an executable path is safe for hook installation                                  |

### Session Hook Setup

`runAxiCli()` does not install hooks during normal CLI execution.
Hook installation should be exposed through an explicit user-invoked setup command, for example `my-axi setup hooks`.

```ts
import { installSessionStartHooks, runAxiCli } from "axi-sdk-js";

await runAxiCli({
  // ...other options
  commands: {
    setup: async (args) => {
      if (args[0] !== "hooks") {
        return {
          error: "Unknown setup command",
          help: "Run `my-axi setup hooks`",
        };
      }

      installSessionStartHooks();
      return { setup: "hooks installed or already up to date" };
    },
  },
});
```

Calling `installSessionStartHooks()` without identity options infers the current CLI from `process.argv[1]`.
Packaged entrypoints such as `dist/bin/gh-axi.js` infer `marker: "gh-axi"`, `binaryNames: ["gh-axi"]`, and a safety policy that skips development TypeScript entrypoints.
Pass explicit options when your setup command needs custom behavior:

```ts
await installSessionStartHooks({
  marker: "my-axi",
  binaryNames: ["my-axi"],
});
```

Claude Code and Codex receive native `SessionStart` hooks, while OpenCode receives a managed plugin in `~/.config/opencode/plugins/` that injects the AXI home view as ambient model context.

### Hook Command Portability

Hook commands use a plain binary name such as `gh-axi` only when that name contains the hook marker and `binaryNames` resolves through the current `PATH` to the same executable; otherwise they use the absolute `execPath`.

For custom wrappers, pass `binaryNames: ["my-axi"]` to `installSessionStartHooks()`.

## Development

Repository contributions targeting `main` must follow the root [contributor workflow](../../CONTRIBUTING.md).
Before pushing SDK changes, run the same package checks that CI runs:

```sh
pnpm install # Install workspace dependencies
pnpm run format:check # Check formatting
pnpm run lint # Lint SDK sources and tests
pnpm --dir packages/axi-sdk-js test # Run tests
pnpm --dir packages/axi-sdk-js run build # Build dist output
```
