import { encode } from '@toon-format/toon';
import type { RepoContext } from '../context.js';
import { ghJson, ghExec } from '../gh.js';
import { AxiError } from '../errors.js';
import { getFlag, hasFlag } from '../args.js';
import {
  field,
  lower,
  pluck,
  relativeTime,
  custom,
  renderList,
  renderDetail,
  renderHelp,
  renderOutput,
  renderError,
  type FieldDef,
} from '../toon.js';
import { getSuggestions } from '../suggestions.js';

export const REPO_HELP = `usage: gh-axi repo <subcommand> [flags]
subcommands[6]:
  view, create <name>, edit, clone <repo>, fork [repo], list [owner]
flags{create}:
  --public, --private, --internal, --description, --clone, --template
flags{edit}:
  --description, --visibility, --default-branch, --enable-issues, --enable-wiki
flags{fork}:
  --clone, --remote
flags{list}:
  --limit <n> (default 30), --visibility, --language, --archived`;

const viewSchema: FieldDef[] = [
  field('name'),
  field('description'),
  pluck('defaultBranchRef', 'name', 'branch'),
  field('stargazerCount', 'stars'),
  field('forkCount', 'forks'),
  custom('issues', (item) => (item.issues as Record<string, unknown> | undefined)?.totalCount ?? 0),
  custom('prs', (item) => (item.pullRequests as Record<string, unknown> | undefined)?.totalCount ?? 0),
  lower('visibility'),
  pluck('primaryLanguage', 'name', 'language'),
];

const listSchema: FieldDef[] = [
  field('name'),
  field('description'),
  lower('visibility'),
  pluck('primaryLanguage', 'name', 'language'),
  field('stargazerCount', 'stars'),
  relativeTime('updatedAt', 'updated'),
];


async function viewRepo(args: string[], ctx?: RepoContext): Promise<string> {
  const ghArgs = ['repo', 'view'];
  // repo view takes the repo as a positional arg — always pass it if available
  if (ctx) ghArgs.push(ctx.nwo);
  ghArgs.push('--json', 'name,description,defaultBranchRef,stargazerCount,forkCount,issues,pullRequests,visibility,primaryLanguage');
  const repo = await ghJson<Record<string, unknown>>(ghArgs); // Don't pass ctx — we handle repo arg ourselves

  const suggestions = getSuggestions({ domain: 'repo', action: 'view', repo: ctx });
  return renderOutput([
    renderDetail('repo', repo, viewSchema),
    renderHelp(suggestions),
  ]);
}

async function createRepo(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const name = positionals[1];
  if (!name) throw new AxiError('Repository name is required: gh-axi repo create <name>', 'VALIDATION_ERROR');

  const ghArgs = ['repo', 'create', name];
  if (hasFlag(args, '--public')) ghArgs.push('--public');
  else if (hasFlag(args, '--private')) ghArgs.push('--private');
  else if (hasFlag(args, '--internal')) ghArgs.push('--internal');
  const description = getFlag(args, '--description');
  if (description) ghArgs.push('--description', description);
  if (hasFlag(args, '--clone')) ghArgs.push('--clone');
  const template = getFlag(args, '--template');
  if (template) ghArgs.push('--template', template);

  await ghExec(ghArgs);
  const suggestions = getSuggestions({ domain: 'repo', action: 'create', repo: ctx });
  return renderOutput([
    encode({ created: 'ok', repo: name }),
    renderHelp(suggestions),
  ]);
}

async function editRepo(args: string[], ctx?: RepoContext): Promise<string> {
  const ghArgs = ['repo', 'edit'];
  if (ctx && ctx.source !== 'git') ghArgs.push(ctx.nwo);
  const description = getFlag(args, '--description');
  if (description) ghArgs.push('--description', description);
  const visibility = getFlag(args, '--visibility');
  if (visibility) ghArgs.push('--visibility', visibility);
  const defaultBranch = getFlag(args, '--default-branch');
  if (defaultBranch) ghArgs.push('--default-branch', defaultBranch);
  const enableIssues = getFlag(args, '--enable-issues');
  if (enableIssues) ghArgs.push('--enable-issues=' + enableIssues);
  const enableWiki = getFlag(args, '--enable-wiki');
  if (enableWiki) ghArgs.push('--enable-wiki=' + enableWiki);

  await ghExec(ghArgs); // Don't pass ctx — we handle repo arg ourselves
  const suggestions = getSuggestions({ domain: 'repo', action: 'edit', repo: ctx });
  return renderOutput([
    encode({ edit: 'ok' }),
    renderHelp(suggestions),
  ]);
}

async function cloneRepo(args: string[]): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const repo = positionals[1];
  if (!repo) throw new AxiError('Repository is required: gh-axi repo clone <repo>', 'VALIDATION_ERROR');

  await ghExec(['repo', 'clone', repo]);
  const suggestions = getSuggestions({ domain: 'repo', action: 'clone' });
  return renderOutput([
    encode({ clone: 'ok', repo }),
    renderHelp(suggestions),
  ]);
}

async function forkRepo(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const repo = positionals[1]; // optional

  const ghArgs = ['repo', 'fork'];
  if (repo) ghArgs.push(repo);
  if (hasFlag(args, '--clone')) ghArgs.push('--clone');
  if (hasFlag(args, '--remote')) ghArgs.push('--remote');

  await ghExec(ghArgs, ctx);
  const suggestions = getSuggestions({ domain: 'repo', action: 'fork', repo: ctx });
  return renderOutput([
    encode({ fork: 'ok', repo: repo ?? ctx?.nwo ?? 'current' }),
    renderHelp(suggestions),
  ]);
}

async function listRepos(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const owner = positionals[1]; // optional

  const limit = getFlag(args, '--limit') ?? '30';
  const ghArgs = [
    'repo', 'list',
    '--json', 'name,description,visibility,primaryLanguage,stargazerCount,updatedAt',
    '--limit', limit,
  ];
  if (owner) ghArgs.splice(2, 0, owner); // insert owner after 'list'
  const visibility = getFlag(args, '--visibility');
  if (visibility) ghArgs.push('--visibility', visibility);
  const language = getFlag(args, '--language');
  if (language) ghArgs.push('--language', language);
  if (hasFlag(args, '--archived')) ghArgs.push('--archived');

  const repos = await ghJson<Record<string, unknown>[]>(ghArgs);
  const isEmpty = repos.length === 0;
  const suggestions = getSuggestions({ domain: 'repo', action: 'list', isEmpty, repo: ctx });
  return renderOutput([
    renderList('repos', repos, listSchema),
    renderHelp(suggestions),
  ]);
}

export async function repoCommand(args: string[], ctx?: RepoContext): Promise<string> {
  const sub = args[0];

  if (sub === '--help' || sub === undefined) return REPO_HELP;

  switch (sub) {
    case 'view':
      return viewRepo(args, ctx);
    case 'create':
      return createRepo(args, ctx);
    case 'edit':
      return editRepo(args, ctx);
    case 'clone':
      return cloneRepo(args);
    case 'fork':
      return forkRepo(args, ctx);
    case 'list':
      return listRepos(args, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, 'VALIDATION_ERROR', [
        'Available subcommands: view, create, edit, clone, fork, list',
      ]);
  }
}
