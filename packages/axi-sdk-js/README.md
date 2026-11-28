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

`runAxiCli()` treats an `EPIPE` from stdout as a normal exit, so pipelines whose downstream consumer closes early (for example, `my-axi list | head`) finish with exit code 0. Other stdout errors remain visible and fail normally.

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

## Declared flags

AXI principle 6 says a CLI must refuse unknown flags before doing any work. `runAxiCli()` enforces it for any command that declares its flags: register `{ flags, run }` instead of a bare function.

```ts
await runAxiCli({
  // ...other options
  globalFlags: { account: { type: "string" } }, // accepted by every declared command
  commands: {
    search: {
      flags: {
        query: { type: "string" },
        limit: { type: "string" },
        full: { type: "boolean" },
        recursive: { type: "boolean", short: "r" },
        label: { type: "string", multiple: true },
        page: { type: "string", default: "1" },
        querry: { refuse: "Did you mean --query?" }, // a likely guess or a renamed flag
      },
      run: async (args, context, parsed) => search(parsed.values),
    },
    status: statusCommand, // a bare function: unchecked, receives argv exactly as given
  },
});
```

The declaration is a [`node:util` `parseArgs`](https://nodejs.org/api/util.html#utilparseargsconfig) options map (`type`, `short`, `multiple`, `default`) plus one AXI extension, `refuse`. Before `resolveContext` and before the handler run, the args are checked in strict mode. An unknown flag, a `refuse`d flag, a value flag with no value, or a boolean flag given a value is a `VALIDATION_ERROR` (exit 2):

```sh
$ my-axi search --querry fix
error: Unknown flag --querry for `search`
code: VALIDATION_ERROR
help[3]: Did you mean --query?,"Valid flags for `search`: --account, --full, --label, --limit, --page, --query, --recursive (--help always allowed)",Run `my-axi search --help` for usage
```

`--help` always passes. Everything after a bare `--` is not checked. A lone `-` is a positional. Single-dash tokens that are not a declared `short` alias are unknown flags. `flags: {}` means the command takes no flags.

**Normalization.** The handler's `args` are rewritten into the one form a hand-written parser understands, so a command can opt in without changing how it reads its flags:

| Given                 | Handler receives               |
| --------------------- | ------------------------------ |
| `--limit=5`           | `--limit`, `5`                 |
| `-r`                  | `--recursive`                  |
| `-n5` or `-n 5`       | `--name`, `5`                  |
| `--offset=-5`         | `--offset`, `-5`               |
| `--label a --label=b` | `--label`, `a`, `--label`, `b` |

Positionals, option values, and everything after `--` (including the `--`) pass through byte-identical and in order. Note that strict `parseArgs` rejects `--offset -5` as ambiguous and tells the caller to write `--offset=-5`; the normalized args then carry `--offset`, `-5`. `default` values appear only in `parsed.values`, never in `args`.

**Known limit.** An inline value that itself starts with `--` (for example `--content=--foo`) is normalized to `--content`, `--foo`. A hand-written parser that treats any `--`-prefixed next token as a missing value will reject that; read such values from `parsed` instead, where `parsed.values.content` is `"--foo"`.

**`parsed`.** A declared handler gets an optional third argument, `{ values, positionals }`, straight from `parseArgs`. Handlers may ignore it; `resolveContext` receives the same normalized `args` and `parsed`.

**`globalFlags`** are merged under every declared command's own `flags`, so an `--account` selector is accepted (and listed) everywhere. The command's declaration wins on a name clash, which lets one command narrow a global or refuse it (`account: { refuse: "..." }`). Global flags have no effect on bare-function commands.

**`checkFlags(args, flags, commandName, { globalFlags?, bin? })`** is the same check, exported for tools with their own nested subcommand dispatcher. It returns `{ args, parsed }` or throws the same `AxiError` that `runAxiCli()` would, so `gmail search --bogus` reads identically whether the top-level runtime or the `gmail` dispatcher refused it. Pass the nested name (`"gmail search"`) so the error and the `--help` suggestion name the right command.

**Opt-in rule.** Behaviour changes only follow declarations. A bare-function command, `home`, and the built-in `update` receive argv exactly as before, with no checking and no normalization. Future declaration fields (typed values, choices, descriptions for generated help, nested subcommands) will be optional additions to the same shape.

## Reference

`axi-sdk-js` is a library package. In normal use, `runAxiCli()` is the main
entry point. Executable entry points may import `tryFastPath()` from the
dedicated `axi-sdk-js/fast-path` subpath before dynamically importing their
full command graph.

| API                                     | Description                                                                                                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runAxiCli()`                           | Shared runtime for command-first dispatch, bare `--help`/`--version` handling, the built-in `update` command, lazy context resolution, home header injection, TOON serialization, and errors |
| `axi-sdk-js/fast-path`: `tryFastPath()` | Dependency-free subpath for handling a bare `-v`, `-V`, or `--version` before loading the full CLI graph; all other arguments fall through unchanged                                         |
| `checkFlags()`                          | Check and normalize args against a flag declaration, for nested subcommand dispatchers; same errors as `runAxiCli()` ([Declared flags](#declared-flags))                                     |

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
| `sessionStartHookStatus()`               | Report install status for Claude Code, Codex, and OpenCode at a given scope, without writing    |
| `uninstallSessionStartHooks()`           | Remove marker-matched managed hooks/plugin at a given scope, without touching unrelated entries |
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

### Hook Scope: User vs Project

By default, `installSessionStartHooks()` and its `sessionStartHookStatus()` / `uninstallSessionStartHooks()` counterparts target **user scope**: each agent's home-directory config (`~/.claude/settings.json`, `~/.codex/hooks.json`, `~/.config/opencode/plugins/`). Pass `scope: "project"` (and optionally `projectDir`, which defaults to `process.cwd()`) to target the equivalent **per-repository** config instead:

```ts
await installSessionStartHooks({ scope: "project" });
```

| Agent         | User scope (default)                 | Project scope (`scope: "project"`)   |
| ------------- | ------------------------------------ | ------------------------------------ |
| Claude Code   | `~/.claude/settings.json`            | `<projectDir>/.claude/settings.json` |
| Codex hooks   | `~/.codex/hooks.json`                | `<projectDir>/.codex/hooks.json`     |
| Codex feature | `~/.codex/config.toml` (always here) | `~/.codex/config.toml` (always here) |
| OpenCode      | `~/.config/opencode/plugins/`        | `<projectDir>/.opencode/plugins/`    |

The Codex `[features].hooks = true` feature flag is always ensured in the **user-level** `config.toml`, even when installing at project scope - Codex only honors repo-level hooks once that user-level flag is on, so project-scope install still writes it, and `sessionStartHookStatus()` reports it back as `codex.userFeatureEnabled` / `codex.userFeaturePath` regardless of the scope you asked about. Uninstalling never touches that flag, since it is shared across every AXI a user has installed hooks for.

Omitting `scope` (or passing `scope: "user"`) reproduces the exact pre-scope behavior - `projectDir` is ignored in that case.

```ts
import {
  installSessionStartHooks,
  sessionStartHookStatus,
  uninstallSessionStartHooks,
} from "axi-sdk-js";

await installSessionStartHooks({ scope: "project" });

const status = sessionStartHookStatus({ scope: "project" });
// { marker, scope: "project", claude: { installed, path }, codex: { installed, path, userFeatureEnabled, userFeaturePath }, opencode: { installed, path } }

await uninstallSessionStartHooks({ scope: "project" });
```

`sessionStartHookStatus()` performs no writes and throws if the hook marker can't be resolved from `options.marker` or inferred from the current process. `uninstallSessionStartHooks()` mirrors `installSessionStartHooks()`'s permissive default and silently no-ops in that case, and it only ever removes entries whose command contains the managed marker - unrelated hooks, groups, and unmanaged OpenCode plugin files are left alone (the latter reported via `onError`, same as install's overwrite protection).

### Hook Command Portability

Hook commands use a plain binary name such as `gh-axi` only when that name contains the hook marker and `binaryNames` resolves through the current `PATH` to the same executable; otherwise they use the absolute `execPath`.

On Windows, npm global bins are wrapper shims (`.cmd` files and extensionless Git Bash scripts) rather than symlinks, so the realpath match never succeeds. The resolver also parses each shim to recover the script it ultimately runs and matches that against the executable, so the plain binary name still works there.

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
