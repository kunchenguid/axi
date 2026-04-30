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

The defaults across §1–10 are guesses until agents use the tool. Build in a feedback loop: instrument real usage, surface it through a tool-native summary, and let the data refine the design.

### What to capture

Each invocation carries evidence about whether the AXI principles are being met. Capture one stream of signal per principle, defined broadly enough to encompass every override, error, or transition that informs compliance:

| § | Principle | Signal to capture |
|---|-----------|-------------------|
| — | Foundational metadata | Command identity, timestamp, tool version, working directory, and any session or correlation key needed to sequence invocations, scope transitions to a single agent session, and tell which release of the tool produced each record. Required underneath every per-principle signal below |
| 1 | Token-efficient output | Output size per invocation (bytes or tokens), so cost per call stays visible even when the format is fixed |
| 2 | Minimal default schemas | Agent overrides of any defaulted parameter — fields, limits, scopes, ranges — distinguishing overrides that took effect from overrides clipped by a downstream cap, plus whether the returned result filled the limit. |
| 3 | Content truncation | Full-content requests and how often truncation actually fires — together distinguishing "default too aggressive" from "content rarely long enough to matter" |
| 4 | Pre-computed aggregates | Aggregates emitted on each invocation alongside follow-up calls that only read information the prior call could have included — together showing whether existing aggregates are doing their job and where new ones would help. Per-call latency, which scales the cost of every avoidable round-trip |
| 5 | Definitive empty states | Successful zero-result invocations and what the agent does next — quiet acceptance, blind retry, or retry with widened parameters |
| 6 | Structured errors & exit codes | Errors and exit codes by category (including idempotent no-ops), and the agent's response — recovery via the suggested command, blind retry, or abandonment |
| 7 | Ambient context via session hooks | Whether session-start context fired and whether early agent actions reference state it surfaced rather than re-deriving it |
| 8 | Content first | Bare/no-argument invocations and whether they are immediately followed by exploratory help calls |
| 9 | Contextual disclosure | Hints emitted on each invocation versus the command the agent runs next — surfacing unhinted transitions and unfollowed hints. Raw input on parse errors, which names flags or commands the agent expected to exist |
| 10 | Consistent way to get help | Help invocations and their context — bare exploration, post-error recovery, or mid-workflow lookup |

Logging must be cheap and must never break the CLI. Record both success and error paths. Record defaults alongside overrides so the analysis can judge whether the default itself should change. Storage format and location are implementation choices.

### What to detect

Identify failures to comply with AXI principles and expected behaviors, e.g.:

- **Repetition** — the agent re-runs a command with the same or escalated parameters. The first response didn't give it what it needed: defaults too narrow (§2), empty states not definitive (§5), or errors without a recovery path (§6).
- **Re-derivation** — a later call only reads information that was already within reach of an earlier one. Schemas too minimal (§2), or pre-computed aggregates missing (§4).
- **Surface mismatch** — the agent invokes something the tool doesn't expose, or has to discover state the tool should already have surfaced. Naming or surface area doesn't match expectations (§6, §9), ambient context isn't reaching the agent or isn't being used (§7), the bare invocation isn't showing useful live data (§8), or help is being leaned on across turns where contextual hints should suffice (§10).
- **Capability gap** — a recurring sequence of successful invocations that together approximate a workflow the tool doesn't directly support. The agent isn't misusing existing surface; the surface itself is incomplete, and a new command, parameter, or aggregation would collapse the sequence into a single call (§4).
- **Disclosure mismatch** — A→B transitions where A never hints at B reveal missing guidance; hints A consistently emits that no agent follows are noise (§9).
- **Output bloat** — output size grows without proportional gain in information value, eroding token efficiency (§1) and the schema and truncation discipline of §2 and §3.

Add categories as new principles or new failure shapes emerge — but keep them framed as agent-observable dysfunction, not log-field recipes.

### What to summarize

Expose a tool-native summary (e.g. a `usage` subcommand) that turns the captured signals into recommendations tied back to AXI principles. Don't just report statistics — name the principle, the signal that triggered the recommendation, the supporting sample size, and the concrete change, e.g.:

- **Trim per-call output (§1)** — output size trending upward without a proportional gain in information value.
- **Promote a frequently-overridden field into the default schema (§2)** — recurring schema overrides for the same field across sessions.
- **Widen a default limit, scope, or range (§2)** — calls regularly hit the cap or return zero results.
- **Recalibrate default truncation (§3)** — high rate of full-content requests, or truncation rarely fires.
- **Add a pre-computed aggregate (§4)** — re-derivation: follow-up calls regularly read information the prior call could have included inline.
- **Strengthen empty-result output (§5)** — agents re-run the same query after zero results rather than treating it as definitive.
- **Attach a recovery hint to an error class (§6, §9)** — recurring error without a contextual suggestion, followed by blind retries or abandonment.
- **Move state into ambient session context (§7)** — early-session probes for state a session-start hook could have surfaced.
- **Strengthen the bare-invocation view (§8)** — bare calls frequently followed by exploratory help calls.
- **Add or remove a contextual hint (§9)** — frequent A→B transitions where A doesn't suggest B; or hints A emits that no agent ever follows.
- **Reduce reliance on help text (§10)** — repeated help calls mid-workflow suggest contextual disclosure isn't carrying enough information.

### The improvement cycle

The instrumentation and summary form an OODA loop (Observe → Orient → Decide → Act):

1. **Observe** — invocations are recorded continuously, with no manual effort during normal agent sessions.
2. **Orient** — the summary interprets the data through AXI principles and the failure modes above. Compare overrides against the current default set rather than the logged one, and use the tool version on each record so older behavior still informs analysis in context.
3. **Decide** — each observation connects back to a specific principle and a concrete change. Validate proposals against the live tool surface. Treat the result as proposals — domain knowledge may justify a high override rate or empty-result rate.
4. **Act** — apply the changes, then return to the loop, checking whether the targeted dysfunction signal dropped.

Ship with best-guess defaults (§1–10 guide the initial choices), then start the loop. The principles tell you what to optimize for; the OODA cycle tells you whether you got it right.
