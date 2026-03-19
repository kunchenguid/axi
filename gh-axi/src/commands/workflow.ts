import { encode } from '@toon-format/toon';
import type { RepoContext } from '../context.js';
import { ghJson, ghExec } from '../gh.js';
import { AxiError } from '../errors.js';
import { getFlag, hasFlag, getAllFlags } from '../args.js';
import {
  field,
  lower,
  renderList,
  renderDetail,
  renderHelp,
  renderOutput,
  renderError,
  type FieldDef,
} from '../toon.js';
import { getSuggestions } from '../suggestions.js';

export const WORKFLOW_HELP = `usage: gh-axi workflow <subcommand> [flags]
subcommands[5]:
  list, view <id|name>, run <id|name>, enable <id|name>, disable <id|name>
flags{list}:
  --limit <n> (default 20), --all
flags{run}:
  --ref <git-ref>, --field <key=val> (repeatable)`;

const listSchema: FieldDef[] = [
  field('id'),
  field('name'),
  lower('state'),
  field('path'),
];

const viewSchema: FieldDef[] = [
  field('id'),
  field('name'),
  lower('state'),
  field('path'),
];


async function listWorkflows(args: string[], ctx?: RepoContext): Promise<string> {
  const limit = getFlag(args, '--limit') ?? '20';
  const ghArgs = [
    'workflow', 'list',
    '--json', 'id,name,state,path',
    '--limit', limit,
  ];
  if (hasFlag(args, '--all')) ghArgs.push('--all');

  const workflows = await ghJson<Record<string, unknown>[]>(ghArgs, ctx);
  const isEmpty = workflows.length === 0;
  const suggestions = getSuggestions({ domain: 'workflow', action: 'list', isEmpty, repo: ctx });
  return renderOutput([
    renderList('workflows', workflows, listSchema),
    renderHelp(suggestions),
  ]);
}

async function viewWorkflow(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const id = positionals[1];
  if (!id) throw new AxiError('Workflow ID or name is required: gh-axi workflow view <id|name>', 'VALIDATION_ERROR');

  // gh workflow view doesn't support --json, so list all and filter
  const workflows = await ghJson<Record<string, unknown>[]>(
    ['workflow', 'list', '--json', 'id,name,state,path', '--all'],
    ctx,
  );

  const match = workflows.find(
    (w) => String(w.id) === id || w.name === id || (typeof w.name === 'string' && w.name.toLowerCase() === id.toLowerCase()),
  );

  if (!match) throw new AxiError(`Workflow "${id}" not found`, 'NOT_FOUND');

  const suggestions = getSuggestions({ domain: 'workflow', action: 'view', id, repo: ctx });
  return renderOutput([
    renderDetail('workflow', match, viewSchema),
    renderHelp(suggestions),
  ]);
}

async function runWorkflow(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const id = positionals[1];
  if (!id) throw new AxiError('Workflow ID or name is required: gh-axi workflow run <id|name>', 'VALIDATION_ERROR');

  const ghArgs = ['workflow', 'run', id];
  const ref = getFlag(args, '--ref');
  if (ref) ghArgs.push('--ref', ref);
  const fields = getAllFlags(args, '--field');
  for (const f of fields) {
    ghArgs.push('--field', f);
  }

  await ghExec(ghArgs, ctx);
  const suggestions = getSuggestions({ domain: 'workflow', action: 'run', id, repo: ctx });
  return renderOutput([
    encode({ triggered: 'ok', workflow: id }),
    renderHelp(suggestions),
  ]);
}

async function enableWorkflow(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const id = positionals[1];
  if (!id) throw new AxiError('Workflow ID or name is required: gh-axi workflow enable <id|name>', 'VALIDATION_ERROR');

  // Idempotent: enable regardless of current state
  await ghExec(['workflow', 'enable', id], ctx);
  const suggestions = getSuggestions({ domain: 'workflow', action: 'enable', id, repo: ctx });
  return renderOutput([
    encode({ enable: 'ok', workflow: id }),
    renderHelp(suggestions),
  ]);
}

async function disableWorkflow(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const id = positionals[1];
  if (!id) throw new AxiError('Workflow ID or name is required: gh-axi workflow disable <id|name>', 'VALIDATION_ERROR');

  // Idempotent: disable regardless of current state
  await ghExec(['workflow', 'disable', id], ctx);
  const suggestions = getSuggestions({ domain: 'workflow', action: 'disable', id, repo: ctx });
  return renderOutput([
    encode({ disable: 'ok', workflow: id }),
    renderHelp(suggestions),
  ]);
}

export async function workflowCommand(args: string[], ctx?: RepoContext): Promise<string> {
  const sub = args[0];

  if (sub === '--help' || sub === undefined) return WORKFLOW_HELP;

  switch (sub) {
    case 'list':
      return listWorkflows(args, ctx);
    case 'view':
      return viewWorkflow(args, ctx);
    case 'run':
      return runWorkflow(args, ctx);
    case 'enable':
      return enableWorkflow(args, ctx);
    case 'disable':
      return disableWorkflow(args, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, 'VALIDATION_ERROR', [
        'Available subcommands: list, view, run, enable, disable',
      ]);
  }
}
