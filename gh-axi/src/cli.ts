import { resolveRepo, type RepoContext } from './context.js';
import { AxiError } from './errors.js';
import { renderError } from './toon.js';
import { homeCommand } from './commands/home.js';
import { issueCommand, ISSUE_HELP } from './commands/issue.js';
import { prCommand, PR_HELP } from './commands/pr.js';
import { runCommand, RUN_HELP } from './commands/run.js';
import { workflowCommand, WORKFLOW_HELP } from './commands/workflow.js';
import { releaseCommand, RELEASE_HELP } from './commands/release.js';
import { repoCommand, REPO_HELP } from './commands/repo.js';
import { labelCommand, LABEL_HELP } from './commands/label.js';
import { searchCommand, SEARCH_HELP } from './commands/search.js';
import { apiCommand, API_HELP } from './commands/api.js';

const TOP_HELP = `usage: gh-axi [command] [flags]
commands[10]:
  (none)=dashboard, issue, pr, run, workflow, release, repo, label, search, api
flags[2]:
  -R/--repo <OWNER/NAME>, --help
`;

const COMMAND_HELP: Record<string, string> = {
  issue: ISSUE_HELP,
  pr: PR_HELP,
  run: RUN_HELP,
  workflow: WORKFLOW_HELP,
  release: RELEASE_HELP,
  repo: REPO_HELP,
  label: LABEL_HELP,
  search: SEARCH_HELP,
  api: API_HELP,
};

type CommandFn = (args: string[], ctx?: RepoContext) => Promise<string>;

const COMMANDS: Record<string, CommandFn> = {
  issue: issueCommand,
  pr: prCommand,
  run: runCommand,
  workflow: workflowCommand,
  release: releaseCommand,
  repo: repoCommand,
  label: labelCommand,
  search: searchCommand,
  api: apiCommand,
};

export async function main(argv: string[]): Promise<void> {
  // Extract global flags
  const args = [...argv];
  let repoFlag: string | undefined;

  // Extract --repo / -R
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--repo' || args[i] === '-R') && i + 1 < args.length) {
      repoFlag = args[i + 1];
      args.splice(i, 2);
      i--;
    }
  }

  // Top-level --help
  if (args.includes('--help') && args.length === 1) {
    process.stdout.write(TOP_HELP);
    return;
  }

  // Determine command
  const command = args[0];

  if (!command) {
    // No command = home dashboard
    if (args.includes('--help')) {
      process.stdout.write(TOP_HELP);
      return;
    }
    const ctx = resolveRepo(repoFlag);
    try {
      const output = await homeCommand(args.slice(1), ctx);
      process.stdout.write(output + '\n');
    } catch (err) {
      writeError(err);
    }
    return;
  }

  // Command-level --help
  if (args.includes('--help')) {
    const help = COMMAND_HELP[command];
    if (help) {
      process.stdout.write(help);
      return;
    }
  }

  const handler = COMMANDS[command];
  if (!handler) {
    process.stdout.write(
      renderError(`Unknown command: ${command}`, 'UNKNOWN', [
        'Run `gh-axi --help` to see available commands',
      ]) + '\n',
    );
    process.exitCode = 1;
    return;
  }

  const ctx = resolveRepo(repoFlag);
  try {
    const output = await handler(args.slice(1), ctx);
    process.stdout.write(output + '\n');
  } catch (err) {
    writeError(err);
  }
}

function writeError(err: unknown): void {
  if (err instanceof AxiError) {
    process.stdout.write(renderError(err.message, err.code, err.suggestions) + '\n');
  } else {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(renderError(message, 'UNKNOWN') + '\n');
  }
  process.exitCode = 1;
}
