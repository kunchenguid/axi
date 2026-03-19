import { encode } from '@toon-format/toon';
import type { RepoContext } from '../context.js';
import { ghJson, ghExec } from '../gh.js';
import { AxiError } from '../errors.js';
import { getFlag, hasFlag } from '../args.js';
import {
  field,
  lower,
  relativeTime,
  renderList,
  renderDetail,
  renderHelp,
  renderOutput,
  renderError,
  type FieldDef,
} from '../toon.js';
import { getSuggestions } from '../suggestions.js';

export const RUN_HELP = `usage: gh-axi run <subcommand> [flags]
subcommands[7]:
  list, view <id>, watch <id>, rerun <id>, cancel <id>, delete <id>, download <id>
flags{list}:
  --workflow, --branch, --status, --event, --user, --commit, --limit (default 10)
flags{view}:
  --log, --log-failed, --conclusion <success|failure|cancelled|skipped> (filter jobs by conclusion)
flags{rerun}:
  --failed, --debug, --job
flags{download}:
  --name, --dir`;

const listSchema: FieldDef[] = [
  field('databaseId', 'id'),
  field('displayTitle', 'title'),
  lower('status'),
  lower('conclusion'),
  field('workflowName', 'workflow'),
  field('headBranch', 'branch'),
  field('event'),
  relativeTime('createdAt', 'created'),
];

const viewSchema: FieldDef[] = [
  field('databaseId', 'id'),
  field('displayTitle', 'title'),
  lower('status'),
  lower('conclusion'),
  field('workflowName', 'workflow'),
  field('headBranch', 'branch'),
  relativeTime('createdAt', 'created'),
];

const jobSchema: FieldDef[] = [
  field('name'),
  lower('status'),
  lower('conclusion'),
];


async function listRuns(args: string[], ctx?: RepoContext): Promise<string> {
  const limit = getFlag(args, '--limit') ?? '10';
  const ghArgs = [
    'run', 'list',
    '--json', 'databaseId,displayTitle,status,conclusion,workflowName,headBranch,event,createdAt',
    '--limit', limit,
  ];
  const workflow = getFlag(args, '--workflow');
  if (workflow) ghArgs.push('--workflow', workflow);
  const branch = getFlag(args, '--branch');
  if (branch) ghArgs.push('--branch', branch);
  const status = getFlag(args, '--status');
  if (status) ghArgs.push('--status', status);
  const event = getFlag(args, '--event');
  if (event) ghArgs.push('--event', event);
  const user = getFlag(args, '--user');
  if (user) ghArgs.push('--user', user);
  const commit = getFlag(args, '--commit');
  if (commit) ghArgs.push('--commit', commit);

  const runs = await ghJson<Record<string, unknown>[]>(ghArgs, ctx);
  const isEmpty = runs.length === 0;
  const limitNum = Number(limit);
  const countLine = runs.length === limitNum
    ? `count: ${runs.length} (showing first ${runs.length}; run \`gh-axi repo view\` for total count)`
    : `count: ${runs.length}`;
  const suggestions = getSuggestions({ domain: 'run', action: 'list', isEmpty, repo: ctx });
  return renderOutput([
    countLine,
    renderList('runs', runs, listSchema),
    renderHelp(suggestions),
  ]);
}

async function viewRun(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const id = positionals[1]; // positionals[0] is "view"
  if (!id) throw new AxiError('Run ID is required: gh-axi run view <id>', 'VALIDATION_ERROR');

  // Handle log modes
  if (hasFlag(args, '--log') || hasFlag(args, '--verbose')) {
    return ghExec(['run', 'view', id, '--log'], ctx);
  }
  if (hasFlag(args, '--log-failed')) {
    return ghExec(['run', 'view', id, '--log-failed'], ctx);
  }

  const run = await ghJson<Record<string, unknown>>(
    ['run', 'view', id, '--json', 'databaseId,displayTitle,status,conclusion,workflowName,headBranch,createdAt,jobs'],
    ctx,
  );

  const state = run.status === 'completed' ? 'completed' : 'in_progress';
  const suggestions = getSuggestions({ domain: 'run', action: 'view', state, id, repo: ctx });

  const blocks: string[] = [renderDetail('run', run, viewSchema)];

  const jobsArr = run.jobs;
  if (Array.isArray(jobsArr) && jobsArr.length > 0) {
    const typedJobs = jobsArr as Record<string, unknown>[];
    const conclusionFilter = getFlag(args, '--conclusion');
    const jobs = conclusionFilter
      ? typedJobs.filter((j) => (typeof j.conclusion === 'string' ? j.conclusion : '').toLowerCase() === conclusionFilter.toLowerCase())
      : typedJobs;
    if (conclusionFilter) {
      blocks.push(`jobs: ${jobs.length} of ${typedJobs.length} with conclusion=${conclusionFilter}`);
    }
    blocks.push(renderList('jobs', jobs, jobSchema));
  }

  blocks.push(renderHelp(suggestions));
  return renderOutput(blocks);
}

async function watchRun(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const id = positionals[1];
  if (!id) throw new AxiError('Run ID is required: gh-axi run watch <id>', 'VALIDATION_ERROR');

  const ghArgs = ['run', 'watch', id, '--exit-status'];
  const output = await ghExec(ghArgs, ctx);
  const suggestions = getSuggestions({ domain: 'run', action: 'watch', id, repo: ctx });
  return renderOutput([output.trim(), renderHelp(suggestions)]);
}

async function rerunRun(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const id = positionals[1];
  if (!id) throw new AxiError('Run ID is required: gh-axi run rerun <id>', 'VALIDATION_ERROR');

  const ghArgs = ['run', 'rerun', id];
  if (hasFlag(args, '--failed')) ghArgs.push('--failed');
  if (hasFlag(args, '--debug')) ghArgs.push('--debug');
  const job = getFlag(args, '--job');
  if (job) ghArgs.push('--job', job);

  await ghExec(ghArgs, ctx);
  const suggestions = getSuggestions({ domain: 'run', action: 'rerun', id, repo: ctx });
  return renderOutput([
    encode({ rerun: 'ok', run: id }),
    renderHelp(suggestions),
  ]);
}

async function cancelRun(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const id = positionals[1];
  if (!id) throw new AxiError('Run ID is required: gh-axi run cancel <id>', 'VALIDATION_ERROR');

  // Idempotent: check status first
  const run = await ghJson<Record<string, unknown>>(
    ['run', 'view', id, '--json', 'status,conclusion'],
    ctx,
  );

  if (run.status === 'completed') {
    const suggestions = getSuggestions({ domain: 'run', action: 'cancel', id, repo: ctx });
    return renderOutput([
      encode({ cancel: 'already_completed', run: id, conclusion: typeof run.conclusion === 'string' ? run.conclusion.toLowerCase() : 'unknown' }),
      renderHelp(suggestions),
    ]);
  }

  await ghExec(['run', 'cancel', id], ctx);
  const suggestions = getSuggestions({ domain: 'run', action: 'cancel', id, repo: ctx });
  return renderOutput([
    encode({ cancel: 'ok', run: id }),
    renderHelp(suggestions),
  ]);
}

async function deleteRun(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const id = positionals[1];
  if (!id) throw new AxiError('Run ID is required: gh-axi run delete <id>', 'VALIDATION_ERROR');

  await ghExec(['run', 'delete', id], ctx);
  const suggestions = getSuggestions({ domain: 'run', action: 'delete', id, repo: ctx });
  return renderOutput([
    encode({ delete: 'ok', run: id }),
    renderHelp(suggestions),
  ]);
}

async function downloadRun(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const id = positionals[1];
  if (!id) throw new AxiError('Run ID is required: gh-axi run download <id>', 'VALIDATION_ERROR');

  const ghArgs = ['run', 'download', id];
  const name = getFlag(args, '--name');
  if (name) ghArgs.push('--name', name);
  const dir = getFlag(args, '--dir');
  if (dir) ghArgs.push('--dir', dir);

  await ghExec(ghArgs, ctx);
  const suggestions = getSuggestions({ domain: 'run', action: 'download', id, repo: ctx });
  return renderOutput([
    encode({ download: 'ok', run: id }),
    renderHelp(suggestions),
  ]);
}

export async function runCommand(args: string[], ctx?: RepoContext): Promise<string> {
  const sub = args[0];

  if (sub === '--help' || sub === undefined) return RUN_HELP;

  switch (sub) {
    case 'list':
      return listRuns(args, ctx);
    case 'view':
      return viewRun(args, ctx);
    case 'watch':
      return watchRun(args, ctx);
    case 'rerun':
      return rerunRun(args, ctx);
    case 'cancel':
      return cancelRun(args, ctx);
    case 'delete':
      return deleteRun(args, ctx);
    case 'download':
      return downloadRun(args, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, 'VALIDATION_ERROR', [
        'Available subcommands: list, view, watch, rerun, cancel, delete, download',
      ]);
  }
}
