import { encode } from '@toon-format/toon';
import type { RepoContext } from '../context.js';
import { ghJson, ghExec } from '../gh.js';
import { AxiError } from '../errors.js';
import { getFlag, hasFlag } from '../args.js';
import { truncateBody } from '../body.js';
import {
  field,
  boolYesNo,
  relativeTime,
  pluck,
  custom,
  renderList,
  renderDetail,
  renderHelp,
  renderOutput,
  renderError,
  type FieldDef,
} from '../toon.js';
import { getSuggestions } from '../suggestions.js';

export const RELEASE_HELP = `usage: gh-axi release <subcommand> [flags]
subcommands[7]:
  list, view <tag>, create <tag>, edit <tag>, delete <tag>, download <tag>, upload <tag>
flags{list}:
  --exclude-drafts, --exclude-pre-releases, --limit (default 10)
flags{view}:
  --full (show complete release notes without truncation)
flags{create}:
  --title, --notes, --notes-file, --draft, --prerelease, --target, --generate-notes
flags{edit}:
  --title, --notes, --draft, --prerelease
flags{download}:
  --pattern, --dir`;

const listSchema: FieldDef[] = [
  field('tagName', 'tag'),
  field('name'),
  boolYesNo('isDraft', 'draft'),
  boolYesNo('isPrerelease', 'prerelease'),
  relativeTime('publishedAt', 'published'),
];

const viewSchema: FieldDef[] = [
  field('tagName', 'tag'),
  field('name'),
  relativeTime('publishedAt', 'published'),
  pluck('author', 'login', 'author'),
  custom('body', (item) => truncateBody(item.body, 1000)),
];

const viewSchemaFull: FieldDef[] = [
  field('tagName', 'tag'),
  field('name'),
  relativeTime('publishedAt', 'published'),
  pluck('author', 'login', 'author'),
  custom('body', (item) => typeof item.body === 'string' ? item.body : ''),
];



async function listReleases(args: string[], ctx?: RepoContext): Promise<string> {
  const limit = getFlag(args, '--limit') ?? '10';
  const ghArgs = [
    'release', 'list',
    '--json', 'tagName,name,isDraft,isPrerelease,publishedAt',
    '--limit', limit,
  ];
  if (hasFlag(args, '--exclude-drafts')) ghArgs.push('--exclude-drafts');
  if (hasFlag(args, '--exclude-pre-releases')) ghArgs.push('--exclude-pre-releases');

  const releases = await ghJson<Record<string, unknown>[]>(ghArgs, ctx);
  const isEmpty = releases.length === 0;
  const limitNum = Number(limit);
  const countLine = releases.length === limitNum
    ? `count: ${releases.length} (showing first ${releases.length}; run \`gh-axi repo view\` for total count)`
    : `count: ${releases.length}`;
  const suggestions = getSuggestions({ domain: 'release', action: 'list', isEmpty, repo: ctx });
  return renderOutput([
    countLine,
    renderList('releases', releases, listSchema),
    renderHelp(suggestions),
  ]);
}

async function viewRelease(args: string[], ctx?: RepoContext): Promise<string> {
  const full = hasFlag(args, '--full');
  const positionals = args.filter((a) => !a.startsWith('--'));
  const tag = positionals[1];
  if (!tag) throw new AxiError('Tag is required: gh-axi release view <tag>', 'VALIDATION_ERROR');

  const release = await ghJson<Record<string, unknown>>(
    ['release', 'view', tag, '--json', 'tagName,name,publishedAt,author,body'],
    ctx,
  );

  const suggestions = getSuggestions({ domain: 'release', action: 'view', id: tag, repo: ctx });
  const blocks: string[] = [renderDetail('release', release, full ? viewSchemaFull : viewSchema)];

  blocks.push(renderHelp(suggestions));
  return renderOutput(blocks);
}

async function createRelease(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const tag = positionals[1];
  if (!tag) throw new AxiError('Tag is required: gh-axi release create <tag>', 'VALIDATION_ERROR');

  const ghArgs = ['release', 'create', tag];
  const title = getFlag(args, '--title');
  if (title) ghArgs.push('--title', title);
  const notes = getFlag(args, '--notes');
  if (notes) ghArgs.push('--notes', notes);
  const notesFile = getFlag(args, '--notes-file');
  if (notesFile) ghArgs.push('--notes-file', notesFile);
  if (hasFlag(args, '--draft')) ghArgs.push('--draft');
  if (hasFlag(args, '--prerelease')) ghArgs.push('--prerelease');
  const target = getFlag(args, '--target');
  if (target) ghArgs.push('--target', target);
  if (hasFlag(args, '--generate-notes')) ghArgs.push('--generate-notes');

  // Positional files (after tag, excluding flags and their values)
  const files: string[] = [];
  for (let i = 2; i < positionals.length; i++) {
    files.push(positionals[i]);
  }
  ghArgs.push(...files);

  await ghExec(ghArgs, ctx);
  const suggestions = getSuggestions({ domain: 'release', action: 'create', id: tag, repo: ctx });
  return renderOutput([
    encode({ created: 'ok', tag }),
    renderHelp(suggestions),
  ]);
}

async function editRelease(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const tag = positionals[1];
  if (!tag) throw new AxiError('Tag is required: gh-axi release edit <tag>', 'VALIDATION_ERROR');

  const ghArgs = ['release', 'edit', tag];
  const title = getFlag(args, '--title');
  if (title) ghArgs.push('--title', title);
  const notes = getFlag(args, '--notes');
  if (notes) ghArgs.push('--notes', notes);
  if (hasFlag(args, '--draft')) ghArgs.push('--draft');
  if (hasFlag(args, '--prerelease')) ghArgs.push('--prerelease');

  await ghExec(ghArgs, ctx);
  const suggestions = getSuggestions({ domain: 'release', action: 'edit', id: tag, repo: ctx });
  return renderOutput([
    encode({ edit: 'ok', tag }),
    renderHelp(suggestions),
  ]);
}

async function deleteRelease(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const tag = positionals[1];
  if (!tag) throw new AxiError('Tag is required: gh-axi release delete <tag>', 'VALIDATION_ERROR');

  await ghExec(['release', 'delete', tag, '--yes'], ctx);
  const suggestions = getSuggestions({ domain: 'release', action: 'delete', id: tag, repo: ctx });
  return renderOutput([
    encode({ delete: 'ok', tag }),
    renderHelp(suggestions),
  ]);
}

async function downloadRelease(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const tag = positionals[1];
  if (!tag) throw new AxiError('Tag is required: gh-axi release download <tag>', 'VALIDATION_ERROR');

  const ghArgs = ['release', 'download', tag];
  const pattern = getFlag(args, '--pattern');
  if (pattern) ghArgs.push('--pattern', pattern);
  const dir = getFlag(args, '--dir');
  if (dir) ghArgs.push('--dir', dir);

  await ghExec(ghArgs, ctx);
  const suggestions = getSuggestions({ domain: 'release', action: 'download', id: tag, repo: ctx });
  return renderOutput([
    encode({ download: 'ok', tag }),
    renderHelp(suggestions),
  ]);
}

async function uploadRelease(args: string[], ctx?: RepoContext): Promise<string> {
  const positionals = args.filter((a) => !a.startsWith('--'));
  const tag = positionals[1];
  if (!tag) throw new AxiError('Tag is required: gh-axi release upload <tag> <files...>', 'VALIDATION_ERROR');

  const files = positionals.slice(2);
  if (files.length === 0) throw new AxiError('At least one file is required: gh-axi release upload <tag> <files...>', 'VALIDATION_ERROR');

  await ghExec(['release', 'upload', tag, ...files], ctx);
  const suggestions = getSuggestions({ domain: 'release', action: 'upload', id: tag, repo: ctx });
  return renderOutput([
    encode({ upload: 'ok', tag, files: files.length }),
    renderHelp(suggestions),
  ]);
}

export async function releaseCommand(args: string[], ctx?: RepoContext): Promise<string> {
  const sub = args[0];

  if (sub === '--help' || sub === undefined) return RELEASE_HELP;

  switch (sub) {
    case 'list':
      return listReleases(args, ctx);
    case 'view':
      return viewRelease(args, ctx);
    case 'create':
      return createRelease(args, ctx);
    case 'edit':
      return editRelease(args, ctx);
    case 'delete':
      return deleteRelease(args, ctx);
    case 'download':
      return downloadRelease(args, ctx);
    case 'upload':
      return uploadRelease(args, ctx);
    default:
      return renderError(`Unknown subcommand: ${sub}`, 'VALIDATION_ERROR', [
        'Available subcommands: list, view, create, edit, delete, download, upload',
      ]);
  }
}
