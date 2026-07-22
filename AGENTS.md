# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## What This Project Is

AXI (Agent eXperience Interface) defines 10 ergonomic principles for building CLI tools that AI agents use via shell execution. This repo contains:

- **`packages/axi-sdk-js/`** — Shared Node.js SDK every `*-axi` CLI builds on. `runAxiCli()` provides built-in commands for all tools: `--help`, `-v`/`--version`, and `update` (self-update). `update` is a reserved command name; a tool may shadow it by registering its own handler.
- **`bench-github/`** — Benchmark harness that compares gh-axi vs gh CLI vs GitHub MCP across 17 agent tasks, graded by an LLM judge.
- **`bench-browser/`** — Benchmark harness that compares browser automation tools (agent-browser, pinchtab, chrome-devtools-mcp) across 16 browsing tasks.
- **`.agents/skills/axi/SKILL.md`** — The AXI skill definition (installable via `npx skills add kunchenguid/axi`).
- **`docs/`** — Static website (axi.md).

The reference AXI implementation (`gh-axi`) lives in a separate repo: [kunchenguid/gh-axi](https://github.com/kunchenguid/gh-axi).

## Development Commands

### Benchmark harness (GitHub)

```sh
pnpm install
pnpm --dir bench-github run bench -- run --condition axi --task merged_pr_ci_audit --repeat 5 --agent claude
pnpm --dir bench-github run bench -- matrix --repeat 5 --agent claude
pnpm --dir bench-github run bench -- report
pnpm --dir bench-github test           # Run bench tests (vitest)
```

### Benchmark harness (Browser)

```sh
pnpm install
pnpm --dir bench-browser run bench -- run --condition agent-browser --task read_static_page --repeat 5
pnpm --dir bench-browser run bench -- matrix --repeat 5    # full run: all conditions × all tasks × 5 repeats
pnpm --dir bench-browser run bench -- report
pnpm --dir bench-browser test           # Run bench tests (vitest)
```

### Social video rendering

```sh
pnpm --dir bench-browser run render:social   # Render social/index.html via HyperFrames to docs/social/rendered/race.mp4
```

The source composition is `bench-browser/social/` (a HyperFrames project). Edit `social/index.html` for content/animation; see `social/DESIGN.md` for the visual identity. Use the `/hyperframes` skill when modifying the composition.

Requires Node.js >= 20 and `gh` CLI installed and authenticated.

## Architecture

### Benchmark (GitHub)

`bench-github/src/runner.ts` orchestrates runs: clones a test repo, writes condition-specific AGENTS.md, invokes the agent (codex or claude), parses JSONL usage, and runs the LLM grader. Conditions are defined in `bench-github/config/conditions.yaml`, tasks in `bench-github/config/tasks.yaml`. Results go to `bench-github/results/`, published results in `bench-github/published-results/`.

### Benchmark (Browser)

`bench-browser/src/runner.ts` orchestrates browser benchmark runs: creates a workspace with condition-specific CLAUDE.md, manages browser daemon lifecycle, invokes Claude with `--bare` isolation, parses JSONL usage, and grades results. Conditions are defined in `bench-browser/config/conditions.yaml`, tasks in `bench-browser/config/tasks.yaml`.

## Releasing `axi-sdk-js`

`axi-sdk-js` versions and publishes to npm through [release-please](https://github.com/googleapis/release-please); there is no manual `npm version` or `npm publish` step.

How it works:

1. Land a conventional-commit change on `main` that touches `packages/axi-sdk-js/**`; under the current pre-1.0 config in `release-please-config.json`, `feat:` and `fix:` commits both bump patch versions (for example `0.1.7` -> `0.1.8`), while breaking changes bump minor versions.
2. The `axi-sdk-js-release-please` workflow opens or updates a release PR titled `chore(main): release axi-sdk-js <version>`.
   That PR is the only place the version in `packages/axi-sdk-js/package.json` may change, and the only place `packages/axi-sdk-js/CHANGELOG.md` and `.release-please-manifest.json` may change.
   Never hand-edit those files; the `Guard generated files` check specifically fails PRs that modify the generated changelog or manifest outside release-please.
3. **Publishing is a maintainer action: merge the open release-please PR.**
   That merge creates the git tag and GitHub release, after which the same workflow runs `format:check`, `lint`, `build`, `test`, then `npm publish --access public --provenance` (OIDC provenance via `id-token: write`, no static npm token in the repo).
4. Verify with `npm view axi-sdk-js version` and confirm the published `dist/` carries the new code (for example `npm pack axi-sdk-js@<version>` then grep the extracted `dist/`).

Because the release PR carries the version bump, a downstream `*-axi` tool only needs to bump its `axi-sdk-js` dependency to inherit new SDK built-ins (such as the reserved `update` command) - no code change in the tool.

## Conventions

- Packages use ES modules (`"type": "module"`) with TypeScript targeting ES2022/Node16.
- Tests are colocated in `test/` directories mirroring `src/` structure and use vitest.
- The AXI catalog and principle summaries are single-sourced from `catalog.yaml` and `principles.yaml`.
  `pnpm run docs:gen` rewrites the marked `generated:...` regions of README.md and docs/index.html; never hand-edit those regions.
  The `docs-check` workflow runs `pnpm run docs:check` and fails on drift, including when `.agents/skills/axi/SKILL.md` section headings stop matching the canonical principle titles.
  The catalog markers sit inside `<tbody>`, so the surrounding `<table>`/`<thead>` markup in docs/index.html is hand-editable and generator-safe.
- docs/index.html carries the site's page-local CSS in one inline `<style>` block; the site otherwise loads the shared `kunchenguid-design-system` stylesheet, which this repo does not own.
  Anything scoped to the two catalog tables uses their `.table-catalog` class - not `.card .table-wrap .table`, which also matches the benchmark Results table.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
