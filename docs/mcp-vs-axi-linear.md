# Linear MCP vs Linear AXI

Linear has an official remote MCP server at `https://mcp.linear.app/mcp`. Codex
can configure it with:

```sh
codex mcp add linear --url https://mcp.linear.app/mcp
codex mcp login linear
```

`linear-axi` is a direct CLI wrapper around Linear's API. It is not a replacement
for MCP yet; it is a comparison surface that makes every agent action explicit
and reproducible.

## Hypothesis

- MCP should be better for native client integration and OAuth.
- AXI should be easier to audit, replay, diff, and compare because each operation
  is a shell command with compact output.

## Benchmark Tasks

| Task                         | Linear MCP | Linear AXI                                       | Winner | Notes      |
| ---------------------------- | ---------- | ------------------------------------------------ | ------ | ---------- |
| Show my assigned issues      | TBD        | `linear-axi issues --assigned --limit 20`        | TBD    | Read-only  |
| Summarize one issue          | TBD        | `linear-axi issue get LIN-123`                   | TBD    | Read-only  |
| Find allowed workflow states | TBD        | `linear-axi states`                              | TBD    | Read-only  |
| Add a comment                | TBD        | `linear-axi issue comment LIN-123 --body "..."`  | TBD    | Write      |
| Move an issue                | TBD        | `linear-axi issue update LIN-123 --state-id ...` | TBD    | Write      |
| Recover from missing auth    | TBD        | unset `LINEAR_API_KEY`; run `linear-axi`         | TBD    | Error path |

## Metrics

- Calls: how many MCP tool calls or shell commands were needed.
- Context: whether the agent needed hidden state to act correctly.
- Auditability: whether the transcript can be replayed by a human.
- Safety: whether writes require explicit, inspectable commands.
- Failure quality: whether auth, missing ID, and permission errors are actionable.

## Notes

Linear MCP is the production integration path today. Keep AXI narrow until it
proves better on concrete tasks.
