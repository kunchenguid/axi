# AXI: Agent eXperience Interface

<h3 align="center">A new standard for agent ergonomics which beats both MCP and regular CLI in success rate and efficiency.</h3>

AI agents interact with external services through two dominant paradigms today: **CLIs** which were originally built for humans, and structured tool protocols like **MCP**. Both impose significant overhead — CLIs produce verbose, metadata-sparse output that wastes token budgets, while MCP tool schemas consume a lot of context tokens upfront.

AXI is a **new paradigm** — agent-native CLI tools built from **10 design principles** that treat token budget as a first-class constraint. An AXI provides token-optimized output formatting, pre-computed aggregate fields, contextual next-step suggestions, and structured error handling. **`gh-axi`** is the first AXI — a `gh` wrapper you can install today and point your agent at via `CLAUDE.md` or `AGENTS.md`.

## Results

Evaluated across 425 benchmark runs (17 tasks × 5 conditions × 5 repeats) using Claude Sonnet 4.6:

| Condition               | Success  | Avg Cost   | Avg Duration | Avg Turns |
| ----------------------- | -------- | ---------- | ------------ | --------- |
| **gh-axi**              | **100%** | **$0.050** | **15.7s**    | **3**     |
| gh (CLI)                | 86%      | $0.054     | 17.4s        | 3         |
| GitHub MCP              | 87%      | $0.148     | 34.2s        | 6         |
| GitHub MCP + ToolSearch | 82%      | $0.147     | 41.1s        | 8         |
| MCP + Code Mode         | 84%      | $0.101     | 43.4s        | 7         |

## Quick Start

`gh-axi` is the reference AXI implementation — an ergonomic wrapper around the `gh` CLI.

```sh
$ npm install -g gh-axi
```

Add to your `CLAUDE.md` or `AGENTS.md`:

```
Use `gh-axi` (replacement for `gh` CLI) for all GitHub operations.
```

That's it. Your agent now gets structured, token-efficient GitHub output.

## The 10 Principles

These principles define what makes a CLI tool "an AXI":

| #   | Principle                   | Summary                                                                     |
| --- | --------------------------- | --------------------------------------------------------------------------- |
| 1   | **Token-efficient output**  | Use [TOON](https://toonformat.dev/) format for ~40% token savings over JSON |
| 2   | **Content first**           | Running with no arguments shows live data, not help text                    |
| 3   | **Contextual disclosure**   | Include next-step suggestions after each output                             |
| 4   | **Provide --help**          | Concise per-subcommand reference when agents need it                        |
| 5   | **Minimal default schemas** | 3–4 fields per list item, not 10                                            |
| 6   | **Pre-computed fields**     | Include aggregated statuses that eliminate round trips                      |
| 7   | **Content truncation**      | Truncate large text with size hints and `--full` escape hatch               |
| 8   | **Definitive empty states** | Explicit "0 results" rather than ambiguous empty output                     |
| 9   | **Error handling**          | Idempotent mutations, structured errors, no interactive prompts             |
| 10  | **Output discipline**       | stdout for data, stderr for debug; clean exit codes                         |

## Build Your Own AXI

Install the AXI skill to get the design guidelines and scaffolding for building an AXI-compliant CLI:

```sh
$ npx skills add kunchenguid/axi
```

This installs the [AXI skill](.agents/skills/axi/SKILL.md) — a detailed guide with examples for each principle that your coding agent can reference while building.

## gh-axi

`gh-axi` wraps the `gh` CLI with token-efficient TOON output, pre-computed fields, contextual suggestions, and structured errors. See the [gh-axi README](gh-axi/) for full usage and command reference.

```sh
$ gh-axi pr list --state merged --limit 3
count: 3 of 3549
pull_requests[3]{number,title,state,author}:
  51772,"refactor(plugins): route Telegram...",merged,dependabot
  51770,"fix(core): handle nil pointer in...",merged,alice
  51769,"feat(auth): add OAuth2 PKCE flow",merged,bob
help[1]:
  Run `gh-axi pr view <number>` to see full details
```

## Development

### gh-axi

```sh
cd gh-axi
npm install       # Install dependencies
npm run dev       # Run in development (tsx)
npm run build     # Build (tsc)
npm test          # Run tests (vitest)
```

Requires Node.js >= 20 and the [GitHub CLI](https://cli.github.com/) (`gh`) installed and authenticated.

### Running the Benchmark

The GitHub benchmark harness lives in `bench-github/`. It runs agent tasks across different interface conditions and grades results with an LLM judge.

```sh
cd bench-github
npm install

# Run a single condition × task
npm run bench -- run --condition axi --task merged_pr_ci_audit --repeat 5 --agent claude

# Run the full matrix (all conditions × all tasks)
npm run bench -- matrix --repeat 5 --agent claude

# Generate summary report from results
npm run bench -- report
```

**Conditions:** `axi`, `cli`, `mcp-no-toolsearch`, `mcp-with-toolsearch`, `mcp-with-code-mode`

Results are written to `bench-github/results/`. Published results from the study (425 runs) are in [`bench-github/published-results/`](bench-github/published-results/STUDY.md).

### Running the Browser Benchmark

The browser benchmark harness lives in `bench-browser/`. It compares browser automation tools across 16 browsing tasks.

```sh
cd bench-browser
npm install

# Run a single condition × task
npm run bench -- run --condition agent-browser --task read_static_page

# Run the full matrix (all conditions × all tasks)
npm run bench -- matrix --repeat 5

# Generate summary report from results
npm run bench -- report
```

**Conditions:** `agent-browser`, `pinchtab`, `chrome-devtools-mcp`

## Links

- [Website](https://axi.md)
- [AXI Skill definition](.agents/skills/axi/SKILL.md)
- [GitHub benchmark study](bench-github/published-results/STUDY.md)
