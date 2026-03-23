# gh-axi

GitHub CLI for agents — designed with [AXI](https://github.com/kunchenguid/axi) (Agent eXperience Interface).

Wraps the official `gh` cli with token-efficient TOON output, contextual next-step suggestions, and structured error handling.
Built for autonomous agents that interact with GitHub via shell execution.

## Install

```bash
npm install -g gh-axi
```

Requires Node 20+ and [`gh`](https://cli.github.com/) authenticated via `gh auth login`.

## Usage

```bash
gh-axi                          # dashboard — live state, no args needed
gh-axi issue list               # list issues in current repo
gh-axi pr view 42               # view pull request #42
gh-axi run list -R owner/repo   # list workflow runs for a specific repo
```

### Commands

| Command    | Description                                               |
| ---------- | --------------------------------------------------------- |
| `issue`    | Issues — list, view, create, edit, close, reopen, comment |
| `pr`       | Pull requests — list, view, create, merge, review, checks |
| `run`      | Workflow runs — list, view, rerun, cancel, watch          |
| `workflow` | Workflows — list, view, run, enable, disable              |
| `release`  | Releases — list, view, create, edit, delete               |
| `repo`     | Repositories — list, view, create, edit, clone, fork      |
| `label`    | Labels — list, create, edit, delete                       |
| `search`   | Search issues, PRs, repos, commits, code                  |
| `api`      | Raw GitHub API access                                     |

### Global flags

- `-R, --repo OWNER/NAME` — target repository (auto-detected from git remote if omitted)
- `--help` — show help for any command

## License

MIT
