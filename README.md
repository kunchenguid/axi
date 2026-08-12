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

AXI is a **new paradigm** - agent-native CLI tools built from **10 design principles** that treat token budget as a first-class constraint.

## Results

### Browser Benchmark

Evaluated across 490 runs (14 tasks × 7 conditions × 5 repeats) using Claude Sonnet 4.6:

| Condition                      | Success  | Avg Cost   | Avg Duration | Avg Turns |
| ------------------------------ | -------- | ---------- | ------------ | --------- |
| **chrome-devtools-axi**        | **100%** | **$0.074** | **21.5s**    | **4.5**   |
| dev-browser                    | 99%      | $0.078     | 28.6s        | 4.9       |
| agent-browser                  | 99%      | $0.088     | 24.6s        | 4.8       |
| chrome-devtools-mcp-compressed | 100%     | $0.091     | 29.7s        | 7.6       |
| chrome-devtools-mcp-search     | 99%      | $0.096     | 29.4s        | 7.5       |
| chrome-devtools-mcp            | 99%      | $0.101     | 26.0s        | 6.2       |
| chrome-devtools-mcp-code       | 100%     | $0.120     | 36.2s        | 6.4       |

### GitHub Benchmark

Evaluated across 425 runs (17 tasks × 5 conditions × 5 repeats) using Claude Sonnet 4.6:

| Condition               | Success  | Avg Cost   | Avg Duration | Avg Turns |
| ----------------------- | -------- | ---------- | ------------ | --------- |
| **gh-axi**              | **100%** | **$0.050** | **15.7s**    | **3**     |
| gh (CLI)                | 86%      | $0.054     | 17.4s        | 3         |
| GitHub MCP              | 87%      | $0.148     | 34.2s        | 6         |
| GitHub MCP + ToolSearch | 82%      | $0.147     | 41.1s        | 8         |
| MCP + Code Mode         | 84%      | $0.101     | 43.4s        | 7         |

Claude Sonnet 4.6 is the model the published runs used, not a limit of the
harness. Both benchmarks take `--model`, which is passed straight through to
the agent CLI, so any Claude model works - for example
`--model claude-opus-4-6`. Results for other models are simply not published
here, and they may respond differently to output format.

## Quick Start

Reference AXI implementations:

- [`gh-axi`](https://github.com/kunchenguid/gh-axi) — GitHub operations
- [`chrome-devtools-axi`](https://github.com/kunchenguid/chrome-devtools-axi) — Browser automation

See the full [AXI Catalog](#axi-catalog) below for all official and community AXIs.

```sh
npm install -g gh-axi
npm install -g chrome-devtools-axi
```

Add to your `CLAUDE.md` or `AGENTS.md`:

```
Use `gh-axi` for GitHub and `chrome-devtools-axi` for browser automation.
```

## The 10 Principles

These principles define what makes a CLI tool "an AXI".
The table below is generated from [`principles.yaml`](principles.yaml); the full specification of each principle lives in the [AXI skill](.agents/skills/axi/SKILL.md).

<!-- generated:principles:start -->

| #   | Principle                          | Summary                                                                                     |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | **Token-efficient output**         | Use [TOON](https://toonformat.dev/) format for ~40% token savings over JSON                 |
| 2   | **Minimal default schemas**        | 3–4 fields per list item, not 10+                                                           |
| 3   | **Content truncation**             | Truncate large text with size hints and a `--full` escape hatch                             |
| 4   | **Pre-computed aggregates**        | Include aggregated counts and statuses that eliminate round trips                           |
| 5   | **Definitive empty states**        | Explicit "0 results" rather than ambiguous empty output                                     |
| 6   | **Structured errors & exit codes** | Idempotent mutations, structured errors, no interactive prompts, fail loud on unknown flags |
| 7   | **Ambient context**                | Install opt-in session integrations first, then offer an on-demand skill                    |
| 8   | **Content first**                  | Running with no arguments shows live data, not help text                                    |
| 9   | **Contextual disclosure**          | Include next-step suggestions after each output                                             |
| 10  | **Consistent way to get help**     | Concise per-subcommand reference when agents need it                                        |

<!-- generated:principles:end -->

## AXI Catalog

The catalog tables below are generated from [`catalog.yaml`](catalog.yaml) - see [CONTRIBUTING.md](CONTRIBUTING.md) to add your AXI.

### Official

Reference implementations maintained by the AXI project, validating the principles across different domains:

<!-- generated:catalog-official:start -->

| AXI                                                                         | Domain             | What it does                                                                                                                      |
| --------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| [`gh-axi`](https://github.com/kunchenguid/gh-axi)                           | GitHub             | Issues, PRs, workflow runs, releases, and more. Wraps the official `gh` CLI with agent-ergonomic output.                          |
| [`chrome-devtools-axi`](https://github.com/kunchenguid/chrome-devtools-axi) | Browser automation | Navigate, click, fill, and extract with combined operations and query filtering. Wraps chrome-devtools-mcp.                       |
| [`lavish-axi`](https://github.com/kunchenguid/lavish-axi)                   | Human review       | Turns agent-generated HTML artifacts into collaborative review surfaces - annotate, comment, and send feedback back to the agent. |
| [`quota-axi`](https://github.com/kunchenguid/quota-axi)                     | Quota / usage      | Reports local Claude, Codex, Cursor, Copilot, and Grok quota/usage windows for routing-aware agents - data-only and local-first.  |

<!-- generated:catalog-official:end -->

### Community

AXIs built and maintained by the community:

<!-- generated:catalog-community:start -->

| AXI                                                                                                | Author             | Domain                | What it does                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------- | ------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`jj-axi`](https://github.com/aivv73/jj-axi)                                                       | aivv73             | Version control       | Inspect and reshape Jujutsu history through deterministic, non-interactive commands with compact TOON output and operation-aware undo.                                                                                                               |
| [`npm-axi`](https://github.com/SSBrouhard/npm-axi)                                                 | SSBrouhard         | npm                   | Search and inspect npm registry packages, versions, dependencies, README previews, and downloads with token-efficient output.                                                                                                                        |
| [`sqlite-axi`](https://github.com/SSBrouhard/sqlite-axi)                                           | SSBrouhard         | SQLite                | Inspect schemas, sample rows, and run capped read-only SQLite queries with token-efficient TOON output.                                                                                                                                              |
| [`slack-axi`](https://github.com/JarvusInnovations/slack-axi)                                      | Jarvus Innovations | Slack                 | Read, search, sweep, and safely draft Slack messages with token-efficient output.                                                                                                                                                                    |
| [`gws-axi`](https://github.com/JarvusInnovations/gws-axi)                                          | Jarvus Innovations | Google Workspace      | Gmail, Calendar, Docs, Drive, and Slides behind one command, with multi-account write-safety - drafts mail, never sends.                                                                                                                             |
| [`harvest-axi`](https://github.com/JarvusInnovations/harvest-axi)                                  | Jarvus Innovations | Time tracking         | Review, log, and edit Harvest time entries by period - for yourself, your team, a project, or a client.                                                                                                                                              |
| [`specops`](https://github.com/JarvusInnovations/specops)                                          | Jarvus Innovations | Spec-driven dev       | Spec-driven development for agents - and a demo of shipping an AXI embedded in a skill, not a standalone npm executable.                                                                                                                             |
| [`gitsheets-axi`](https://github.com/JarvusInnovations/gitsheets/tree/main/packages/gitsheets-axi) | Jarvus Innovations | Git-backed data       | Read and mutate git-backed record sheets over the shell - TOON output, idempotent commits.                                                                                                                                                           |
| [`metabase-axi`](https://github.com/JarvusInnovations/metabase-axi)                                | Jarvus Innovations | Analytics / BI        | Query, explore, and export from Metabase over the shell - SQL/MBQL, saved questions, schema introspection, full-data export.                                                                                                                         |
| [`otter-axi`](https://github.com/JarvusInnovations/otter-axi)                                      | Jarvus Innovations | Meetings              | Find and pull Otter.ai meeting transcripts from the shell - wraps Otter.ai's hosted MCP server as a scriptable, headless CLI.                                                                                                                        |
| [`notion-axi`](https://github.com/maximebrmd/notion-axi)                                           | maximebrmd         | Notion                | Search, read, create, and update Notion pages and databases over the shell - token-efficient TOON output, PAT or integration auth.                                                                                                                   |
| [`clickup-axi`](https://github.com/JanSuthacheeva/clickup-axi)                                     | JanSuthacheeva     | ClickUp               | List your open tasks, view a task with its newest comments inline, and change task status - truncation-aware, TOON-style output.                                                                                                                     |
| [`databricks-axi`](https://github.com/p33ves/databricks-axi)                                       | p33ves             | Databricks            | Run Databricks jobs, watch runs, and pull failure logs inline over the official databricks CLI - more domains coming soon.                                                                                                                           |
| [`aws-axi`](https://github.com/thatdudealso/aws-axi)                                               | thatdudealso       | AWS                   | Discover, plan, provision, deploy, and inspect AWS services for hosting web, backend, database, and AI workloads through safe token-efficient CLI workflows.                                                                                         |
| [`docker-axi`](https://github.com/thatdudealso/docker-axi)                                         | thatdudealso       | Docker                | Discover, build, run, debug, publish, inspect, and clean up Docker apps through safe token-efficient CLI workflows.                                                                                                                                  |
| [`dynamodb-axi`](https://github.com/thatdudealso/dynamodb-axi)                                     | thatdudealso       | DynamoDB              | Discover, inspect, query, scan, create, update, back up, restore, export, import, and safely operate DynamoDB tables through token-efficient CLI workflows.                                                                                          |
| [`pg-axi`](https://github.com/thatdudealso/pg-axi)                                                 | thatdudealso       | PostgreSQL            | Discover, create, inspect, query, back up, restore, and maintain PostgreSQL databases through safe token-efficient CLI workflows.                                                                                                                    |
| [`mongodb-axi`](https://github.com/thatdudealso/mongodb-axi)                                       | thatdudealso       | MongoDB               | Discover, create, inspect, query, export, import, maintain, and diagnose MongoDB databases through safe token-efficient CLI workflows.                                                                                                               |
| [`elasticsearch-axi`](https://github.com/thatdudealso/elasticsearch-axi)                           | thatdudealso       | Elasticsearch         | Discover, inspect, query, index, map, snapshot, restore, diagnose, and operate Elasticsearch clusters through safe token-efficient CLI workflows.                                                                                                    |
| [`kubernetes-axi`](https://github.com/thatdudealso/kubernetes-axi)                                 | thatdudealso       | Kubernetes            | Discover, inspect, deploy, debug, scale, roll out, expose, and clean up Kubernetes workloads through safe token-efficient CLI workflows.                                                                                                             |
| [`redis-axi`](https://github.com/thatdudealso/redis-axi)                                           | thatdudealso       | Redis                 | Discover, inspect, query, export, import, maintain, and diagnose Redis databases through safe token-efficient CLI workflows.                                                                                                                         |
| [`celery-axi`](https://github.com/thatdudealso/celery-axi)                                         | thatdudealso       | Celery                | Discover, inspect, run, debug, monitor, schedule, control, and safely operate Celery task queues through token-efficient CLI workflows.                                                                                                              |
| [`cyber-mux`](https://github.com/cyberuni/cyber-mux)                                               | unional            | Terminal multiplexers | Open, send, read, focus, and close terminal panes across tmux, herdr, and WezTerm through one detection-driven contract with token-efficient output.                                                                                                 |
| [`oracle-axi`](https://github.com/thatdudealso/oracle-axi)                                         | thatdudealso       | Oracle Database       | Discover, create, inspect, query, export, import, maintain, and diagnose Oracle databases through safe token-efficient CLI workflows.                                                                                                                |
| [`glab-axi`](https://github.com/karotkriss/glab-axi)                                               | karotkriss         | GitLab                | Issues, merge requests, CI/CD pipelines, variables and secrets, releases, and raw API access. Wraps the official glab CLI with agent-ergonomic TOON output.                                                                                          |
| [`reactive-axi`](https://github.com/adeeshsharma/reactive-axi)                                     | adeeshsharma       | UI review             | Click any element in your live React, Vue, or Svelte dev server and resolve it to the exact source file and line before it reaches your agent.                                                                                                       |
| [`obsidian-axi`](https://github.com/AndersHoffmann/obsidian-axi)                                   | AndersHoffmann     | Obsidian              | Read, search, create, update, organize, and link Obsidian notes from the filesystem - compact TOON output, atomic writes, no plugin or server.                                                                                                       |
| [`comfy-cloud-axi`](https://github.com/intelligentrascal/comfy-cloud-axi)                          | intelligentrascal  | AI generation         | Generate images, video, and audio via 22 partner models, submit ComfyUI workflows and templates, track jobs, estimate credits before generating, search nodes, and report usage — wraps the Comfy Cloud MCP server with token-efficient TOON output. |
| [`mobbin-axi`](https://github.com/intelligentrascal/mobbin-axi)                                    | intelligentrascal  | UI/UX research        | Search real-world UI/UX patterns from production apps via Mobbin - wraps Mobbin's OAuth-gated MCP server as a scriptable, headless CLI with token-efficient TOON output.                                                                             |
| [`calendly-axi`](https://github.com/JarvusInnovations/calendly-axi)                                | Jarvus Innovations | Scheduling            | The Calendly booking loop from the shell - see what's scheduled, mint single-use booking links, book directly, cancel, and manage event types, availability, and webhooks.                                                                           |

<!-- generated:catalog-community:end -->

Built an AXI? Follow the [contributor workflow](CONTRIBUTING.md) to add it to this list.

## Build Your Own AXI

Install the AXI skill to get the design guidelines and scaffolding for building an AXI-compliant CLI:

```sh
npx skills add kunchenguid/axi
```

This installs the [AXI skill](.agents/skills/axi/SKILL.md) - a detailed guide with examples for each principle that your coding agent can reference while building.
For your own AXI, expose an explicit setup command for session hooks as the primary integration, then ship an installable Agent Skill as a lower-overhead secondary path.
Users only need one path, but hooks and skills complement each other when both are available.

## Development

### Browser Benchmark

The browser benchmark harness lives in `bench-browser/`. It compares browser automation tools across 16 browsing tasks.

```sh
pnpm install

# Run a single condition × task
pnpm --dir bench-browser run bench -- run --condition chrome-devtools-axi --task read_static_page

# Run the full matrix
pnpm --dir bench-browser run bench -- matrix --repeat 5

# Generate summary report
pnpm --dir bench-browser run bench -- report

# Render the social video
pnpm --dir bench-browser run render:social
```

The HyperFrames composition for the social asset lives in `bench-browser/social/`. Edit `social/index.html` for the animation and render `docs/social/rendered/race.mp4` with `pnpm --dir bench-browser run render:social`.

Published results (490 runs): [`bench-browser/published-results/report.md`](bench-browser/published-results/report.md)

### GitHub Benchmark

The GitHub benchmark harness lives in `bench-github/`. It runs agent tasks across different interface conditions and grades results with an LLM judge.

```sh
pnpm install

# Run a single condition × task
pnpm --dir bench-github run bench -- run --condition axi --task merged_pr_ci_audit --repeat 5 --agent claude

# Run the full matrix
pnpm --dir bench-github run bench -- matrix --repeat 5 --agent claude

# Generate summary report
pnpm --dir bench-github run bench -- report
```

Published results (425 runs): [`bench-github/published-results/STUDY.md`](bench-github/published-results/STUDY.md)

## Contributing

Contributions targeting `main` must be submitted through the [contributor workflow](CONTRIBUTING.md), which uses `no-mistakes` and guards release-please-generated files from hand edits.

## Links

- [Website](https://axi.md)
- [AXI Skill definition](.agents/skills/axi/SKILL.md)
- [Browser benchmark study](bench-browser/published-results/STUDY.md)
- [GitHub benchmark study](bench-github/published-results/STUDY.md)
