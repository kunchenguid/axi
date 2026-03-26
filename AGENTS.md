# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## What This Project Is

AXI (Agent eXperience Interface) defines 10 ergonomic principles for building CLI tools that AI agents use via shell execution. This repo contains:

- **`gh-axi/`** — Reference AXI implementation: a `gh` CLI wrapper with TOON output, pre-computed fields, contextual suggestions, and structured errors. Published to npm as `gh-axi`.
- **`bench-github/`** — Benchmark harness that compares gh-axi vs gh CLI vs GitHub MCP across 17 agent tasks, graded by an LLM judge.
- **`bench-browser/`** — Benchmark harness that compares browser automation tools (agent-browser, pinchtab, chrome-devtools-mcp) across 16 browsing tasks.
- **`.agents/skills/axi/SKILL.md`** — The AXI skill definition (installable via `npx skills add kunchenguid/axi`).
- **`docs/`** — Static website (axi.md).

## Development Commands

### gh-axi (the main package)

```sh
cd gh-axi
npm install
npm run dev        # Run via tsx (no build needed)
npm run build      # TypeScript compile (tsc)
npm test           # Run all tests (vitest)
npx vitest run src/toon.test.ts   # Run a single test file (from gh-axi/)
```

### Benchmark harness (GitHub)

```sh
cd bench-github
npm install
npm run bench -- run --condition axi --task merged_pr_ci_audit --repeat 5 --agent claude
npm run bench -- matrix --repeat 5 --agent claude
npm run bench -- report
npm test           # Run bench tests (vitest)
```

### Benchmark harness (Browser)

```sh
cd bench-browser
npm install
npm run bench -- run --condition agent-browser --task read_static_page
npm run bench -- matrix --repeat 5
npm run bench -- report
npm test           # Run bench tests (vitest)
```

Requires Node.js >= 20 and `gh` CLI installed and authenticated.

## Architecture

### gh-axi

Each command lives in `gh-axi/src/commands/<domain>.ts` (issue, pr, run, workflow, release, repo, label, search, api). All commands follow the same pattern:

1. **Parse args** using helpers from `args.ts` (`takeFlag`, `takeBoolFlag`, `takeNumber`)
2. **Call `gh`** via `gh.ts` (`ghJson` for JSON output, `ghExec` for raw text, `ghRaw` for non-throwing)
3. **Transform to TOON** via `toon.ts` field extractors (`field`, `pluck`, `lower`, `mapEnum`, `checksSummary`, `custom`) and renderers (`renderList`, `renderDetail`, `renderOutput`)
4. **Append suggestions** via `getSuggestions()` from `suggestions.ts` — a match table keyed on `{domain, action, state, isEmpty}`
5. **Truncate bodies** via `truncateBody()` from `body.ts` (cleans GitHub URLs, strips images, collapses quotes)

Entry point: `gh-axi/bin/gh-axi.ts` → `cli.ts:main()` which routes to command handlers. Repo context (`context.ts`) resolves from `--repo` flag > `GH_REPO` env > git remote.

Errors use `AxiError` with typed codes and are rendered as TOON on stdout (never stderr). The `errors.ts` pattern table maps `gh` stderr patterns to structured error codes.

TOON encoding uses the `@toon-format/toon` library. Field extraction (`toon.ts:extract()`) transforms raw gh JSON into flat objects before encoding.

### Benchmark

`bench-github/src/runner.ts` orchestrates runs: clones a test repo, writes condition-specific AGENTS.md, invokes the agent (codex or claude), parses JSONL usage, and runs the LLM grader. Conditions are defined in `bench-github/config/conditions.yaml`, tasks in `bench-github/config/tasks.yaml`. Results go to `bench-github/results/`, published results in `bench-github/published-results/`.

### Benchmark (Browser)

`bench-browser/src/runner.ts` orchestrates browser benchmark runs: creates a workspace with condition-specific CLAUDE.md, manages browser daemon lifecycle, invokes Claude with `--bare` isolation, parses JSONL usage, and grades results. Conditions are defined in `bench-browser/config/conditions.yaml`, tasks in `bench-browser/config/tasks.yaml`.

## Conventions

- Both packages use ES modules (`"type": "module"`) with TypeScript targeting ES2022/Node16.
- Tests are colocated in `test/` directories mirroring `src/` structure and use vitest.
- TOON output goes to stdout; errors also go to stdout in structured format. stderr is reserved for debug/diagnostics only.
- Releases are automated via release-please on the `gh-axi` package only.
