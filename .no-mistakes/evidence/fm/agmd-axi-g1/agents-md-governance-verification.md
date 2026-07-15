# AGENTS.md self-governance verification

Validated target commit `de7bffd1b9b0263d8a1dd94e6858826623d09605` against base `2fa0f2e9c06cd8baa43a02e1fc257d41f24815e7`.

The root `CLAUDE.md` agent entry point is a symlink to `AGENTS.md`.

The target adds only `AGENTS.md`.

The base did not include this heading.

The target includes it exactly once, as the final block:

```markdown
## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
```

The verification checked the single occurrence, byte-for-byte final block, append-only scope, and the agent entry-point symlink.
