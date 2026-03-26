# Browser Benchmark Study: Agent Interface Comparison

## Overview

This study compares how AI agents perform browser automation tasks across different interface paradigms: CLI tools, MCP servers, code execution, and compressed MCP wrappers. All conditions target the same set of public websites and are graded by an LLM judge.

**Agent**: Claude Sonnet 4.6 (`claude-sonnet-4-6`)
**Judge**: Claude Sonnet 4.6
**Repeats**: 5 per condition × task
**Total runs**: 480 (6 conditions × 16 tasks × 5 repeats)
**Total cost**: ~$84
**Date**: 2026-03-25

## Conditions

| Condition                            | Interface             | Description                                                                                                                  |
| ------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `agent-browser`                      | Bash CLI (Rust)       | Vercel's Agent Browser. Agent runs `agent-browser navigate`, `agent-browser snapshot`, etc.                                  |
| `pinchtab`                           | Bash CLI (Go)         | PinchTab CLI. Agent runs `pinchtab nav`, `pinchtab snap`, etc.                                                               |
| `chrome-devtools-mcp`                | MCP (no ToolSearch)   | Chrome DevTools MCP server. All ~30 tool schemas loaded upfront. Agent calls tools directly.                                 |
| `chrome-devtools-mcp-search`         | MCP (with ToolSearch) | Same server, but tools discovered on-demand via ToolSearch.                                                                  |
| `chrome-devtools-mcp-code`           | TypeScript scripts    | Agent writes `.ts` scripts calling `callTool(name, args)` which forwards to chrome-devtools-mcp via a persistent MCP bridge. |
| `chrome-devtools-mcp-compressed-cli` | MCP Compressor (CLI)  | mcp-compressor CLI mode generates a `chrome-devtools` shell command wrapping the MCP server. Agent uses Bash.                |

All MCP-based conditions use the same backend: `chrome-devtools-mcp@latest --headless --isolated`.

## Key Results

| Condition                          | Success% | Avg Cost   | Total Cost | Avg Duration | Avg Turns |
| ---------------------------------- | -------- | ---------- | ---------- | ------------ | --------- |
| **agent-browser**                  | **96%**  | **$0.164** | $13.15     | **30.3s**    | 6.3       |
| pinchtab                           | 94%      | $0.178     | $14.23     | 36.5s        | 7.2       |
| chrome-devtools-mcp-compressed-cli | 94%      | $0.167     | $13.37     | 31.2s        | 6.2       |
| chrome-devtools-mcp                | 93%      | $0.176     | $14.06     | 31.3s        | 6.0       |
| chrome-devtools-mcp-code           | 91%      | $0.208     | $16.62     | 45.5s        | 8.1       |
| chrome-devtools-mcp-search         | 71%      | $0.168     | $13.42     | 34.8s        | 6.5       |

## Findings

### 1. CLI tools outperform MCP for browser automation

The two CLI conditions (agent-browser, pinchtab) achieve the highest success rates (96%, 94%) at the lowest costs ($0.164, $0.178). CLI tools benefit from simple, predictable interfaces — the agent learns the command set from the system prompt and executes directly without schema discovery overhead.

### 2. ToolSearch severely hurts browser automation

ToolSearch (71%) drops 22 percentage points vs eager-loading (93%). Chrome DevTools MCP exposes ~30 tools, and ToolSearch forces the agent to discover them on-demand. Key failures:

| Task                         | No ToolSearch | With ToolSearch |
| ---------------------------- | ------------- | --------------- |
| `github_repo_stars`          | 5/5           | 0/5             |
| `navigate_404`               | 5/5           | 0/5             |
| `github_issue_investigation` | 5/5           | 1/5             |
| `wikipedia_infobox_hop`      | 5/5           | 3/5             |
| `wikipedia_search_click`     | 5/5           | 3/5             |

The agent wastes turns searching for tools (e.g., querying for "navigate" when the tool is `navigate_page`), and the discovery overhead compounds on multi-step tasks where each step requires finding a new tool.

This mirrors the GitHub benchmark finding: ToolSearch is a net negative when the agent needs most of the tools. The upfront context cost of loading all schemas (~30 tools) is far cheaper than the cumulative cost of discovery turns.

### 3. MCP Compressor CLI mode matches dedicated CLI tools

MCP Compressor's CLI mode (94%, $0.167, 31.2s) performs on par with dedicated CLI tools (agent-browser: 96%, $0.164, 30.3s) despite wrapping the same chrome-devtools-mcp backend. The auto-generated `chrome-devtools` CLI command gives the agent a familiar Bash interface without requiring a purpose-built tool.

### 4. Code mode is competitive but adds latency

Code execution (91%) is close to MCP (93%) in success but 45% slower (45.5s vs 31.3s). The agent spends time writing scripts, and each `npx tsx` invocation has startup overhead. However, code mode's `callTool(name, args)` interface is nearly identical to raw MCP — the comparison isolates the "write and execute code" paradigm from the tool interface itself.

### 5. `github_navigate_to_file` is universally hard

This task (navigate to torvalds/linux → find MAINTAINERS file → report first maintainer) has the lowest success rate across all conditions:

| Condition                          | Success |
| ---------------------------------- | ------- |
| agent-browser                      | 2/5     |
| pinchtab                           | 1/5     |
| chrome-devtools-mcp                | 0/5     |
| chrome-devtools-mcp-search         | 1/5     |
| chrome-devtools-mcp-code           | 0/5     |
| chrome-devtools-mcp-compressed-cli | 0/5     |

The GitHub file browser is complex — deeply nested DOM, dynamic loading, and the MAINTAINERS file is large. All tools struggle with multi-step repository navigation. This suggests a task design issue rather than a tool limitation; the task may be too dependent on GitHub's UI implementation.

### 6. Simple tasks are solved by all conditions

Single-step tasks (`read_static_page`, `wikipedia_fact_lookup`, `wikipedia_table_read`) achieve near-100% success across all conditions except ToolSearch. The browser automation tools are all capable — the differences emerge on complex multi-step workflows.

## Task Categories

### Single-step (5 tasks): Navigate + read one page

All conditions score 90%+ except ToolSearch. Tasks use stable targets (example.com, Wikipedia, httpbin.org).

### Multi-step (5 tasks): Navigate + interact + follow links

CLI tools average 96% vs MCP's 85%. The extra interaction steps amplify any interface overhead.

### Investigation (4 tasks): Complex multi-page extraction

Success ranges from 75% (ToolSearch) to 100% (agent-browser on some tasks). These tasks require maintaining context across many page navigations.

### Error recovery (2 tasks): Handle failures gracefully

All conditions handle 404s and missing elements well (90%+ except ToolSearch at 50%).

## Methodology

- Each run creates a fresh workspace with condition-specific `CLAUDE.md`
- Agent isolation via `--strict-mcp-config` (prevents local MCP server leakage)
- All MCP conditions use `--headless --isolated` Chrome (no UI popups, clean profile per run)
- Code-mode uses a persistent MCP bridge (supergateway → chrome-devtools-mcp) for cross-script state
- Agent output captured as stream-json and parsed for usage metrics (tokens, cost, duration, turns)
- A separate judge LLM evaluates the trajectory against task-specific grading hints

## Files

- `results.jsonl` — Raw results (one JSON object per run)
- `report.md` — Summary tables with per-task breakdowns
- `report.csv` — Full CSV export for analysis
- `{condition}/{task}/run{N}/` — Per-run artifacts:
  - `agent_output.txt` — Raw agent stream-json output
  - `grade.json` — Judge verdict (`{task_success, details}`)
  - `judge_output.txt` — Full judge response
