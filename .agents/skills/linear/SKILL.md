---
name: linear
description: Use Linear from Codex through the AXI-style `linear-axi` CLI, and compare behavior against Linear's official MCP server when requested.
user-invocable: true
---

# Linear AXI

Use this skill when the user asks to inspect or update Linear issues, compare
Linear MCP with AXI, or run Linear workflows through a command-oriented agent
interface.

## Preconditions

- `linear-axi` must be installed and on `PATH`.
- `LINEAR_API_KEY` or `LINEAR_TOKEN` must be set for direct API access.
- For MCP comparison, Codex should also have Linear MCP configured:

```sh
codex mcp add linear --url https://mcp.linear.app/mcp
codex mcp login linear
```

Codex remote MCP support may require this in `~/.codex/config.toml`:

```toml
[features]
experimental_use_rmcp_client = true
```

## AXI Commands

Start with the home view:

```sh
linear-axi
```

Common read operations:

```sh
linear-axi issues --assigned --limit 20
linear-axi issue get LIN-123
linear-axi states
```

Write operations:

```sh
linear-axi issue comment LIN-123 --body "..."
linear-axi issue update LIN-123 --state-id "<workflow-state-id>"
```

## Comparison Protocol

When comparing Linear MCP and Linear AXI, run the same task both ways and record:

- task
- command or MCP tool sequence
- number of calls
- result quality
- error handling
- whether a human can reproduce the action from the transcript

Prefer read-only tasks first. Ask before write operations unless the user has
already explicitly authorized the exact Linear mutation.
