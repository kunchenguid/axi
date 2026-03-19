import type { RepoContext } from '../context.js';
import { ghJson, ghExec, ghRaw } from '../gh.js';
import { AxiError } from '../errors.js';
import { getSuggestions } from '../suggestions.js';
import { getFlag, hasFlag, getPositional, requireNumber } from '../args.js';
import { truncateBody } from '../body.js';
import {
  field,
  pluck,
  joinArray,
  relativeTime,
  lower,
  custom,
  renderList,
  renderDetail,
  renderHelp,
  renderError,
  renderOutput,
  type FieldDef,
} from '../toon.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IssueListItem {
  [key: string]: unknown;
  number: number;
  title: string;
  state: string;
  author: { login: string };
  createdAt: string;
  body?: string;
  comments?: IssueComment[];
}

interface IssueComment {
  [key: string]: unknown;
  author?: { login: string };
  body?: string;
  createdAt?: string;
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

export const ISSUE_HELP = `usage: gh-axi issue <subcommand> [flags]
subcommands[13]:
  list, view <number>, create, edit <number>, close <number>, reopen <number>, comment <number>, delete <number>, lock <number>, unlock <number>, pin <number>, unpin <number>, transfer <number>
flags{list}:
  --state <open|closed|all>, --label <name>, --assignee <login>, --author <login>, --milestone <name>, --sort <created|updated|comments>, --limit <n> (default 30)
flags{view}:
  --comments, --full (show complete body without truncation)
flags{create}:
  --title <text> (required), --body <text>, --assignee <login>, --label <name>, --milestone <name>
flags{edit}:
  --title, --body, --add-label, --remove-label, --add-assignee, --remove-assignee, --milestone
flags{close}:
  --reason <completed|not_planned>, --comment <text>
flags{comment}:
  --body <text> (required)
flags{transfer}:
  --repo <owner/name> (required)`;



// ---------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------

const listSchema: FieldDef[] = [
  field('number'),
  field('title'),
  lower('state'),
  pluck('author', 'login', 'author'),
  relativeTime('createdAt', 'created'),
];

const viewSchema: FieldDef[] = [
  field('number'),
  field('title'),
  lower('state'),
  pluck('author', 'login', 'author'),
  relativeTime('createdAt', 'created'),
  custom('body', (item: Record<string, unknown>) => truncateBody(item.body, 500)),
];

const viewSchemaFull: FieldDef[] = viewSchema.map(f =>
  'as' in f && f.as === 'body'
    ? custom('body', (item: Record<string, unknown>) => typeof item.body === 'string' ? item.body : '')
    : f,
);

const createResultSchema: FieldDef[] = [
  field('number'),
  field('title'),
  lower('state'),
  field('url'),
];

const editResultSchema: FieldDef[] = [
  field('number'),
  field('title'),
  lower('state'),
  joinArray('labels', 'name', 'labels'),
  joinArray('assignees', 'login', 'assignees'),
];

const stateResultSchema: FieldDef[] = [
  field('number'),
  lower('state'),
];

const commentResultSchema: FieldDef[] = [
  field('number', 'issue'),
  pluck('author', 'login', 'author'),
  relativeTime('createdAt', 'created'),
  custom('body', (item: Record<string, unknown>) => truncateBody(item.body, 800)),
];

const lockResultSchema: FieldDef[] = [
  field('number'),
  lower('state'),
  field('locked'),
];

const pinResultSchema: FieldDef[] = [
  field('number'),
  lower('state'),
  field('isPinned', 'pinned'),
];

const transferResultSchema: FieldDef[] = [
  field('number'),
  field('url'),
];

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

async function listIssues(args: string[], ctx?: RepoContext): Promise<string> {
  if (hasFlag(args, '--search')) {
    throw new AxiError('issue list does not support --search. Use `gh-axi search issues "<query>"` instead for full-text search with total counts.', 'VALIDATION_ERROR');
  }
  const state = getFlag(args, '--state');
  const label = getFlag(args, '--label');
  const assignee = getFlag(args, '--assignee');
  const author = getFlag(args, '--author');
  const milestone = getFlag(args, '--milestone');
  const sort = getFlag(args, '--sort');
  const limitRaw = getFlag(args, '--limit');
  const limit = limitRaw ? parseInt(limitRaw, 10) : 30;

  const ghArgs = ['issue', 'list', '--json', 'number,title,state,author,createdAt', '--limit', String(limit)];
  if (state) ghArgs.push('--state', state);
  if (label) ghArgs.push('--label', label);
  if (assignee) ghArgs.push('--assignee', assignee);
  if (author) ghArgs.push('--author', author);
  if (milestone) ghArgs.push('--milestone', milestone);
  if (sort) ghArgs.push('--search', `sort:${sort}-desc`);

  const items = await ghJson<IssueListItem[]>(ghArgs, ctx);
  const isEmpty = items.length === 0;

  // If we hit the limit, fetch the true totalCount via GraphQL
  let countLine: string;
  if (items.length === limit) {
    let totalCount: number | null = null;
    if (ctx) {
      try {
        const ghState = (state ?? 'open').toUpperCase();
        const query = `{ repository(owner:"${ctx.owner}", name:"${ctx.name}") { issues(states:[${ghState}]) { totalCount } } }`;
        const gqlResult = await ghRaw(['api', 'graphql', '-f', `query=${query}`]);
        if (gqlResult.exitCode === 0) {
          const parsed = JSON.parse(gqlResult.stdout);
          totalCount = parsed?.data?.repository?.issues?.totalCount ?? null;
        }
      } catch {
        // fall back to old behavior
      }
    }
    countLine = totalCount !== null
      ? `count: ${items.length} of ${totalCount} total`
      : `count: ${items.length} (showing first ${items.length}; run \`gh-axi repo view\` for total count)`;
  } else {
    countLine = `count: ${items.length}`;
  }

  const blocks: string[] = [countLine, renderList('issues', items, listSchema)];
  const help = getSuggestions({ domain: 'issue', action: 'list', isEmpty, repo: ctx });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function viewIssue(args: string[], ctx?: RepoContext): Promise<string> {
  const num = requireNumber(getPositional(args, 1), 'issue');
  const withComments = hasFlag(args, '--comments');
  const full = hasFlag(args, '--full');

  const fields = 'number,title,state,author,createdAt,body' + (withComments ? ',comments' : '');
  const ghArgs = ['issue', 'view', String(num), '--json', fields];

  const item = await ghJson<Record<string, unknown>>(ghArgs, ctx);
  const state = typeof item.state === 'string' ? item.state.toLowerCase() : undefined;

  const blocks: string[] = [renderDetail('issue', item, full ? viewSchemaFull : viewSchema)];

  if (withComments && Array.isArray(item.comments)) {
    blocks.push(renderList('comments', item.comments as Record<string, unknown>[], commentResultSchema.filter((d) => ('key' in d ? d.key !== 'number' : true))));
  }

  const help = getSuggestions({ domain: 'issue', action: 'view', state, id: num, repo: ctx });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function createIssue(args: string[], ctx?: RepoContext): Promise<string> {
  const title = getFlag(args, '--title');
  if (!title) throw new AxiError('--title is required', 'VALIDATION_ERROR');

  const body = getFlag(args, '--body');
  const assignee = getFlag(args, '--assignee');
  const label = getFlag(args, '--label');
  const milestone = getFlag(args, '--milestone');
  const project = getFlag(args, '--project');

  const ghArgs = ['issue', 'create', '--title', title];
  if (body) ghArgs.push('--body', body);
  if (assignee) ghArgs.push('--assignee', assignee);
  if (label) ghArgs.push('--label', label);
  if (milestone) ghArgs.push('--milestone', milestone);
  if (project) ghArgs.push('--project', project);

  // gh issue create outputs the URL; use --json to get structured data
  // Unfortunately gh issue create doesn't support --json, so we parse the URL
  const output = await ghExec(ghArgs, ctx);
  const urlMatch = output.match(/https:\/\/github\.com\/[^\s]+/);
  const url = urlMatch ? urlMatch[0] : output.trim();
  const numMatch = url.match(/\/issues\/(\d+)/);
  const num = numMatch ? parseInt(numMatch[1], 10) : 0;

  // Fetch the created issue for structured output
  const item = await ghJson<Record<string, unknown>>(['issue', 'view', String(num), '--json', 'number,title,state,url'], ctx);

  const blocks: string[] = [renderDetail('issue', item, createResultSchema)];
  const help = getSuggestions({ domain: 'issue', action: 'create', id: num, repo: ctx });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function editIssue(args: string[], ctx?: RepoContext): Promise<string> {
  const num = requireNumber(getPositional(args, 1), 'issue');

  const title = getFlag(args, '--title');
  const body = getFlag(args, '--body');
  const addLabel = getFlag(args, '--add-label');
  const removeLabel = getFlag(args, '--remove-label');
  const addAssignee = getFlag(args, '--add-assignee');
  const removeAssignee = getFlag(args, '--remove-assignee');
  const milestone = getFlag(args, '--milestone');

  const ghArgs = ['issue', 'edit', String(num)];
  if (title) ghArgs.push('--title', title);
  if (body) ghArgs.push('--body', body);
  if (addLabel) ghArgs.push('--add-label', addLabel);
  if (removeLabel) ghArgs.push('--remove-label', removeLabel);
  if (addAssignee) ghArgs.push('--add-assignee', addAssignee);
  if (removeAssignee) ghArgs.push('--remove-assignee', removeAssignee);
  if (milestone) ghArgs.push('--milestone', milestone);

  await ghExec(ghArgs, ctx);

  // Fetch updated issue
  const item = await ghJson<Record<string, unknown>>(['issue', 'view', String(num), '--json', 'number,title,state,labels,assignees'], ctx);

  const blocks: string[] = [renderDetail('issue', item, editResultSchema)];
  const help = getSuggestions({ domain: 'issue', action: 'edit', id: num, repo: ctx });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function closeIssue(args: string[], ctx?: RepoContext): Promise<string> {
  const num = requireNumber(getPositional(args, 1), 'issue');
  const reason = getFlag(args, '--reason');
  const comment = getFlag(args, '--comment');

  // Idempotent: check current state
  const current = await ghJson<{ state: string }>(['issue', 'view', String(num), '--json', 'state'], ctx);
  if (current.state.toLowerCase() === 'closed') {
    const item = await ghJson<Record<string, unknown>>(['issue', 'view', String(num), '--json', 'number,state'], ctx);
    const blocks: string[] = [renderDetail('issue', { ...item, _message: 'Already closed' }, [...stateResultSchema, field('_message', 'message')])];
    const help = getSuggestions({ domain: 'issue', action: 'close', id: num, repo: ctx });
    blocks.push(renderHelp(help));
    return renderOutput(blocks);
  }

  const ghArgs = ['issue', 'close', String(num)];
  if (reason) ghArgs.push('--reason', reason);
  if (comment) ghArgs.push('--comment', comment);

  await ghExec(ghArgs, ctx);

  const item = await ghJson<Record<string, unknown>>(['issue', 'view', String(num), '--json', 'number,state'], ctx);

  const blocks: string[] = [renderDetail('issue', item, stateResultSchema)];
  const help = getSuggestions({ domain: 'issue', action: 'close', id: num, repo: ctx });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function reopenIssue(args: string[], ctx?: RepoContext): Promise<string> {
  const num = requireNumber(getPositional(args, 1), 'issue');

  // Idempotent: check current state
  const current = await ghJson<{ state: string }>(['issue', 'view', String(num), '--json', 'state'], ctx);
  if (current.state.toLowerCase() === 'open') {
    const item = await ghJson<Record<string, unknown>>(['issue', 'view', String(num), '--json', 'number,state'], ctx);
    const blocks: string[] = [renderDetail('issue', { ...item, _message: 'Already open' }, [...stateResultSchema, field('_message', 'message')])];
    const help = getSuggestions({ domain: 'issue', action: 'reopen', id: num, repo: ctx });
    blocks.push(renderHelp(help));
    return renderOutput(blocks);
  }

  await ghExec(['issue', 'reopen', String(num)], ctx);

  const item = await ghJson<Record<string, unknown>>(['issue', 'view', String(num), '--json', 'number,state'], ctx);

  const blocks: string[] = [renderDetail('issue', item, stateResultSchema)];
  const help = getSuggestions({ domain: 'issue', action: 'reopen', id: num, repo: ctx });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function commentOnIssue(args: string[], ctx?: RepoContext): Promise<string> {
  const num = requireNumber(getPositional(args, 1), 'issue');
  const body = getFlag(args, '--body');
  if (!body) throw new AxiError('--body is required', 'VALIDATION_ERROR');

  await ghExec(['issue', 'comment', String(num), '--body', body], ctx);

  // Fetch the latest comment
  const issue = await ghJson<{ comments: IssueComment[] }>(['issue', 'view', String(num), '--json', 'comments'], ctx);
  const lastComment = issue.comments[issue.comments.length - 1];
  const commentItem = { ...lastComment, number: num };

  const blocks: string[] = [renderDetail('comment', commentItem, commentResultSchema)];
  const help = getSuggestions({ domain: 'issue', action: 'comment', id: num, repo: ctx });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function deleteIssue(args: string[], ctx?: RepoContext): Promise<string> {
  const num = requireNumber(getPositional(args, 1), 'issue');

  await ghExec(['issue', 'delete', String(num), '--yes'], ctx);

  const blocks: string[] = [renderDetail('issue', { number: num, status: 'deleted' }, [field('number'), field('status')])];
  const help = getSuggestions({ domain: 'issue', action: 'delete', id: num, repo: ctx });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function lockIssue(args: string[], ctx?: RepoContext): Promise<string> {
  const num = requireNumber(getPositional(args, 1), 'issue');

  // Idempotent: check current locked state
  const current = await ghJson<{ locked: boolean; state: string }>(['issue', 'view', String(num), '--json', 'state,locked'], ctx);
  if (current.locked) {
    const item = { number: num, state: current.state, locked: true, _message: 'Already locked' };
    const blocks: string[] = [renderDetail('issue', item, [...lockResultSchema, field('_message', 'message')])];
    const help = getSuggestions({ domain: 'issue', action: 'lock', id: num, repo: ctx });
    blocks.push(renderHelp(help));
    return renderOutput(blocks);
  }

  await ghExec(['issue', 'lock', String(num)], ctx);

  const item = await ghJson<Record<string, unknown>>(['issue', 'view', String(num), '--json', 'number,state,locked'], ctx);

  const blocks: string[] = [renderDetail('issue', item, lockResultSchema)];
  const help = getSuggestions({ domain: 'issue', action: 'lock', id: num, repo: ctx });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function unlockIssue(args: string[], ctx?: RepoContext): Promise<string> {
  const num = requireNumber(getPositional(args, 1), 'issue');

  // Idempotent: check current locked state
  const current = await ghJson<{ locked: boolean; state: string }>(['issue', 'view', String(num), '--json', 'state,locked'], ctx);
  if (!current.locked) {
    const item = { number: num, state: current.state, locked: false, _message: 'Already unlocked' };
    const blocks: string[] = [renderDetail('issue', { ...item }, [...lockResultSchema, field('_message', 'message')])];
    const help = getSuggestions({ domain: 'issue', action: 'unlock', id: num, repo: ctx });
    blocks.push(renderHelp(help));
    return renderOutput(blocks);
  }

  await ghExec(['issue', 'unlock', String(num)], ctx);

  const item = await ghJson<Record<string, unknown>>(['issue', 'view', String(num), '--json', 'number,state,locked'], ctx);

  const blocks: string[] = [renderDetail('issue', item, lockResultSchema)];
  const help = getSuggestions({ domain: 'issue', action: 'unlock', id: num, repo: ctx });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function pinIssue(args: string[], ctx?: RepoContext): Promise<string> {
  const num = requireNumber(getPositional(args, 1), 'issue');

  // Idempotent: check current pinned state
  const current = await ghJson<{ isPinned: boolean; state: string }>(['issue', 'view', String(num), '--json', 'state,isPinned'], ctx);
  if (current.isPinned) {
    const item = { number: num, state: current.state, isPinned: true, _message: 'Already pinned' };
    const blocks: string[] = [renderDetail('issue', item, [...pinResultSchema, field('_message', 'message')])];
    const help = getSuggestions({ domain: 'issue', action: 'pin', id: num, repo: ctx });
    blocks.push(renderHelp(help));
    return renderOutput(blocks);
  }

  await ghExec(['issue', 'pin', String(num)], ctx);

  const item = await ghJson<Record<string, unknown>>(['issue', 'view', String(num), '--json', 'number,state,isPinned'], ctx);

  const blocks: string[] = [renderDetail('issue', item, pinResultSchema)];
  const help = getSuggestions({ domain: 'issue', action: 'pin', id: num, repo: ctx });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function unpinIssue(args: string[], ctx?: RepoContext): Promise<string> {
  const num = requireNumber(getPositional(args, 1), 'issue');

  // Idempotent: check current pinned state
  const current = await ghJson<{ isPinned: boolean; state: string }>(['issue', 'view', String(num), '--json', 'state,isPinned'], ctx);
  if (!current.isPinned) {
    const item = { number: num, state: current.state, isPinned: false, _message: 'Already unpinned' };
    const blocks: string[] = [renderDetail('issue', item, [...pinResultSchema, field('_message', 'message')])];
    const help = getSuggestions({ domain: 'issue', action: 'unpin', id: num, repo: ctx });
    blocks.push(renderHelp(help));
    return renderOutput(blocks);
  }

  await ghExec(['issue', 'unpin', String(num)], ctx);

  const item = await ghJson<Record<string, unknown>>(['issue', 'view', String(num), '--json', 'number,state,isPinned'], ctx);

  const blocks: string[] = [renderDetail('issue', item, pinResultSchema)];
  const help = getSuggestions({ domain: 'issue', action: 'unpin', id: num, repo: ctx });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

async function transferIssue(args: string[], ctx?: RepoContext): Promise<string> {
  const num = requireNumber(getPositional(args, 1), 'issue');
  const destRepo = getFlag(args, '--repo');
  if (!destRepo) throw new AxiError('--repo is required for transfer', 'VALIDATION_ERROR');

  await ghExec(['issue', 'transfer', String(num), destRepo], ctx);

  // After transfer the issue gets a new URL; try to get it from the output
  // The transferred issue may have a new number in the target repo.
  // We can fetch by the original number since gh resolves it via redirect.
  let item: { number: number; url: string };
  try {
    item = await ghJson<{ number: number; url: string }>(['issue', 'view', String(num), '--json', 'number,url', '--repo', destRepo]);
  } catch {
    // Fallback: return what we know
    item = { number: num, url: `https://github.com/${destRepo}/issues/${num}` };
  }

  const blocks: string[] = [renderDetail('issue', item, transferResultSchema)];
  const help = getSuggestions({ domain: 'issue', action: 'transfer', id: num, repo: ctx });
  blocks.push(renderHelp(help));

  return renderOutput(blocks);
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function issueCommand(args: string[], ctx?: RepoContext): Promise<string> {
  const sub = args[0];

  if (!sub || hasFlag(args, '--help')) {
    const blocks: string[] = [ISSUE_HELP];
    const help = getSuggestions({ domain: 'issue', action: 'help', repo: ctx });
    if (help.length > 0) blocks.push(renderHelp(help));
    return renderOutput(blocks);
  }

  switch (sub) {
    case 'list':
      return listIssues(args, ctx);
    case 'view':
      return viewIssue(args, ctx);
    case 'create':
      return createIssue(args, ctx);
    case 'edit':
      return editIssue(args, ctx);
    case 'close':
      return closeIssue(args, ctx);
    case 'reopen':
      return reopenIssue(args, ctx);
    case 'comment':
      return commentOnIssue(args, ctx);
    case 'delete':
      return deleteIssue(args, ctx);
    case 'lock':
      return lockIssue(args, ctx);
    case 'unlock':
      return unlockIssue(args, ctx);
    case 'pin':
      return pinIssue(args, ctx);
    case 'unpin':
      return unpinIssue(args, ctx);
    case 'transfer':
      return transferIssue(args, ctx);
    default:
      return renderError(`Unknown issue subcommand: ${sub}`, 'VALIDATION_ERROR', [
        'Run `gh-axi issue --help` for usage',
      ]);
  }
}
