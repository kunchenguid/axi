<h1 align="center">AXI: Agent eXperience Interface</h1>

<p align="center">
  <a href="https://axi.md"><img alt="Website" src="https://img.shields.io/badge/axi.md-Website-blue?style=flat-square" /></a>
  <a href="https://x.com/kunchenguid"><img alt="X" src="https://img.shields.io/badge/X-@kunchenguid-black?style=flat-square" /></a>
  <a href="https://discord.gg/Wsy2NpnZDu"><img alt="Discord" src="https://img.shields.io/discord/1439901831038763092?style=flat-square&label=discord" /></a>
</p>

<h3 align="center">10 design principles for building agent-ergonomic apps.</h3>

<p align="center">
  <img src="docs/axi-splash.png" alt="AXI — Let's build apps agents love." width="800">
</p>

AI agents interact with external services through two dominant paradigms today: **CLIs** which were originally built for humans, and structured tool protocols like **MCP**. Both impose significant overhead.

AXI is a **new paradigm** — agent-native CLI tools built from **10 design principles** that treat token budget as a first-class constraint.

## Results

### Browser Benchmark

Evaluated across 560 runs (14 tasks × 8 conditions × 5 repeats) using Claude Sonnet 4.6:

| Condition                      | Success  | Avg Cost   | Avg Duration | Avg Turns |
| ------------------------------ | -------- | ---------- | ------------ | --------- |
| **chrome-devtools-axi**        | **100%** | $0.074     | **21.5s**    | **4.5**   |
| chrome-devtools-mcp-compressed | 100%     | $0.091     | 29.7s        | 7.6       |
| chrome-devtools-mcp-code       | 100%     | $0.120     | 36.2s        | 6.4       |
| actionbook                     | 99%      | **$0.066** | 24.1s        | 5.3       |
| dev-browser                    | 99%      | $0.078     | 28.6s        | 4.9       |
| agent-browser                  | 99%      | $0.088     | 24.6s        | 4.8       |
| chrome-devtools-mcp-search     | 99%      | $0.096     | 29.4s        | 7.5       |
| chrome-devtools-mcp            | 99%      | $0.101     | 26.0s        | 6.2       |

### GitHub Benchmark

Evaluated across 425 runs (17 tasks × 5 conditions × 5 repeats) using Claude Sonnet 4.6:

| Condition               | Success  | Avg Cost   | Avg Duration | Avg Turns |
| ----------------------- | -------- | ---------- | ------------ | --------- |
| **gh-axi**              | **100%** | **$0.050** | **15.7s**    | **3**     |
| gh (CLI)                | 86%      | $0.054     | 17.4s        | 3         |
| GitHub MCP              | 87%      | $0.148     | 34.2s        | 6         |
| GitHub MCP + ToolSearch | 82%      | $0.147     | 41.1s        | 8         |
| MCP + Code Mode         | 84%      | $0.101     | 43.4s        | 7         |

## Quick Start

Reference AXI implementations:

- [`gh-axi`](https://github.com/kunchenguid/gh-axi) — GitHub operations
- [`chrome-devtools-axi`](https://github.com/kunchenguid/chrome-devtools-axi) — Browser automation

```sh
npm install -g gh-axi
npm install -g chrome-devtools-axi
```

Add to your `CLAUDE.md` or `AGENTS.md`:

```
Use `gh-axi` for GitHub and `chrome-devtools-axi` for browser automation.
```

## The 10 Principles

These principles define what makes a CLI tool "an AXI":

| #   | Principle                          | Summary                                                                     |
| --- | ---------------------------------- | --------------------------------------------------------------------------- |
| 1   | **Token-efficient output**         | Use [TOON](https://toonformat.dev/) format for ~40% token savings over JSON |
| 2   | **Minimal default schemas**        | 3–4 fields per list item, not 10                                            |
| 3   | **Content truncation**             | Truncate large text with size hints and `--full` escape hatch               |
| 4   | **Pre-computed aggregates**        | Include aggregated counts and statuses that eliminate round trips           |
| 5   | **Definitive empty states**        | Explicit "0 results" rather than ambiguous empty output                     |
| 6   | **Structured errors & exit codes** | Idempotent mutations, structured errors, no interactive prompts             |
| 7   | **Ambient context**                | Self-install into session hooks so agents see state before invoking         |
| 8   | **Content first**                  | Running with no arguments shows live data, not help text                    |
| 9   | **Contextual disclosure**          | Include next-step suggestions after each output                             |
| 10  | **Consistent way to get help**     | Concise per-subcommand reference when agents need it                        |

## Build Your Own AXI

Install the AXI skill to get the design guidelines and scaffolding for building an AXI-compliant CLI:

```sh
npx skills add kunchenguid/axi
```

This installs the [AXI skill](.agents/skills/axi/SKILL.md) — a detailed guide with examples for each principle that your coding agent can reference while building.

## Development

### Browser Benchmark

The browser benchmark harness lives in `bench-browser/`. It compares browser automation tools across 14 browsing tasks.

```sh
cd bench-browser
npm install

# Run a single condition × task
npm run bench -- run --condition chrome-devtools-axi --task read_static_page

# Run the full matrix
npm run bench -- matrix --repeat 5

# Generate summary report
npm run bench -- report
```

Published results (560 runs): [`bench-browser/published-results/STUDY.md`](bench-browser/published-results/STUDY.md)

#### Actionbook Benchmarking

The published browser study now includes `actionbook` as a general-purpose CLI
condition for browser automation.

Use `--claude-auth subscription` to run through an existing Claude Code login
without setting `ANTHROPIC_API_KEY`.

The repo also keeps a separate local `actionbook-parallel` condition for
independent multi-page tasks, but that strategy is intentionally excluded from
the published aggregate study because it encodes a task-specific parallel
policy rather than Actionbook's default workflow.

```sh
cd bench-browser

# Reproduce the published Actionbook baseline
npm run bench -- run --condition actionbook --task read_static_page --repeat 5 --claude-auth subscription

# Run the full Actionbook matrix
npm run bench -- matrix --condition actionbook --repeat 5 --claude-auth subscription

# Refresh published browser artifacts with the current Actionbook results
npm run publish:results -- --conditions actionbook
```

Published Actionbook summary:

- `99%` success across `70` runs
- lowest average browser cost at `$0.0656` per task
- `24.1s` average duration and `5.3` average turns
- one miss on `wikipedia_deep_extraction`, where a flattened table read omitted
  co-laureates in `1/5` runs

Useful outputs:

- `bench-browser/published-results/report.html` — published browser dashboard
- `bench-browser/results/report.html` — local exploratory dashboard, including
  any non-published conditions such as `actionbook-parallel`

### GitHub Benchmark

The GitHub benchmark harness lives in `bench-github/`. It runs agent tasks across different interface conditions and grades results with an LLM judge.

```sh
cd bench-github
npm install

# Run a single condition × task
npm run bench -- run --condition axi --task merged_pr_ci_audit --repeat 5 --agent claude --claude-auth subscription

# Run the full matrix
npm run bench -- matrix --repeat 5 --agent claude --claude-auth subscription

# Generate summary report
npm run bench -- report
```

Published results (425 runs): [`bench-github/published-results/STUDY.md`](bench-github/published-results/STUDY.md)

## Links

- [Website](https://axi.md)
- [AXI Skill definition](.agents/skills/axi/SKILL.md)
- [Browser benchmark study](bench-browser/published-results/STUDY.md)
- [GitHub benchmark study](bench-github/published-results/STUDY.md)
