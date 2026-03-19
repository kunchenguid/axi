import { encode } from '@toon-format/toon';
import type { RepoContext } from '../context.js';
import { ghJson, ghExec } from '../gh.js';
import { AxiError } from '../errors.js';
import { getFlag } from '../args.js';
import {
  field,
  renderList,
  renderHelp,
  renderOutput,
  renderError,
  type FieldDef,
} from '../toon.js';
import { getSuggestions } from '../suggestions.js';

export const LABEL_HELP = `usage: gh-axi label <subcommand> [flags]
subcommands[4]:
  list, create, edit <name>, delete <name>
flags{list}:
  --limit <n> (default 500)
flags{create}:
  --name <text> (required), --color <hex> (required, without #), --description <text>
flags{edit}:
  --name, --color, --description`;

const listSchema: FieldDef[] = [
  field('name'),
];


async function listLabels(args: string[], ctx?: RepoContext): Promise<string> {
  const limitArg = getFlag(args, '--limit');
  const limit = limitArg ?? '500';
  const ghArgs = [
    'label', 'list',
    '--json', 'name',
    '--limit', limit,
  ];

  const labels = await ghJson<Record<string, unknown>[]>(ghArgs, ctx);
  const isEmpty = labels.length === 0;

  // Add a count line so agents don't need to count rows
  const countLine = labels.length === Number(limit)
    ? `count: ${labels.length} (showing first ${labels.length}; run \`gh-axi repo view\` for total count)`
    : `count: ${labels.length}`;

  const suggestions = getSuggestions({ domain: 'label', action: 'list', isEmpty, repo: ctx });
  return renderOutput([
    countLine,
    renderList('labels', labels, listSchema),
    renderHelp(suggestions),
  ]);
}

async function createLabel(args: string[], ctx?: RepoContext): Promise<string> {
  const name = getFlag(args, '--name');
  if (!name) throw new AxiError('--name is required: gh-axi label create --name "..." --color "..."', 'VALIDATION_ERROR');
  const color = getFlag(args, '--color');
  if (!color) throw new AxiError('--color is required: gh-axi label create --name "..." --color "..."', 'VALIDATION_ERROR');

  // Idempotent: check if label already exists
  const existing = await ghJson<Record<string, unknown>[]>(
    ['label', 'list', '--json', 'name'],
    ctx,
  );
  const found = existing.find((l) => typeof l.name === 'string' && l.name.toLowerCase() === name.toLowerCase());
  if (found) {
    const suggestions = getSuggestions({ domain: 'label', action: 'create', repo: ctx });
    return renderOutput([
      encode({ create: 'already_exists', label: found.name }),
      renderHelp(suggestions),
    ]);
  }

  const ghArgs = ['label', 'create', name, '--color', color];
  const description = getFlag(args, '--description');
  if (description) ghArgs.push('--description', description);

  await ghExec(ghArgs, ctx);
  const suggestions = getSuggestions({ domain: 'label', action: 'create', repo: ctx });
  return renderOutput([
    encode({ created: 'ok', label: name }),
    renderHelp(suggestions),
  ]);
}

async function editLabel(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const labelName = positionals[1];
  if (!labelName) throw new AxiError('Label name is required: gh-axi label edit <name>', 'VALIDATION_ERROR');

  const ghArgs = ['label', 'edit', labelName];
  const newName = getFlag(args, '--name');
  if (newName) ghArgs.push('--name', newName);
  const color = getFlag(args, '--color');
  if (color) ghArgs.push('--color', color);
  const description = getFlag(args, '--description');
  if (description) ghArgs.push('--description', description);

  await ghExec(ghArgs, ctx);
  const suggestions = getSuggestions({ domain: 'label', action: 'edit', repo: ctx });
  return renderOutput([
    encode({ edit: 'ok', label: newName ?? labelName }),
    renderHelp(suggestions),
  ]);
}

async function deleteLabel(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const name = positionals[1];
  if (!name) throw new AxiError('Label name is required: gh-axi label delete <name>', 'VALIDATION_ERROR');

  await ghExec(['label', 'delete', name, '--yes'], ctx);
  const suggestions = getSuggestions({ domain: 'label', action: 'delete', repo: ctx });
  return renderOutput([
    encode({ delete: 'ok', label: name }),
    renderHelp(suggestions),
  ]);
}

export async function labelCommand(args: string[], ctx?: RepoContext): Promise<string> {
  const sub = args[0];

  if (sub === '--help' || sub === undefined) return LABEL_HELP;

  switch (sub) {
    case 'list':
      return listLabels(args, ctx);
    case 'create':
      return createLabel(args, ctx);
    case 'edit':
      return editLabel(args, ctx);
    case 'delete':
      return deleteLabel(args, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, 'VALIDATION_ERROR', [
        'Available subcommands: list, create, edit, delete',
      ]);
  }
}
