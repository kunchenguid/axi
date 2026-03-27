# Browser Benchmark Study: Agent Interface Comparison

## Overview

This study compares how AI agents perform browser automation tasks across different interface paradigms: CLI tools, MCP servers, code execution, and compressed MCP wrappers. All conditions target the same set of public websites and are graded by an LLM judge.

**Agent**: Claude Sonnet 4.6 (`claude-sonnet-4-6`)
**Judge**: Claude Sonnet 4.6
**Repeats**: 5 per condition x task
**Total runs**: 560 (7 conditions x 16 tasks x 5 repeats)
**Total cost**: ~$87
**Date**: 2026-03-27

## Conditions

| Condition                            | Interface             | Description                                                                                                                   |
| ------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `agent-browser`                      | Bash CLI (Rust)       | Vercel's Agent Browser. Agent runs `agent-browser navigate`, `agent-browser snapshot`, etc.                                   |
| `agent-browser-axi`                  | Bash CLI (AXI)        | AXI wrapper around agent-browser. Combined operations (action + snapshot in one call), TOON metadata, contextual suggestions. |
| `chrome-devtools-axi`                | Bash CLI (AXI)        | AXI wrapper around chrome-devtools-mcp. Combined operations, TOON metadata, contextual suggestions.                           |
| `chrome-devtools-mcp`                | MCP (no ToolSearch)   | Chrome DevTools MCP server. All ~30 tool schemas loaded upfront. Agent calls tools directly.                                  |
| `chrome-devtools-mcp-search`         | MCP (with ToolSearch) | Same server, but tools discovered on-demand via ToolSearch.                                                                   |
| `chrome-devtools-mcp-code`           | TypeScript scripts    | Agent writes `.ts` scripts calling `callTool(name, args)` which forwards to chrome-devtools-mcp via a persistent MCP bridge.  |
| `chrome-devtools-mcp-compressed-cli` | MCP Compressor (CLI)  | mcp-compressor CLI mode generates a `chrome-devtools` shell command wrapping the MCP server. Agent uses Bash.                 |

All MCP-based conditions use the same backend: `chrome-devtools-mcp@latest --headless --isolated`.

## Key Results

| Condition                          | Success% | Avg Cost   | Total Cost | Avg Duration | Avg Turns |
| ---------------------------------- | -------- | ---------- | ---------- | ------------ | --------- |
| **chrome-devtools-axi**            | **100%** | **$0.133** | **$10.66** | **24.1s**    | **4.6**   |
| agent-browser-axi                  | 100%     | $0.137     | $11.00     | 26.9s        | 5.0       |
| chrome-devtools-mcp-compressed-cli | 100%     | $0.150     | $11.99     | 32.6s        | 5.9       |
| agent-browser                      | 100%     | $0.160     | $12.81     | 33.9s        | 7.2       |
| chrome-devtools-mcp                | 100%     | $0.168     | $13.44     | 27.2s        | 5.4       |
| chrome-devtools-mcp-code           | 99%      | $0.177     | $14.18     | 42.9s        | 6.6       |
| chrome-devtools-mcp-search         | 85%      | $0.167     | $13.39     | 39.1s        | 7.1       |

## Findings

### 1. AXI wrappers lead across every metric

The two AXI conditions (`chrome-devtools-axi` and `agent-browser-axi`) take the top two spots. `chrome-devtools-axi` achieves 100% success at the lowest cost ($0.133/task), fewest turns (4.6), and fastest execution (24.1s). The primary mechanism is **combined operations**: every action command automatically returns a page snapshot, eliminating separate snapshot calls.

| Metric           | agent-browser | agent-browser-axi | chrome-devtools-axi |
| ---------------- | ------------- | ----------------- | ------------------- |
| Success          | 100%          | 100%              | 100%                |
| Avg cost         | $0.160        | $0.137            | $0.133              |
| Avg turns        | 7.2           | 5.0               | 4.6                 |
| Avg commands     | 6.0           | 3.9               | 3.3                 |
| Avg duration     | 33.9s         | 26.9s             | 24.1s               |
| Avg input tokens | 232K          | 159K              | 142K                |

**Where the savings come from.** Trajectory analysis across all 160 AXI runs decomposes the efficiency gains into three AXI design principles:

- **Combined operations (~85% of command reduction).** Every `navigate` + `snapshot` pair in the baseline becomes a single `open` call in AXI. For `agent-browser-axi`, this accounts for 143 of 168 eliminated commands across 80 runs. For `chrome-devtools-axi` vs `chrome-devtools-mcp`, every task shows the same pattern: what required `navigate_page` then `take_snapshot` (two tool calls) becomes one `open` call.
- **TOON structured output (~10-15%).** Page metadata (title, URL, ref count) returned with every response helps the agent orient without extra probing calls. In `agent-browser` baseline runs, the agent sometimes spirals into repeated `snapshot 2>&1 | grep "heading" | head -5` sequences just to figure out what page it's on — e.g., `wikipedia_infobox_hop` run 5 ballooned to 51 commands. AXI runs avoid this entirely. A secondary factor: `chrome-devtools-mcp`'s raw accessibility snapshots sometimes exceed 400K characters on large Wikipedia pages, forcing the agent into expensive `evaluate_script` workarounds — the `wikipedia_link_follow` trajectory shows 9 MCP tool calls vs 5 AXI commands for the same task. AXI's TOON output avoids this by presenting the same snapshot in a greppable format.
- **Contextual suggestions (minor but consistent).** The `help[N]:` block provides copy-pasteable next-step commands (e.g., `Run 'chrome-devtools-axi click @1_3' to click "Learn more"`). The agent consistently follows these, maintaining a clean one-action-per-turn cadence.

**Why chrome-devtools-axi edges out agent-browser-axi.** The gap between the two AXI conditions (4.6 vs 5.0 turns, 24.1s vs 26.9s) comes from two factors:

1. **Ref stability (~60% of the turn gap).** Agent-browser refs can become stale between snapshot and click, causing "Unknown ref" errors that require recovery turns. Across 80 runs, `agent-browser-axi` encountered 14 ref failures vs zero for `chrome-devtools-axi`. The worst-affected task is `wikipedia_infobox_hop`, where ref failures in 3/5 runs inflated the average by ~4 turns. Chrome-devtools-mcp refs are stable because the click and snapshot happen in a single atomic MCP call via `includeSnapshot`.
2. **Latency (~40% of the wall-clock gap).** Chrome-devtools-axi performs action + snapshot as one MCP call internally, while agent-browser-axi shells out to two separate `agent-browser` subprocesses. Both present a single CLI call to the agent (so turn count is similar), but the two-subprocess path adds latency. This explains most of the 2.8s wall-clock difference.

Note that chrome-devtools-axi doesn't win every task — it actually loses on `github_issue_investigation` (6.4 vs 3.6 turns) and `github_repo_stars` (4.8 vs 2.8 turns) because chrome-devtools-mcp produces larger snapshots that sometimes require extra Read/Grep steps. The aggregate advantage comes from ref stability on interaction-heavy tasks outweighing snapshot verbosity on read-heavy ones.

The turn reduction from raw baseline to AXI is consistent: 36% for `agent-browser` → `chrome-devtools-axi` (7.2 → 4.6) and 31% for `agent-browser` → `agent-browser-axi` (7.2 → 5.0). This confirms the GitHub benchmark finding: AXI's combined operations consistently reduce turns without sacrificing success.

### 2. Five conditions achieve perfect 100% success

`chrome-devtools-axi`, `agent-browser-axi`, `chrome-devtools-mcp-compressed-cli`, `agent-browser`, and `chrome-devtools-mcp` all achieve 100% success across 80 runs each. The MCP Compressor CLI mode matches dedicated CLI tools by giving the agent a familiar Bash interface over the chrome-devtools-mcp backend.

### 3. ToolSearch hurts browser automation

ToolSearch (85%) drops 15 percentage points vs eager-loading (100%). Chrome DevTools MCP exposes ~30 tools, and ToolSearch forces the agent to discover them on-demand. Key failures:

| Task                         | No ToolSearch | With ToolSearch |
| ---------------------------- | ------------- | --------------- |
| `github_repo_stars`          | 5/5           | 0/5             |
| `navigate_404`               | 5/5           | 2/5             |
| `wikipedia_search_click`     | 5/5           | 3/5             |
| `wikipedia_table_read`       | 5/5           | 4/5             |
| `github_issue_investigation` | 5/5           | 4/5             |

**Root cause: `take_screenshot` vs `take_snapshot`.** Chrome-devtools-mcp exposes two similarly-named tools: `take_snapshot` (returns a compact accessibility tree) and `take_screenshot` (returns a massive base64-encoded PNG). With eager-loading, the agent's CLAUDE.md explicitly lists `take_snapshot` in its workflow, so it always picks the right tool. Under ToolSearch, the agent must guess tool names for its `select:` query — and it consistently guesses `take_screenshot` instead:

```
query: "select:mcp__chrome-devtools__navigate_page,mcp__chrome-devtools__take_screenshot"
```

The screenshot payload (~1MB base64) exhausts the context window and triggers the 5-minute timeout before the agent can produce an answer. Every failed run across all 5 tasks shows `take_screenshot` with zero `take_snapshot` calls; every successful run found the correct tool. The `github_repo_stars` 0/5 result is especially telling — it's a simple single-step task that fails 100% of the time purely from this tool selection error.

This mirrors the GitHub benchmark finding: ToolSearch is a net negative when the agent needs most of the tools. The upfront context cost of loading all schemas (~30 tools) is far cheaper than the cumulative cost of discovery mistakes.

### 4. Code mode is competitive but adds latency

Code execution (99%) nearly matches raw MCP (100%) in success but is 58% slower (42.9s vs 27.2s). The agent spends time writing scripts, and each `npx tsx` invocation has startup overhead. Its single failure was on `read_static_page` (4/5) — the simplest task — suggesting occasional brittleness in the script execution path rather than a systematic limitation.

### 5. Simple tasks are solved by all conditions

Single-step tasks (`read_static_page`, `wikipedia_fact_lookup`, `wikipedia_table_read`) achieve near-100% success across all conditions including ToolSearch. The browser automation tools are all capable — the differences emerge on complex multi-step workflows and edge cases.

## Case Studies

### A. Error recovery in 2 calls vs 4: `navigate_404`

> _Navigate to httpbin.org/status/404 and report the error, then navigate to httpbin.org/html to confirm normal browsing._

| Step | chrome-devtools-axi                                                                                                                   | chrome-devtools-mcp                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1    | `open httpbin.org/status/404` — page metadata + snapshot returned together: title, URL, "HTTP ERROR 404", and contextual suggestions. | `navigate_page(url)` — "Successfully navigated." No page content. |
| 2    | `open httpbin.org/html` — page metadata + Moby-Dick excerpt returned together.                                                        | `take_snapshot()` — error page snapshot with 404 heading.         |
| 3    | Agent delivers final answer.                                                                                                          | `navigate_page(url)` — "Successfully navigated." No page content. |
| 4    |                                                                                                                                       | `take_snapshot()` — Moby-Dick excerpt.                            |
| 5    |                                                                                                                                       | Agent delivers final answer.                                      |

| Metric     | chrome-devtools-axi | chrome-devtools-mcp |
| ---------- | :-----------------: | :-----------------: |
| Tool calls |          2          |          4          |
| Turns      |          3          |          5          |
| Cost       |       $0.104        |       $0.154        |

Each `open` combines navigate + snapshot into one call. The MCP agent needs two calls per page (`navigate_page` returns only a confirmation string, so `take_snapshot` must follow). On a 2-page task the savings are exactly 2 tool calls — one per navigation.

### B. Combined operations compound on multi-step tasks: `wikipedia_link_follow`

> _Navigate to the Ada Lovelace Wikipedia article, click the link to Charles Babbage, and report his birth date._

**chrome-devtools-axi** (5 tool calls, 6 turns, $0.15):

| Step | Call                                | Result                                                   |
| ---- | ----------------------------------- | -------------------------------------------------------- |
| 1    | `chrome-devtools-axi open <url>`    | Page metadata + full accessibility snapshot in one call. |
| 2    | `grep -i "babbage" <snapshot>`      | Found `uid=26_181 link "Charles Babbage"`.               |
| 3    | `chrome-devtools-axi click @26_181` | Clicked link + new page snapshot returned automatically. |
| 4    | `grep -i "born\|birth" <snapshot>`  | Found `uid=27_123 StaticText "Born"`.                    |
| 5    | `grep -A2 "uid=27_123" <snapshot>`  | Extracted `"26 December 1791"`.                          |

**agent-browser** (10 tool calls, 11 turns, $0.21):

| Step | Call                                   | Result                                                                  |
| ---- | -------------------------------------- | ----------------------------------------------------------------------- |
| 1    | `agent-browser navigate <url>`         | `"Ada Lovelace - Wikipedia"` — title only, no page content.             |
| 2    | `agent-browser snapshot`               | Full accessibility tree (187KB, saved to file).                         |
| 3    | `grep -i "charles babbage" <file>`     | Found `link "Charles Babbage" [ref=e43]`.                               |
| 4    | `agent-browser click @e43`             | `"Done"` — no page content.                                             |
| 5    | `agent-browser snapshot`               | Accessibility tree — still Ada Lovelace's page (click didn't navigate). |
| 6    | `grep -i "born\|birth" <file>`         | Found `rowheader "Born"` but no date value.                             |
| 7    | `grep -i "charles babbage" <file>`     | Confirmed still on wrong page.                                          |
| 8    | `agent-browser navigate <babbage-url>` | `"Charles Babbage - Wikipedia"` — title only.                           |
| 9    | `agent-browser snapshot`               | Full accessibility tree (230KB, saved to file).                         |
| 10   | `grep -i "born\|birth" <file>`         | `cell "26 December 1791 London, England"`.                              |

The raw CLI separates every action from its observation: `navigate` returns a title, `click` returns `"Done"`, and the agent must always follow up with `snapshot` to see the page. The AXI wrapper combines each action with its observation — `open` and `click` both return the full snapshot automatically.

The agent-browser trajectory also shows a recovery cost. The `click @e43` in step 4 returned `"Done"` but didn't actually navigate. The agent spent 3 extra steps (snapshot, grep, grep) discovering it was still on the wrong page, then had to manually navigate + snapshot. With AXI, `click @26_181` returned the new page content immediately — the agent could see at a glance that navigation succeeded.

Across 5 runs, this task averages 9.8 turns for agent-browser vs 5.6 for chrome-devtools-axi (43% reduction), with cost dropping from $0.19 to $0.14.

### C. Shell pipes turn navigate + extract into one call: `multi_page_comparison`

> _Navigate to the Python Wikipedia page and note the designer. Then navigate to JavaScript's page and note the designer. Report both._

**chrome-devtools-axi** (3 productive calls, 5 turns, $0.134):

| Step | Call                                                | Result                                                             |
| ---- | --------------------------------------------------- | ------------------------------------------------------------------ |
| 1    | `open <python-url> 2>&1 \| head -100`               | Page metadata + snapshot (7.1KB preview).                          |
| 2    | `open <python-url> 2>&1 \| grep -i "design"`        | Found `"Designed by"` and `"Guido van Rossum"`.                    |
| 3    | `open <js-url> 2>&1 \| grep -i "designed\|Brendan"` | Navigated + grepped in one shell pipeline. Found `"Brendan Eich"`. |

**chrome-devtools-mcp** (5 productive calls, 8 turns, $0.205):

| Step | Call                     | Result                                                              |
| ---- | ------------------------ | ------------------------------------------------------------------- |
| 1    | `navigate_page(url)`     | Confirmation only.                                                  |
| 2    | `take_snapshot()`        | 554K chars — overflows, saved to file.                              |
| 3    | `Grep("Designed", file)` | No matches — snapshot is JSON-encoded, not plain text.              |
| 4    | `evaluate_script`        | JS to query `.infobox tr` for "Designed". Got `"Guido van Rossum"`. |
| 5    | `navigate_page(url)`     | Confirmation only.                                                  |
| 6    | `evaluate_script`        | Same JS pattern. Got `"Brendan Eich"`.                              |

The AXI agent piped CLI output directly through `grep` in the shell — a pattern impossible with MCP tool calls. When the MCP snapshot overflowed and `Grep` failed on the JSON encoding, the agent had to write JavaScript to extract data from the DOM. The AXI agent's text-oriented output kept the entire workflow in standard unix idioms.

### D. ToolSearch picks the wrong tool: `github_repo_stars`

> _Navigate to github.com/torvalds/linux and report the star count and primary language._

This is a simple single-step task. chrome-devtools-axi completes it in 4 calls (open, grep for stars, grep for languages, answer). But under ToolSearch, it fails **5 out of 5 runs** with an identical failure mode:

The agent's ToolSearch query:

```
select:mcp__chrome-devtools__navigate_page,mcp__chrome-devtools__take_screenshot
```

The server exposes both `take_screenshot` (base64 PNG, ~1.1MB) and `take_snapshot` (text accessibility tree, ~80KB). The agent guessed `take_screenshot`. After navigating successfully, the screenshot response (1,106,093 characters of base64) blew the output buffer, truncating the session mid-stream. The agent never produced an answer.

This happened identically in all 5 runs — the agent always guessed the wrong tool name and the session always died on the screenshot payload. With eager-loading (`chrome-devtools-mcp`), the CLAUDE.md explicitly references `take_snapshot` in its workflow, so the agent never encounters this trap.

## Task Categories

### Single-step (5 tasks): Navigate + read one page

All conditions score 95%+ except ToolSearch on `wikipedia_table_read` (4/5). Tasks use stable targets (example.com, Wikipedia, httpbin.org).

### Multi-step (5 tasks): Navigate + interact + follow links

Conditions with 100% success handle these cleanly. ToolSearch shows failures on `wikipedia_search_click` (3/5) and `github_repo_stars` (0/5).

### Investigation (4 tasks): Complex multi-page extraction

Success ranges from 85% (ToolSearch) to 100% (all CLI conditions). These tasks require maintaining context across many page navigations.

### Error recovery (2 tasks): Handle failures gracefully

Most conditions handle 404s and missing elements well (100%). ToolSearch struggles with 404 detection (2/5 on `navigate_404`).

## Methodology

- Each run creates a fresh workspace with condition-specific `CLAUDE.md`
- Agent isolation via `--setting-sources ""` (prevents user settings/hooks/plugins leakage) + `--strict-mcp-config` (prevents local MCP server leakage) + `--disable-slash-commands`
- All MCP conditions use `--headless --isolated` Chrome (no UI popups, clean profile per run)
- Code-mode uses a persistent MCP bridge (chrome-devtools-mcp via HTTP) for cross-script browser state
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
