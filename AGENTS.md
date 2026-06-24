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

## Conventions

- Packages use ES modules (`"type": "module"`) with TypeScript targeting ES2022/Node16.
- Tests are colocated in `test/` directories mirroring `src/` structure and use vitest.
