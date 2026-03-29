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

- **Claude Code**: use native hooks in `~/.claude/settings.json` or project `.claude/settings.json`. Prefer `SessionStart` to inject compact context and `SessionEnd` to persist session summaries. `SessionStart` stdout or `additionalContext` is added to Claude's context, and `SessionEnd` is the right place for cleanup or memory capture
- **Codex**: use native hooks in `~/.codex/hooks.json` or `<repo>/.codex/hooks.json`, and ensure `[features].codex_hooks = true` in `config.toml`. Prefer `SessionStart` for ambient context, `UserPromptSubmit` for prompt-time augmentation, and `Stop` for end-of-turn validation or continuation. Note that Codex hooks are experimental, current `PreToolUse`/`PostToolUse` matching is effectively `Bash`-only, and hooks are currently disabled on Windows
- **Cross-app design**: model your integration around the same lifecycle even when the APIs differ: session-start context injection, pre-action guardrails, post-action capture, and session-end persistence. Use the app's native mechanism when available; otherwise use the nearest documented deterministic extension point rather than a prompt-only workaround

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
- **Actionable**: every suggestion is a complete, copy-pasteable command carrying forward any disambiguating flags from the current invocation (e.g., `--repo`, `--source`)
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
