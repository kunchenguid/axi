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

### Fail loud on unrecognized input

Reject unknown flags and arguments — never silently ignore them. A dropped flag is worse than an error: the agent gets plausible-looking output it believes is scoped or filtered, then proceeds confidently on wrong data. This is the same guarantee a CLI already owes for an unknown _command_; extend it to flags.

```
$ tasks list --stat closed
error: unknown flag --stat for `list`
help: valid flags for `list`: --state, --assignee, --limit (--help always allowed)
```

- **Validate before any dependency call**, with exit code 2 — the same as a missing required flag. Each command declares its own known flags; an unrecognized one is rejected by name and the command's valid flags are listed.
- **`--help` always passes** — it's the one universal flag. Beyond it, a CLI may standardize its own always-allowed globals (e.g. an `--account` selector); whatever the set, those flags pass on every command and are never reported as unknown.
- **Renamed or removed flags get a targeted hint**, not the generic list — point at what replaced them (`--status was renamed; use --state instead`) so the agent self-corrects in one step.
- **Per-subcommand flag sets.** For grouped nouns where one command dispatches to subcommands (a `list` vs a `create` under the same noun), validate against the _subcommand's_ flags — they differ, and only the subcommand layer knows which is in play.
- **Make the error self-correcting in one turn.** The agent's deterministic next move after an unknown-flag error is to run `<command> --help` (e.g. `tasks list --help`) — so fold that lookup into the error: list the valid flags inline, or print the command's concise `--help` block directly beneath it. Per §4 the expensive cost is the follow-up call, and per §10 per-command help is already concise, so inlining it collapses the two-turn correction into one.

### Output channels

- **stdout**: all structured output the agent consumes — data, errors, suggestions
- **stderr**: debug logging, progress indicators, diagnostics (agents don't read this)
- **Exit codes**: 0 = success (including no-ops), 1 = error, 2 = usage error

Never mix progress messages into stdout. An agent that reads "Fetching data..." will try to interpret it as data.

## 7. Ambient context via session integrations

Register your tool into the agent's session lifecycle so every conversation starts with relevant state already visible — before the agent takes any action.

**Pattern:**

1. Provide an explicit setup command that installs or repairs a session hook or plugin after user intent is clear
2. At session start, the integration runs your tool and provides a compact dashboard as context
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

- **Default app targets**: by default, support Claude Code, Codex, and OpenCode. Do not hard-code a single agent integration when the tool can reasonably support multiple agents
- **Explicit opt-in**: register hooks or plugins only from a user-invoked setup command, not from ordinary CLI commands
- **Portable commands**: hook commands should use a PATH-verified binary name when it resolves to the current executable, and fall back to the full absolute path otherwise. This keeps global installs portable while ensuring hooks do not accidentally run a different binary
- **Path repair**: setup commands should check existing hooks and update the executable path if it has changed (e.g., after reinstall or relocation)
- **Idempotent**: repeated installs with the same path are silent no-ops
- **Directory-scoped**: show only state relevant to the current working directory
- **Token-budget-aware**: this context loads on _every_ session — ruthlessly minimize it. Include just enough for the agent to orient and act; deep data belongs in explicit invocations
- **Lifecycle capture**: use session-end hooks to capture what happened (transcripts, files touched, specs referenced) so future session-start context gets richer over time

**How to integrate with each app:**

- **Claude Code**: use native hooks in `~/.claude/settings.json` or project `.claude/settings.json`. Prefer `SessionStart` to inject compact context via stdout
- **Codex**: use native hooks in `~/.codex/hooks.json` or `<repo>/.codex/hooks.json`, and ensure `[features].hooks = true` in `config.toml`. Prefer `SessionStart` for ambient context via stdout
- **OpenCode**: use a managed plugin in `~/.config/opencode/plugins/` or `<repo>/.opencode/plugins/`. Prefer ambient system-context injection for the home view rather than adding a custom tool

**Also ship an installable skill (secondary recommendation):**

The session hook is the primary integration, but it only helps agents whose harness supports hooks, and it loads on _every_ session.
Offer an installable [Agent Skill](https://agentskills.io) as a secondary discovery path.
It loads on demand when the agent recognizes a matching task, carries no per-session token cost, and works in any agent that supports the skill format.
Recommend the hook first (ambient context plus live state) and the skill second (lower overhead, broader agent support) - they are complementary, and a user installs whichever fits, or both.

```sh
npx skills add <owner>/<repo> --skill <name>
```

- **Single source of truth**: generate `SKILL.md` from the same content your no-args home view prints, so the skill never drifts from the CLI's own guidance. Add a `--check` build step to CI that fails if the committed skill is stale
- **Strip live state**: a skill is static, so omit dynamic data (open sessions, current items) that only the hook can show
- **Non-interactive commands**: rewrite command examples to a form the agent can run without a global install (e.g. `npx -y mytool ...`), since a skill may be installed without the binary on PATH
- **Trigger-shaped frontmatter**: include `name` and a `description` written as a trigger — terse and outcome-focused so the agent loads it on the right intent
- **Document both paths**: in your README, present the hook and the skill as two ways to achieve the same thing, and make clear the user only needs one

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

### Identify yourself instantly: the `--version` fast path

`-v`, `-V`, and `--version` must all print the bare version and exit 0. Agents and their harnesses probe `--version` constantly - to confirm a tool is installed, to check whether a fix has shipped, to decide whether to suggest `update`. That makes latency an ergonomics property, not just a perf tweak: a probe that takes 80 ms is 80 ms of every session start, paid before any useful work happens.

The trap is ESM static imports. If `bin/<tool>.js` statically imports the module that builds the command graph, every dependency in that graph is fully evaluated _before_ the version check runs. One heavy import anywhere in the tree - an SDK, a server framework - is then paid on every `--version`.

Answer the version before the graph loads: keep the version in a leaf module that imports only node builtins, and defer the real CLI to a dynamic `import()`.

```js
#!/usr/bin/env node
import { tryFastPath } from "axi-sdk-js/fast-path";
import { VERSION } from "../src/version.js"; // leaf module - node builtins only

if (!tryFastPath(process.argv.slice(2), { version: VERSION })) {
  const { main } = await import("../src/cli.js"); // heavy graph loads only here
  await main();
}
```

`axi-sdk-js/fast-path` is a dedicated subpath export that imports nothing at all, so pulling it in never drags in `runAxiCli` or its dependencies. `tryFastPath` handles only a bare, single-argument version flag and returns `false` for everything else, so all other argv - including version flags in trailing positions - falls through to `runAxiCli`, which stays the single owner of the general case. Its accepted flags and output are identical to the SDK's own version handling, so adopting it changes nothing an agent can observe except the latency.

Two things keep this honest:

- The version must come from a **leaf** module. If `VERSION` is defined inside `cli.ts`, importing it re-pulls the whole graph and the fast path buys nothing.
- Guard it with a test that measures the version path against the `node -e "console.log(1)"` floor measured in the same process, rather than an absolute millisecond budget that goes flaky across machines.
