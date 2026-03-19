import type { RepoContext } from '../context.js';
import { ghJson } from '../gh.js';
import { AxiError } from '../errors.js';
import { getFlag, hasFlag } from '../args.js';
import {
  field,
  lower,
  pluck,
  relativeTime,
  joinArray,
  custom,
  renderList,
  renderHelp,
  renderOutput,
  renderError,
  type FieldDef,
} from '../toon.js';
import { getSuggestions } from '../suggestions.js';

const DEFAULT_SEARCH_LIMIT = '1000';
const DISPLAY_LIMIT = 30;

export const SEARCH_HELP = `usage: gh-axi search <type> <query> [flags]
types[5]:
  issues, prs, repos, commits, code
flags{common}:
  --repo, --owner, --state, --label, --assignee, --author, --sort, --limit <n> (default 1000)
flags{prs}:
  --draft, --review
flags{repos}:
  --language, --stars (e.g. ">100")`;

const issueSchema: FieldDef[] = [
  field('number'),
  field('title'),
  pluck('repository', 'nameWithOwner', 'repo'),
  lower('state'),
  pluck('author', 'login', 'author'),
  joinArray('labels', 'name', 'labels'),
  relativeTime('createdAt', 'created'),
];

const prSchema: FieldDef[] = [
  field('number'),
  field('title'),
  pluck('repository', 'nameWithOwner', 'repo'),
  lower('state'),
  pluck('author', 'login', 'author'),
  relativeTime('createdAt', 'created'),
];

const repoSchema: FieldDef[] = [
  field('fullName', 'name'),
  field('description'),
  field('stargazersCount', 'stars'),
  field('forksCount', 'forks'),
  field('language'),
  relativeTime('updatedAt', 'updated'),
];

const commitSchema: FieldDef[] = [
  field('sha'),
  custom('message', (item) => {
    const commit = item.commit as Record<string, unknown> | undefined;
    const message = commit?.message;
    return typeof message === 'string' ? message.split('\n')[0] : '';
  }),
  pluck('repository', 'fullName', 'repo'),
  pluck('author', 'login', 'author'),
  custom('date', (item) => {
    const commit = item.commit as Record<string, unknown> | undefined;
    const author = commit?.author as Record<string, unknown> | undefined;
    const d = author?.date;
    if (!d || typeof d !== 'string') return 'unknown';
    const diffMs = Date.now() - new Date(d).getTime();
    const diffH = Math.floor(diffMs / 3600000);
    if (diffH < 1) return 'just now';
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    return `${diffD}d ago`;
  }),
];


function extractQuery(args: string[]): string {
  // Collect positional args (not flags and not the subcommand)
  const positionals: string[] = [];
  let i = 1; // skip subcommand (issues/prs/repos/commits/code)
  while (i < args.length) {
    if (args[i].startsWith('--')) {
      // Skip flag + value
      i += 2;
    } else {
      positionals.push(args[i]);
      i++;
    }
  }
  return positionals.join(' ');
}

async function searchIssues(args: string[], ctx?: RepoContext): Promise<string> {
  const query = extractQuery(args);
  if (!query) throw new AxiError('Search query is required: gh-axi search issues <query>', 'VALIDATION_ERROR');

  const limit = getFlag(args, '--limit') ?? DEFAULT_SEARCH_LIMIT;
  const ghArgs = [
    'search', 'issues', query,
    '--json', 'number,title,repository,state,author,labels,createdAt',
    '--limit', limit,
  ];
  const repo = getFlag(args, '--repo') ?? ctx?.nwo;
  if (repo) ghArgs.push('--repo', repo);
  const owner = getFlag(args, '--owner');
  if (owner) ghArgs.push('--owner', owner);
  const state = getFlag(args, '--state');
  if (state) ghArgs.push('--state', state);
  const label = getFlag(args, '--label');
  if (label) ghArgs.push('--label', label);
  const assignee = getFlag(args, '--assignee');
  if (assignee) ghArgs.push('--assignee', assignee);
  const author = getFlag(args, '--author');
  if (author) ghArgs.push('--author', author);
  const sort = getFlag(args, '--sort');
  if (sort) ghArgs.push('--sort', sort);

  const results = await ghJson<Record<string, unknown>[]>(ghArgs);
  const limitNum = parseInt(limit, 10);
  const displayed = results.slice(0, DISPLAY_LIMIT);
  const countLine = results.length === limitNum
    ? `count: ${results.length}+ (GitHub search API limit reached)`
    : results.length > DISPLAY_LIMIT
    ? `count: ${results.length} (showing first ${DISPLAY_LIMIT})`
    : `count: ${results.length}`;
  const suggestions = getSuggestions({ domain: 'search', action: 'issues', repo: ctx });
  return renderOutput([
    countLine,
    renderList('issues', displayed, issueSchema),
    renderHelp(suggestions),
  ]);
}

async function searchPrs(args: string[], ctx?: RepoContext): Promise<string> {
  const query = extractQuery(args);
  if (!query) throw new AxiError('Search query is required: gh-axi search prs <query>', 'VALIDATION_ERROR');

  const limit = getFlag(args, '--limit') ?? DEFAULT_SEARCH_LIMIT;
  const ghArgs = [
    'search', 'prs', query,
    '--json', 'number,title,repository,state,author,createdAt',
    '--limit', limit,
  ];
  const repo = getFlag(args, '--repo') ?? ctx?.nwo;
  if (repo) ghArgs.push('--repo', repo);
  const owner = getFlag(args, '--owner');
  if (owner) ghArgs.push('--owner', owner);
  const state = getFlag(args, '--state');
  if (state) ghArgs.push('--state', state);
  const label = getFlag(args, '--label');
  if (label) ghArgs.push('--label', label);
  const assignee = getFlag(args, '--assignee');
  if (assignee) ghArgs.push('--assignee', assignee);
  const author = getFlag(args, '--author');
  if (author) ghArgs.push('--author', author);
  const sort = getFlag(args, '--sort');
  if (sort) ghArgs.push('--sort', sort);
  if (hasFlag(args, '--draft')) ghArgs.push('--draft');
  const review = getFlag(args, '--review');
  if (review) ghArgs.push('--review', review);

  const results = await ghJson<Record<string, unknown>[]>(ghArgs);
  const limitNum = parseInt(limit, 10);
  const displayed = results.slice(0, DISPLAY_LIMIT);
  const countLine = results.length === limitNum
    ? `count: ${results.length}+ (GitHub search API limit reached)`
    : results.length > DISPLAY_LIMIT
    ? `count: ${results.length} (showing first ${DISPLAY_LIMIT})`
    : `count: ${results.length}`;
  const suggestions = getSuggestions({ domain: 'search', action: 'prs', repo: ctx });
  return renderOutput([
    countLine,
    renderList('prs', displayed, prSchema),
    renderHelp(suggestions),
  ]);
}

async function searchRepos(args: string[], ctx?: RepoContext): Promise<string> {
  const query = extractQuery(args);
  if (!query) throw new AxiError('Search query is required: gh-axi search repos <query>', 'VALIDATION_ERROR');

  const limit = getFlag(args, '--limit') ?? DEFAULT_SEARCH_LIMIT;
  const ghArgs = [
    'search', 'repos', query,
    '--json', 'fullName,description,stargazersCount,forksCount,language,updatedAt',
    '--limit', limit,
  ];
  const owner = getFlag(args, '--owner');
  if (owner) ghArgs.push('--owner', owner);
  const language = getFlag(args, '--language');
  if (language) ghArgs.push('--language', language);
  const stars = getFlag(args, '--stars');
  if (stars) ghArgs.push('--stars', stars);
  const sort = getFlag(args, '--sort');
  if (sort) ghArgs.push('--sort', sort);

  const results = await ghJson<Record<string, unknown>[]>(ghArgs);
  const suggestions = getSuggestions({ domain: 'search', action: 'repos', repo: ctx });
  return renderOutput([
    renderList('repos', results, repoSchema),
    renderHelp(suggestions),
  ]);
}

async function searchCommits(args: string[], ctx?: RepoContext): Promise<string> {
  const query = extractQuery(args);
  if (!query) throw new AxiError('Search query is required: gh-axi search commits <query>', 'VALIDATION_ERROR');

  const limit = getFlag(args, '--limit') ?? DEFAULT_SEARCH_LIMIT;
  const ghArgs = [
    'search', 'commits', query,
    '--json', 'sha,commit,repository,author',
    '--limit', limit,
  ];
  const repo = getFlag(args, '--repo');
  if (repo) ghArgs.push('--repo', repo);
  const owner = getFlag(args, '--owner');
  if (owner) ghArgs.push('--owner', owner);
  const author = getFlag(args, '--author');
  if (author) ghArgs.push('--author', author);
  const sort = getFlag(args, '--sort');
  if (sort) ghArgs.push('--sort', sort);

  const results = await ghJson<Record<string, unknown>[]>(ghArgs);
  const suggestions = getSuggestions({ domain: 'search', action: 'commits', repo: ctx });
  return renderOutput([
    renderList('commits', results, commitSchema),
    renderHelp(suggestions),
  ]);
}

const codeSchema: FieldDef[] = [
  field('path'),
  pluck('repository', 'fullName', 'repo'),
  custom('matches', (item) => {
    const tm = item.textMatches;
    if (!Array.isArray(tm) || tm.length === 0) return 0;
    return tm.length;
  }),
];

async function searchCode(args: string[], ctx?: RepoContext): Promise<string> {
  const query = extractQuery(args);
  if (!query) throw new AxiError('Search query is required: gh-axi search code <query>', 'VALIDATION_ERROR');

  const limit = getFlag(args, '--limit') ?? DEFAULT_SEARCH_LIMIT;
  const ghArgs = [
    'search', 'code', query,
    '--json', 'path,repository,textMatches',
    '--limit', limit,
  ];
  const repo = getFlag(args, '--repo');
  if (repo) ghArgs.push('--repo', repo);
  const owner = getFlag(args, '--owner');
  if (owner) ghArgs.push('--owner', owner);
  const language = getFlag(args, '--language');
  if (language) ghArgs.push('--language', language);

  const results = await ghJson<Record<string, unknown>[]>(ghArgs);
  const suggestions = getSuggestions({ domain: 'search', action: 'code', repo: ctx });
  return renderOutput([
    renderList('results', results, codeSchema),
    renderHelp(suggestions),
  ]);
}

export async function searchCommand(args: string[], ctx?: RepoContext): Promise<string> {
  const sub = args[0];

  if (sub === '--help' || sub === undefined) return SEARCH_HELP;

  switch (sub) {
    case 'issues':
      return searchIssues(args, ctx);
    case 'prs':
      return searchPrs(args, ctx);
    case 'repos':
      return searchRepos(args, ctx);
    case 'commits':
      return searchCommits(args, ctx);
    case 'code':
      return searchCode(args, ctx);
    default:
      return renderError(`Unknown search type: ${sub}`, 'VALIDATION_ERROR', [
        'Available types: issues, prs, repos, commits, code',
      ]);
  }
}
