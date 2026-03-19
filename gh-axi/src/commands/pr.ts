import { encode } from '@toon-format/toon';
import type { RepoContext } from '../context.js';
import { ghJson, ghExec, ghRaw } from '../gh.js';
import { AxiError } from '../errors.js';
import { truncateBody } from '../body.js';
import { getSuggestions } from '../suggestions.js';
import { takeFlag, takeBoolFlag, takeNumber } from '../args.js';
import {
  field,
  pluck,
  lower,
  boolYesNo,
  mapEnum,
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

interface CheckRun {
  name?: string;
  context?: string;
  conclusion?: string;
  state?: string;
  status?: string;
}

interface PrComment {
  author?: { login: string };
  body?: string;
  createdAt?: string;
}

interface PrItem {
  number: number;
  title: string;
  state: string;
  author: { login: string };
  isDraft: boolean;
  reviewDecision: string;
  mergedAt?: string;
  statusCheckRollup?: CheckRun[];
  body?: string;
  comments?: PrComment[];
  mergedBy?: { login: string };
}

interface RevertResult {
  number?: number;
  html_url?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Classify a CI check run into a simple status category. */
function classifyCheck(c: CheckRun): 'pass' | 'fail' | 'skip' | 'pending' {
  const conc = (c.conclusion ?? '').toUpperCase();
  const st = (c.state ?? c.status ?? '').toUpperCase();
  if (conc === 'SUCCESS' || conc === 'NEUTRAL') return 'pass';
  if (conc === 'FAILURE' || conc === 'TIMED_OUT' || conc === 'ACTION_REQUIRED') return 'fail';
  if (conc === 'SKIPPED' || conc === 'CANCELLED' || st === 'EXPECTED' || st === 'NEUTRAL') return 'skip';
  return 'pending';
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const REVIEW_MAP: Record<string, string> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
  REVIEW_REQUIRED: 'required',
};

const listSchema: FieldDef[] = [
  field('number'),
  field('title'),
  lower('state'),
  pluck('author', 'login', 'author'),
  boolYesNo('isDraft', 'draft'),
  mapEnum('reviewDecision', REVIEW_MAP, 'none', 'review'),
];

const LIST_JSON_FIELDS = 'number,title,state,author,isDraft,reviewDecision';

const viewSchema: FieldDef[] = [
  field('number'),
  field('title'),
  lower('state'),
  pluck('author', 'login', 'author'),
  boolYesNo('isDraft', 'draft'),
  custom('merged', (item: PrItem) => {
    if ((item.state ?? '').toUpperCase() === 'MERGED') return item.mergedAt ?? 'yes';
    return 'no';
  }),
  custom('checks', (item: PrItem) => {
    const checks = item.statusCheckRollup;
    if (!Array.isArray(checks) || checks.length === 0) return '0 passed, 0 failed — this PR has no CI checks configured';
    const passed = checks.filter((c: CheckRun) => classifyCheck(c) === 'pass').length;
    const failed = checks.filter((c: CheckRun) => classifyCheck(c) === 'fail').length;
    const skipped = checks.filter((c: CheckRun) => classifyCheck(c) === 'skip').length;
    const parts = [`${passed} passed`, `${failed} failed`];
    if (skipped > 0) parts.push(`${skipped} skipped`);
    parts.push(`${checks.length} total`);
    return parts.join(', ');
  }),
  custom('body', (item: PrItem) => truncateBody(item.body, 500)),
];

const viewSchemaFull: FieldDef[] = viewSchema.map(f =>
  'as' in f && f.as === 'body'
    ? custom('body', (item: PrItem) => typeof item.body === 'string' ? item.body : '')
    : f,
);

const VIEW_JSON_FIELDS =
  'number,title,state,author,isDraft,mergedAt,statusCheckRollup,body,comments';

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

export const PR_HELP = `usage: gh-axi pr <subcommand> [flags]
subcommands[15]:
  list, view <number>, create, edit <number>, close <number>, merge <number>, review <number>, checks <number>, diff <number>, checkout <number>, ready <number>, reopen <number>, comment <number>, update-branch <number>, revert <number>
flags{list}:
  --state <open|closed|all>, --label, --assignee, --author, --base, --head, --draft, --limit <n> (default 30)
flags{view}:
  --comments, --full (show complete body without truncation)
flags{create}:
  --title <text> (required), --body, --base, --head, --draft, --assignee, --reviewer, --label, --milestone
flags{merge}:
  --method <merge|squash|rebase>, --auto, --delete-branch, --body, --subject
flags{review}:
  --approve, --request-changes, --comment, --body
flags{checks}:
  (none)`;

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function prList(args: string[], ctx?: RepoContext): Promise<string> {
  if (args.includes('--search')) {
    throw new AxiError('pr list does not support --search. Use `gh-axi search prs "<query>"` instead for full-text search with total counts.', 'VALIDATION_ERROR');
  }
  const state = takeFlag(args, '--state') ?? 'open';
  const label = takeFlag(args, '--label');
  const assignee = takeFlag(args, '--assignee');
  const author = takeFlag(args, '--author');
  const base = takeFlag(args, '--base');
  const head = takeFlag(args, '--head');
  const draft = takeBoolFlag(args, '--draft');
  const limit = takeFlag(args, '--limit') ?? '30';

  const ghArgs = ['pr', 'list', '--json', LIST_JSON_FIELDS, '--state', state, '--limit', limit];
  if (label) ghArgs.push('--label', label);
  if (assignee) ghArgs.push('--assignee', assignee);
  if (author) ghArgs.push('--author', author);
  if (base) ghArgs.push('--base', base);
  if (head) ghArgs.push('--head', head);
  if (draft) ghArgs.push('--draft');

  const items = await ghJson<PrItem[]>(ghArgs, ctx);
  const isEmpty = items.length === 0;
  const limitNum = Number(limit);

  // If we hit the limit, fetch the true totalCount via GraphQL
  let countLine: string;
  if (items.length === limitNum) {
    let totalCount: number | null = null;
    if (ctx) {
      try {
        const ghState = state.toUpperCase();
        const statesFilter = ghState === 'ALL' ? '' : `states:[${ghState === 'CLOSED' ? 'CLOSED,MERGED' : ghState}]`;
        const query = `{ repository(owner:"${ctx.owner}", name:"${ctx.name}") { pullRequests(${statesFilter}) { totalCount } } }`;
        const gqlResult = await ghRaw(['api', 'graphql', '-f', `query=${query}`]);
        if (gqlResult.exitCode === 0) {
          const parsed = JSON.parse(gqlResult.stdout);
          totalCount = parsed?.data?.repository?.pullRequests?.totalCount ?? null;
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

  return renderOutput([
    countLine,
    renderList('pull_requests', items, listSchema),
    renderHelp(getSuggestions({ domain: 'pr', action: 'list', isEmpty, repo: ctx })),
  ]);
}

async function prView(args: string[], ctx?: RepoContext): Promise<string> {
  const includeComments = takeBoolFlag(args, '--comments');
  const full = takeBoolFlag(args, '--full');
  const num = takeNumber(args, 'PR');

  // Always fetch comments (for count or full rendering)
  const ghArgs = ['pr', 'view', String(num), '--json', VIEW_JSON_FIELDS];
  const pr = await ghJson<PrItem>(ghArgs, ctx);

  const schema = [...(full ? viewSchemaFull : viewSchema)];
  if (includeComments && Array.isArray(pr.comments)) {
    schema.push(
      custom('comments', (item: PrItem) =>
        (item.comments ?? []).map((c: PrComment) => ({
          author: c.author?.login ?? 'unknown',
          body: c.body ?? '',
          created: c.createdAt ?? '',
        })),
      ),
    );
  } else {
    const commentCount = Array.isArray(pr.comments) ? pr.comments.length : 0;
    schema.push(
      custom('comment_count', () => `${commentCount} — use --comments to see full comments`),
    );
  }

  const state = (pr.state ?? '').toLowerCase();
  return renderOutput([
    renderDetail('pull_request', pr, schema),
    renderHelp(getSuggestions({ domain: 'pr', action: 'view', id: num, state, repo: ctx })),
  ]);
}

async function prCreate(args: string[], ctx?: RepoContext): Promise<string> {
  const title = takeFlag(args, '--title');
  if (!title) throw new AxiError('--title is required', 'VALIDATION_ERROR');
  const body = takeFlag(args, '--body');
  const base = takeFlag(args, '--base');
  const head = takeFlag(args, '--head');
  const draft = takeBoolFlag(args, '--draft');
  const assignee = takeFlag(args, '--assignee');
  const reviewer = takeFlag(args, '--reviewer');
  const label = takeFlag(args, '--label');
  const milestone = takeFlag(args, '--milestone');
  const project = takeFlag(args, '--project');

  const ghArgs = ['pr', 'create', '--title', title];
  if (body) ghArgs.push('--body', body);
  if (base) ghArgs.push('--base', base);
  if (head) ghArgs.push('--head', head);
  if (draft) ghArgs.push('--draft');
  if (assignee) ghArgs.push('--assignee', assignee);
  if (reviewer) ghArgs.push('--reviewer', reviewer);
  if (label) ghArgs.push('--label', label);
  if (milestone) ghArgs.push('--milestone', milestone);
  if (project) ghArgs.push('--project', project);

  const stdout = await ghExec(ghArgs, ctx);
  // Parse PR number from URL: https://github.com/OWNER/REPO/pull/123
  const urlMatch = stdout.match(/\/pull\/(\d+)/);
  const num = urlMatch ? Number(urlMatch[1]) : undefined;
  const url = stdout.trim().split('\n').pop()?.trim() ?? '';

  return renderOutput([
    renderDetail('created', { number: num ?? url, url }, [field('number'), field('url')]),
    renderHelp(getSuggestions({ domain: 'pr', action: 'create', id: num, repo: ctx })),
  ]);
}

async function prEdit(args: string[], ctx?: RepoContext): Promise<string> {
  const num = takeNumber(args, 'PR');
  const title = takeFlag(args, '--title');
  const body = takeFlag(args, '--body');
  const addLabel = takeFlag(args, '--add-label');
  const removeLabel = takeFlag(args, '--remove-label');
  const addAssignee = takeFlag(args, '--add-assignee');
  const removeAssignee = takeFlag(args, '--remove-assignee');
  const addReviewer = takeFlag(args, '--add-reviewer');
  const removeReviewer = takeFlag(args, '--remove-reviewer');
  const milestone = takeFlag(args, '--milestone');
  const base = takeFlag(args, '--base');

  const ghArgs = ['pr', 'edit', String(num)];
  if (title) ghArgs.push('--title', title);
  if (body) ghArgs.push('--body', body);
  if (addLabel) ghArgs.push('--add-label', addLabel);
  if (removeLabel) ghArgs.push('--remove-label', removeLabel);
  if (addAssignee) ghArgs.push('--add-assignee', addAssignee);
  if (removeAssignee) ghArgs.push('--remove-assignee', removeAssignee);
  if (addReviewer) ghArgs.push('--add-reviewer', addReviewer);
  if (removeReviewer) ghArgs.push('--remove-reviewer', removeReviewer);
  if (milestone) ghArgs.push('--milestone', milestone);
  if (base) ghArgs.push('--base', base);

  await ghExec(ghArgs, ctx);
  return renderOutput([
    renderDetail('edited', { number: num, status: 'ok' }, [field('number'), field('status')]),
    renderHelp(getSuggestions({ domain: 'pr', action: 'edit', id: num, repo: ctx })),
  ]);
}

async function prClose(args: string[], ctx?: RepoContext): Promise<string> {
  const comment = takeFlag(args, '--comment');
  const num = takeNumber(args, 'PR');

  // Idempotent: check current state
  const pr = await ghJson<Pick<PrItem, 'state'>>(['pr', 'view', String(num), '--json', 'state'], ctx);
  const state = (pr.state ?? '').toUpperCase();
  if (state === 'CLOSED' || state === 'MERGED') {
    return renderOutput([
      renderDetail('pull_request', { number: num, state: state.toLowerCase(), already: true }, [
        field('number'),
        field('state'),
        field('already'),
      ]),
      renderHelp(getSuggestions({ domain: 'pr', action: 'close', id: num, repo: ctx })),
    ]);
  }

  const ghArgs = ['pr', 'close', String(num)];
  if (comment) ghArgs.push('--comment', comment);
  await ghExec(ghArgs, ctx);

  return renderOutput([
    renderDetail('closed', { number: num, status: 'ok' }, [field('number'), field('status')]),
    renderHelp(getSuggestions({ domain: 'pr', action: 'close', id: num, repo: ctx })),
  ]);
}

async function prMerge(args: string[], ctx?: RepoContext): Promise<string> {
  const num = takeNumber(args, 'PR');
  const method = takeFlag(args, '--method');
  const auto = takeBoolFlag(args, '--auto');
  const deleteBranch = takeBoolFlag(args, '--delete-branch');
  const body = takeFlag(args, '--body');
  const subject = takeFlag(args, '--subject');

  // Idempotent: check if already merged
  const pr = await ghJson<Pick<PrItem, 'state' | 'mergedBy' | 'mergedAt'>>(
    ['pr', 'view', String(num), '--json', 'state,mergedBy,mergedAt'],
    ctx,
  );
  if ((pr.state ?? '').toUpperCase() === 'MERGED') {
    return renderOutput([
      renderDetail('pull_request', {
        number: num,
        state: 'merged',
        merged_by: pr.mergedBy?.login ?? null,
        merged_at: pr.mergedAt ?? null,
      }, [field('number'), field('state'), field('merged_by'), field('merged_at')]),
      renderHelp(getSuggestions({ domain: 'pr', action: 'merge', id: num, repo: ctx })),
    ]);
  }

  const ghArgs = ['pr', 'merge', String(num)];
  if (method) ghArgs.push('--' + method);
  if (auto) ghArgs.push('--auto');
  if (deleteBranch) ghArgs.push('--delete-branch');
  if (body) ghArgs.push('--body', body);
  if (subject) ghArgs.push('--subject', subject);

  await ghExec(ghArgs, ctx);

  return renderOutput([
    renderDetail('merged', { number: num, status: 'ok', method: method ?? 'default' }, [
      field('number'),
      field('status'),
      field('method'),
    ]),
    renderHelp(getSuggestions({ domain: 'pr', action: 'merge', id: num, repo: ctx })),
  ]);
}

async function prReview(args: string[], ctx?: RepoContext): Promise<string> {
  const num = takeNumber(args, 'PR');
  const approve = takeBoolFlag(args, '--approve');
  const requestChanges = takeBoolFlag(args, '--request-changes');
  const commentFlag = takeBoolFlag(args, '--comment');
  const body = takeFlag(args, '--body');

  const ghArgs = ['pr', 'review', String(num)];
  if (approve) ghArgs.push('--approve');
  else if (requestChanges) ghArgs.push('--request-changes');
  else if (commentFlag) ghArgs.push('--comment');
  if (body) ghArgs.push('--body', body);

  await ghExec(ghArgs, ctx);

  const action = approve ? 'approved' : requestChanges ? 'changes_requested' : 'commented';
  return renderOutput([
    renderDetail('review', { number: num, action }, [field('number'), field('action')]),
    renderHelp(getSuggestions({ domain: 'pr', action: 'review', id: num, repo: ctx })),
  ]);
}

async function prChecks(args: string[], ctx?: RepoContext): Promise<string> {
  const num = takeNumber(args, 'PR');

  // Use pr view --json statusCheckRollup instead of pr checks --json which
  // can error on PRs with unusual check data
  const pr = await ghJson<Pick<PrItem, 'statusCheckRollup'>>(
    ['pr', 'view', String(num), '--json', 'statusCheckRollup'],
    ctx,
  );
  const checks: CheckRun[] = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];

  if (checks.length === 0) {
    return renderOutput([
      encode({ checks: '0 passed, 0 failed — this PR has no CI checks configured' }),
    ]);
  }

  // Pre-compute summary counts so agents don't have to count rows
  const passed = checks.filter((c: CheckRun) => classifyCheck(c) === 'pass').length;
  const failed = checks.filter((c: CheckRun) => classifyCheck(c) === 'fail').length;
  const skipped = checks.filter((c: CheckRun) => classifyCheck(c) === 'skip').length;
  const pending = checks.length - passed - failed - skipped;

  const summaryParts = [`${passed} passed`, `${failed} failed`];
  if (skipped > 0) summaryParts.push(`${skipped} skipped`);
  if (pending > 0) summaryParts.push(`${pending} pending`);
  summaryParts.push(`${checks.length} total`);

  const checksSchema: FieldDef[] = [
    custom('name', (c: CheckRun) => c.name ?? c.context ?? 'check'),
    custom('conclusion', (c: CheckRun) => classifyCheck(c)),
  ];

  return renderOutput([
    encode({ summary: summaryParts.join(', ') }),
    renderList('checks', checks, checksSchema),
    renderHelp(getSuggestions({ domain: 'pr', action: 'checks', id: num, repo: ctx })),
  ]);
}

async function prDiff(args: string[], ctx?: RepoContext): Promise<string> {
  const num = takeNumber(args, 'PR');
  const diff = await ghExec(['pr', 'diff', String(num)], ctx);
  return diff;
}

async function prCheckout(args: string[], ctx?: RepoContext): Promise<string> {
  const num = takeNumber(args, 'PR');
  const stdout = await ghExec(['pr', 'checkout', String(num)], ctx);
  // Extract branch name from output
  const branchMatch = stdout.match(/Switched to branch '([^']+)'/);
  const branch = branchMatch ? branchMatch[1] : stdout.trim();

  return renderOutput([
    renderDetail('checkout', { number: num, branch, status: 'ok' }, [
      field('number'),
      field('branch'),
      field('status'),
    ]),
    renderHelp(getSuggestions({ domain: 'pr', action: 'checkout', id: num, repo: ctx })),
  ]);
}

async function prReady(args: string[], ctx?: RepoContext): Promise<string> {
  const num = takeNumber(args, 'PR');

  // Idempotent: check if already not a draft
  const pr = await ghJson<Pick<PrItem, 'isDraft'>>(['pr', 'view', String(num), '--json', 'isDraft'], ctx);
  if (!pr.isDraft) {
    return renderOutput([
      renderDetail('pull_request', { number: num, draft: 'no', already: true }, [
        field('number'),
        field('draft'),
        field('already'),
      ]),
      renderHelp(getSuggestions({ domain: 'pr', action: 'ready', id: num, repo: ctx })),
    ]);
  }

  await ghExec(['pr', 'ready', String(num)], ctx);
  return renderOutput([
    renderDetail('ready', { number: num, status: 'ok' }, [field('number'), field('status')]),
    renderHelp(getSuggestions({ domain: 'pr', action: 'ready', id: num, repo: ctx })),
  ]);
}

async function prReopen(args: string[], ctx?: RepoContext): Promise<string> {
  const num = takeNumber(args, 'PR');

  // Idempotent: check current state
  const pr = await ghJson<Pick<PrItem, 'state'>>(['pr', 'view', String(num), '--json', 'state'], ctx);
  const state = (pr.state ?? '').toUpperCase();
  if (state === 'OPEN') {
    return renderOutput([
      renderDetail('pull_request', { number: num, state: 'open', already: true }, [
        field('number'),
        field('state'),
        field('already'),
      ]),
      renderHelp(getSuggestions({ domain: 'pr', action: 'reopen', id: num, repo: ctx })),
    ]);
  }

  await ghExec(['pr', 'reopen', String(num)], ctx);
  return renderOutput([
    renderDetail('reopened', { number: num, status: 'ok' }, [field('number'), field('status')]),
    renderHelp(getSuggestions({ domain: 'pr', action: 'reopen', id: num, repo: ctx })),
  ]);
}

async function prComment(args: string[], ctx?: RepoContext): Promise<string> {
  const num = takeNumber(args, 'PR');
  const body = takeFlag(args, '--body');
  if (!body) throw new AxiError('--body is required', 'VALIDATION_ERROR');

  await ghExec(['pr', 'comment', String(num), '--body', body], ctx);
  return renderOutput([
    renderDetail('commented', { number: num, status: 'ok' }, [field('number'), field('status')]),
    renderHelp(getSuggestions({ domain: 'pr', action: 'comment', id: num, repo: ctx })),
  ]);
}

async function prUpdateBranch(args: string[], ctx?: RepoContext): Promise<string> {
  const num = takeNumber(args, 'PR');
  await ghExec(['pr', 'update-branch', String(num)], ctx);
  return renderOutput([
    renderDetail('updated', { number: num, status: 'ok' }, [field('number'), field('status')]),
    renderHelp(getSuggestions({ domain: 'pr', action: 'update-branch', id: num, repo: ctx })),
  ]);
}

async function prRevert(args: string[], ctx?: RepoContext): Promise<string> {
  const num = takeNumber(args, 'PR');

  // gh pr revert may not exist in all gh versions; fall back to API
  const result = await ghRaw(['pr', 'revert', String(num)], ctx);
  if (result.exitCode === 0) {
    // Try to extract the new PR number/URL from stdout
    const urlMatch = result.stdout.match(/\/pull\/(\d+)/);
    const newNum = urlMatch ? Number(urlMatch[1]) : null;
    return renderOutput([
      renderDetail('reverted', { number: num, revert_pr: newNum, status: 'ok' }, [
        field('number'),
        field('revert_pr'),
        field('status'),
      ]),
      renderHelp(getSuggestions({ domain: 'pr', action: 'revert', id: newNum ?? num, repo: ctx })),
    ]);
  }

  // Fallback: use gh api to create a revert via the REST API
  const apiResult = await ghRaw(
    ['api', `repos/{owner}/{repo}/pulls/${num}/revert`, '--method', 'POST'],
    ctx,
  );
  if (apiResult.exitCode !== 0) {
    throw new AxiError(
      apiResult.stderr.trim().split('\n')[0] || `Failed to revert PR #${num}`,
      'UNKNOWN',
    );
  }
  let revertData: RevertResult;
  try {
    revertData = JSON.parse(apiResult.stdout) as RevertResult;
  } catch {
    revertData = {};
  }

  return renderOutput([
    renderDetail('reverted', {
      number: num,
      revert_pr: revertData.number ?? null,
      url: revertData.html_url ?? null,
      status: 'ok',
    }, [field('number'), field('revert_pr'), field('url'), field('status')]),
    renderHelp(getSuggestions({ domain: 'pr', action: 'revert', id: revertData.number ?? num, repo: ctx })),
  ]);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function prCommand(args: string[], ctx?: RepoContext): Promise<string> {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case 'list':
      return prList(rest, ctx);
    case 'view':
      return prView(rest, ctx);
    case 'create':
      return prCreate(rest, ctx);
    case 'edit':
      return prEdit(rest, ctx);
    case 'close':
      return prClose(rest, ctx);
    case 'merge':
      return prMerge(rest, ctx);
    case 'review':
      return prReview(rest, ctx);
    case 'checks':
      return prChecks(rest, ctx);
    case 'diff':
      return prDiff(rest, ctx);
    case 'checkout':
      return prCheckout(rest, ctx);
    case 'ready':
      return prReady(rest, ctx);
    case 'reopen':
      return prReopen(rest, ctx);
    case 'comment':
      return prComment(rest, ctx);
    case 'update-branch':
      return prUpdateBranch(rest, ctx);
    case 'revert':
      return prRevert(rest, ctx);
    case '--help':
    case '-h':
    case 'help':
    case undefined:
      return PR_HELP;
    default:
      return renderError(`Unknown pr subcommand: ${sub}`, 'VALIDATION_ERROR', [
        'Run `gh-axi pr --help` to see available subcommands',
      ]);
  }
}
