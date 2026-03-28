# AXI: Agent eXperience Interface

<h3 align="center">10 design principles for building agent-ergonomic apps.</h3>

<p align="center">
  <img src="docs/axi-splash.png" alt="AXI — Let's build apps agents love." width="800">
</p>

AI agents interact with external services through two dominant paradigms today: **CLIs** which were originally built for humans, and structured tool protocols like **MCP**. Both impose significant overhead.

AXI is a **new paradigm** — agent-native CLI tools built from **10 design principles** that treat token budget as a first-class constraint.

## Results

### Browser Benchmark

Evaluated across 560 runs (16 tasks × 7 conditions × 5 repeats) using Claude Sonnet 4.6:

| Condition                      | Success  | Avg Cost   | Avg Duration | Avg Turns |
| ------------------------------ | -------- | ---------- | ------------ | --------- |
| **chrome-devtools-axi**        | **100%** | **$0.133** | **24.1s**    | **4.6**   |
| **agent-browser-axi**          | **100%** | **$0.137** | **26.9s**    | **5.0**   |
| chrome-devtools-mcp-compressed | 100%     | $0.150     | 32.6s        | 5.9       |
| agent-browser                  | 100%     | $0.160     | 33.9s        | 7.2       |
| chrome-devtools-mcp            | 100%     | $0.168     | 27.2s        | 5.4       |
| chrome-devtools-mcp-code       | 99%      | $0.177     | 42.9s        | 6.6       |
| chrome-devtools-mcp-search     | 85%      | $0.167     | 39.1s        | 7.1       |

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
$ npm install -g gh-axi
$ npm install -g chrome-devtools-axi
```

Add to your `CLAUDE.md` or `AGENTS.md`:

```
Use `gh-axi` for GitHub and `chrome-devtools-axi` for browser automation.
```

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

## Development

### Browser Benchmark

The browser benchmark harness lives in `bench-browser/`. It compares browser automation tools across 16 browsing tasks.

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

### GitHub Benchmark

The GitHub benchmark harness lives in `bench-github/`. It runs agent tasks across different interface conditions and grades results with an LLM judge.

```sh
cd bench-github
npm install

# Run a single condition × task
npm run bench -- run --condition axi --task merged_pr_ci_audit --repeat 5 --agent claude

# Run the full matrix
npm run bench -- matrix --repeat 5 --agent claude

# Generate summary report
npm run bench -- report
```

Published results (425 runs): [`bench-github/published-results/STUDY.md`](bench-github/published-results/STUDY.md)

## Links

- [Website](https://axi.md)
- [AXI Skill definition](.agents/skills/axi/SKILL.md)
- [Browser benchmark study](bench-browser/published-results/STUDY.md)
- [GitHub benchmark study](bench-github/published-results/STUDY.md)
