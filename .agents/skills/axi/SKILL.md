---
name: axi
description: >
  Agent eXperience Interface (AXI) — ergonomic standards for building CLI tools that agents
  use via shell execution. Use when building, modifying, or reviewing any agent-facing CLI.
---

# Agent eXperience Interface (AXI)

AXI defines ergonomic standards for building CLI tools that autonomous agents interact with through shell execution.

## Before you start

Read the [TOON specification](https://toonformat.dev/reference/spec.html) before building any AXI output.

## 1. Token-efficient output

Use [TOON](https://toonformat.dev/) (Token-Oriented Object Notation) as the output format on stdout.
TOON provides ~40% token savings over equivalent JSON while remaining readable by agents.
Convert to TOON at the output boundary — keep internal logic on JSON.

```
tasks[2]{id,title,status,assignee}:
  "1",Fix auth bug,open,alice
  "2",Add pagination,closed,bob
```

## 2. Minimal default schemas

Every field in stdout costs tokens — multiplied by row count in collections.
Default to the smallest schema that lets the agent decide what to do next: typically an identifier, a title, and a status.

- Default list schemas: 3-4 fields, not 10
- Default limits: high enough to cover common cases in one call (if most repos have <100 labels, default to 100, not 30)
- Long-form content (bodies, descriptions) belongs in detail views, not lists
- Offer a `--fields` flag to let agents request additional fields explicitly

## 3. Content truncation

Detail views often contain large text fields. Omitting them forces agents to hunt; including them wastes tokens.
Truncate by default and tell the agent how to get the full version.

```
task:
  number: 42
  title: Fix auth bug
  state: open
  body: First 500 chars of the issue body...
    ... (truncated, 8432 chars total)
help[1]: Run `tasks view 42 --full` to see complete body
```

- Never omit large fields entirely — include a truncated preview
- Show the total size so the agent knows how much it's missing
- Suggest the escape hatch (`--full`) only when content is actually truncated
- Choose a truncation limit that covers most use cases (500-1500 chars)

## 4. Pre-computed aggregates

The most expensive token cost is often not a longer response — it's a follow-up call. If your backend has data that agents commonly need as a next step, compute it and include it.

**Aggregate counts**: include the **total count** in list output, not just the page size. Agents need "how many are there?" and will paginate if the answer isn't definitive.

```
count: 30 of 847 total
tasks[30]{number,title,state}:
  1,Fix auth bug,open
  ...
```

**Derived status fields**: when the next step almost always involves checking related state, include a lightweight summary inline.

```
task:
  number: 42
  title: Deploy pipeline fix
  state: open
  checks: 3/3 passed
  comments: 7
```

Only include derived fields your backend can provide cheaply — a summary ("3/3 passed"), not the full data.

## 5. Definitive empty states

When the answer is "nothing", say so explicitly. Ambiguous empty output causes agents to re-run with different flags to verify.

```
$ tasks list --state closed
tasks: 0 closed tasks found in this repository
```

State the zero with context. Make it clear the command succeeded — the absence of results is the answer.

## 6. Structured errors & exit codes

### Idempotent mutations

Don't error when the desired state already exists. If the agent closes something already closed, acknowledge and move on with exit code 0. Reserve non-zero exit codes for situations where the agent's intent genuinely cannot be satisfied.

```
$ tasks close 42
task: #42 already closed (no-op)    # exit 0
```

### Structured errors on stdout

Errors go to **stdout** in the same structured format as normal output, so the agent can read and act on them. Include what went wrong and an actionable suggestion. Never let raw dependency output (API errors, stack traces) leak through.

```
error: --title is required
help: tasks create --title "..." [--body "..."]
```

- Validate required flags before calling any dependency
- Translate errors — extract actionable meaning, discard noise
- Never leak dependency names — suggestions reference your CLI's commands, not the underlying tool

### No interactive prompts

Every operation must be completable with flags alone. If a required value is missing, fail immediately with a clear error — don't prompt for it. Suppress prompts from wrapped tools.

### Output channels

- **stdout**: all structured output the agent consumes — data, errors, suggestions
- **stderr**: debug logging, progress indicators, diagnostics (agents don't read this)
- **Exit codes**: 0 = success (including no-ops), 1 = error, 2 = usage error

Never mix progress messages into stdout. An agent that reads "Fetching data..." will try to interpret it as data.

## 7. Ambient context via session hooks

Register your tool into the agent's session lifecycle so every conversation starts with relevant state already visible — before the agent takes any action.

**Pattern:**

1. On first invocation, self-install hooks into the agent's configuration (idempotently)
2. At session start, a hook runs your tool and outputs a compact dashboard to stdout
3. The agent receives this as initial context and can act immediately

```
# Agent sees this at session start — no invocation needed:
specs[2]{id,title,status}:
  1,Fix auth bug,open
  2,Add pagination,in-progress

help[2]:
  Run `mytool specs view 1` for details
  Run `mytool specs create --title "..."` to add a spec
```

**Rules:**

- **Default app targets**: by default, support Claude Code and Codex. Do not hard-code a single agent integration when the tool can reasonably support both
- **Self-installing**: register hooks at global/user level on first run — no manual setup required
- **Absolute paths**: hook commands must use the full absolute path of the current executable (via `os.Executable()` or equivalent), not a bare command name. This ensures hooks work regardless of the agent's `$PATH` at runtime
- **Path repair**: on every invocation, check existing hooks and update the executable path if it has changed (e.g., after reinstall or relocation). This turns self-install into self-heal
- **Idempotent**: repeated installs with the same path are silent no-ops
- **Directory-scoped**: show only state relevant to the current working directory
- **Token-budget-aware**: this context loads on _every_ session — ruthlessly minimize it. Include just enough for the agent to orient and act; deep data belongs in explicit invocations
- **Lifecycle capture**: use session-end hooks to capture what happened (transcripts, files touched, specs referenced) so future session-start context gets richer over time

**How to integrate with each app:**

- **Claude Code**: use native hooks in `~/.claude/settings.json` or project `.claude/settings.json`. Prefer `SessionStart` to inject compact context via stdout
- **Codex**: use native hooks in `~/.codex/hooks.json` or `<repo>/.codex/hooks.json`, and ensure `[features].codex_hooks = true` in `config.toml`. Prefer `SessionStart` for ambient context via stdout

## 8. Content first

Running your CLI with no arguments should show the most relevant live content — not a usage manual.
When an agent sees actual state it can act immediately. When it sees help text, it has to make a second call.

```
$ tasks
tasks[3]{id,title,status}:
  1,Fix auth bug,open
  2,Add pagination,open
  3,Update docs,closed
help[2]:
  Run `tasks view <id>` to see full details
  Run `tasks create --title "..."` to add a task
```

## 9. Contextual disclosure

Include **a few next steps** that follow logically from the current output.
The agent discovers your CLI's surface area organically by using it, not by reading a manual upfront.

Rules:

- **Relevant**: after an open item → suggest closing; after an empty list → suggest creating; after a list → suggest viewing
- **Actionable**: every suggestion is a complete command (or template) carrying forward any disambiguating flags from the current invocation (e.g., `--repo`, `--source`)
- **Parameterize dynamic values**: when a suggested command needs a runtime value such as an ID, title, branch, URL, or path, use placeholders like `<id>` or `"<title>"` instead of guessing a concrete value that may mislead the agent
- **Omit when self-contained**: when the output fully answers the query (a detail view, a count, a confirmation), suggestions are noise — leave them out. Include them on list and mutation responses where the next step isn't obvious.
- **Guide discovery, not workflows**: suggest a variety of possible next actions, don't prescribe a fixed sequence. An agent that already knows what it wants should never be nudged into an extra step.
- **Reveal truncated lists**: when a list shows only the most recent N items out of a larger total, add a help hint telling the agent how to see all of them (e.g., `Run 'mytool list' for all 47 items`). Don't encode pagination into TOON array headers — use help hints instead.
- **Resolve errors**: on errors, suggest the specific command that fixes the problem, not "see `--help`"

## 10. Consistent way to get help

The top-level home view should also identify the tool itself before the live data:

- Include the absolute path of the current executable, with the user's home directory collapsed to `~`
- Include a one-sentence description of what this AXI does

```
$ tasks
bin: ~/.local/bin/tasks
description: Manage project tasks in the current workspace
...
```

Every subcommand should support `--help` with a concise, complete reference: available flags with defaults, required arguments, and 2-3 usage examples. Keep it focused on the requested subcommand — don't dump the entire CLI's manual.

## 11. Usage-driven improvement

AXI defaults are guesses until agents use them. Instrument every AXI tool to log how it is actually used, then build a summary command that turns those logs into actionable tuning decisions.

### What to log

Append one JSONL record per invocation to a local cache file (e.g. `~/.cache/mytool/usage.jsonl`). Logging must never break the CLI — silently drop on I/O errors. Each record should capture these AXI-relevant signals:

| Signal | What to record | Which AXI principle it tunes |
|--------|---------------|------------------------------|
| **Command** | Command name, timestamp | Overall usage patterns |
| **Schema** | Default fields and any `--fields` override | §2 Minimal default schemas |
| **List length** | Default limit, requested limit, rows returned, total available | §2 Default limits |
| **Parameterized defaults** | Default vs actual value for any flag with a meaningful default (limits, ranges, scopes) | §2 Default limits |
| **Content truncation** | Whether `--full` was passed, count of truncated fields | §3 Content truncation |
| **Aggregates** | Which aggregate keys appeared in the output | §4 Pre-computed aggregates |
| **Empty results** | Whether the command returned 0 results on a successful call | §5 Definitive empty states |
| **Errors** | Error message, whether contextual hints were shown, exit code | §6 Structured errors, §9 Contextual disclosure |
| **Parse errors** | The raw argv when the CLI framework rejects input | §9 Contextual disclosure (missing flags) |
| **Hints shown** | Which help hints appeared in the output | §9 Contextual disclosure (are hints guiding agents to what they actually do next?) |
| **Latency** | Duration in milliseconds from entry to response | §4 Aggregates (high latency makes follow-up prevention more valuable) |

**Key design rules:**

- **Record defaults alongside overrides.** Logging that rows were overridden to 15 is useless without knowing the default was 10. Future analysis needs both to judge whether the default should change.
- **Only log non-default values.** If the agent didn't override a parameter, omit the override key entirely — don't write `null`. This keeps records compact and makes "count of overrides" a simple key-existence check.
- **Log on both success and error paths.** Error records need the same command-specific context as success records, plus the error message and exit code.
- **Capture full argv on parse errors.** When the CLI framework rejects input, save the raw arguments so the summary can identify flags agents expect but don't exist.

### What to detect

The usage summary should surface three agent failure modes that benchmarking shows are the primary drivers of wasted cost and turns:

**Discovery friction** — The agent tries a flag or command that doesn't exist, gets an error, then falls back to `--help` before finding the right invocation. Detect by looking for parse errors ("No such option", "Unknown command") optionally followed by a `--help` call. Each instance is a wasted turn pair. The fix is either to add the expected flag, alias the expected command name, or improve contextual disclosure so the agent finds the right command on the first try.

**Retry cascades** — The agent re-runs the same command within seconds, often with escalating parameters (wider limits, broader filters). Detect by looking for the same command invoked twice within 30 seconds. Each cascade means the first response didn't give the agent what it needed — typically an empty result with no guidance, or an error without a recovery hint. The fix is better defaults, better empty-state messages, or better error hints.

**Verification follow-ups** — The agent makes an extra call to confirm something that a pre-computed aggregate should have told it. Detect by looking for a detail/view command immediately after a list command for the same entity. If the detail call only reads a field that could have been in the list output, that field is a candidate for the default schema or for an aggregate. The fix is to promote the field or add a derived summary.

**Unhinted transitions** — The agent follows command A with command B, but A's output didn't include a hint suggesting B. Detect by extracting command-pair sequences from timestamped logs (A→B within the same session or within a short time window) and comparing against the hints A actually emitted. Frequent A→B transitions where B isn't hinted reveal missing contextual disclosure (§9). The fix is to add a hint to A's output suggesting B, carrying forward any relevant context (identifiers, CRS codes, IDs) so the agent doesn't have to re-derive them. Conversely, if A hints at C but agents never actually run C, that hint is noise — consider removing it.

### What to summarize

Build a `mytool usage` subcommand that reads the JSONL log and reports insights. The output itself should be TOON. Organize the analysis around the four outcome metrics that AXI benchmarking tracks — **success rate, cost, duration, turns** — since every insight should connect to at least one:

**Schema analysis** (reduces turns) — Count how often each extra field is requested via `--fields`. Fields requested 2+ times are candidates to promote into the default schema. Report both the field names and their counts.

**List length analysis** (reduces turns) — How often was the default row/result limit overridden? What values were used? Did any calls hit the limit (returned == requested)? Hitting the limit suggests the default is too low.

**Parameterized default analysis** (reduces turns, improves success) — For any flag with a meaningful default (scopes, ranges, caps), track the same override-vs-default pattern as list length. High override rates or high empty-result rates signal the default isn't covering common cases.

**Content truncation analysis** (reduces cost) — What fraction of calls used `--full`? High rates (>30%) suggest default truncation is too aggressive. Also report how many calls had truncated content, to distinguish "nobody needed full" from "nothing was long enough to truncate."

**Empty result analysis** (improves success) — What fraction of successful calls returned 0 results? High empty rates signal that defaults aren't covering common agent queries. Break down by command.

**Discovery friction** (reduces turns, cost) — How many parse errors occurred? How many were followed by `--help` lookups? Report the specific missing flags/commands with counts.

**Retry cascades** (reduces turns, duration) — How many rapid re-invocations of the same command? Report by command, with the escalation pattern (e.g. "limit 10 → 20 → 50" or "same args, 3 attempts").

**Follow-up patterns** (reduces turns) — How often does a detail command immediately follow a list of the same entity? Which fields does the detail call read that the list didn't include?

**Command sequence analysis** (improves §9 contextual disclosure) — Extract the most frequent command-pair transitions (A→B) from the log. For each frequent pair, check whether A's recorded hints included a suggestion for B. Report:
- *Unhinted transitions*: frequent A→B pairs where A didn't hint at B — these are missing hints that should be added.
- *Unused hints*: hints that A consistently shows but no subsequent command ever matches — these are noise that can be removed or replaced.
- *Effective hints*: A hinted at B and the agent followed through — these validate the current disclosure and should be preserved.

This tells you whether your contextual disclosure (§9) is guiding agents toward what they actually do next, or toward commands they never use.

**Error analysis** (improves success) — Categorize errors (parse errors, not-found, API errors, timeouts). Track what fraction included contextual hints — errors without hints are disclosure gaps (§9).

**Latency analysis** (reduces duration) — Report avg and p95 duration. High latency makes pre-computed aggregates (§4) more valuable, since each prevented follow-up call saves more wall-clock time.

**Actionable recommendations** — Synthesize the above into concrete suggestions:
- "Add 'status' to default schema (requested 4 times — would save ~2 follow-up calls/session)"
- "Consider adding flag: `mytool list --offset` (attempted 3 times, all parse errors)"
- "Widen default --limit (65% of calls returned 0 results)"
- "Add hints to parse error output (8 errors had no recovery guidance)"
- "Add hint to `mytool list` suggesting `mytool view <id>` (12 list→view transitions, none hinted)"
- "Remove hint for `mytool export` from `mytool list` (shown 30 times, never followed)"

Don't just report statistics — tell the developer what to change and why.

### The improvement cycle

The usage log and summary command create an OODA loop (Observe → Orient → Decide → Act):

1. **Observe** — Every invocation appends a JSONL record. The log accumulates naturally during normal agent sessions with no manual effort.
2. **Orient** — `mytool usage` reads the log and interprets it through AXI principles and the failure modes (discovery friction, retry cascades, verification follow-ups, unhinted transitions). This is the analysis: override rates, empty-result rates, error categories, retry counts, command sequences.
3. **Decide** — The summary synthesizes observations into actionable recommendations: which fields to promote, which flags to add, which defaults to widen, which errors need hints. The developer reviews these against domain knowledge — a high empty-result rate might be expected (late-night queries) rather than a signal to change defaults.
4. **Act** — Implement the changes. `mytool usage --clear` resets the log so the next cycle measures the impact of the changes, not the old baseline.

Ship with best-guess defaults (§1–10 guide the initial choices), then start the loop. The principles tell you what to optimize for; the OODA cycle tells you whether you got it right. Cycle quickly — don't wait for a formal review cadence. The log is always accumulating, and `mytool usage` is always available.

AXI benchmarking ([axi.md](https://axi.md/)) defines the outcome metrics to orient around: task success rate, cost per task, wall-clock duration, and tool-call turns. The usage summary connects each insight to these metrics so you can prioritize the changes that matter most.
