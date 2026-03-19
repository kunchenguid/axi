import type { RepoContext } from '../context.js';
import { ghJson } from '../gh.js';
import {
  field,
  lower,
  pluck,
  mapEnum,
  renderList,
  renderHelp,
  renderOutput,
  type FieldDef,
} from '../toon.js';
import { getSuggestions } from '../suggestions.js';
import { encode } from '@toon-format/toon';

export const HOME_HELP = '';

const issueSchema: FieldDef[] = [
  field('number'),
  field('title'),
  lower('state'),
  pluck('author', 'login', 'author'),
];

const prSchema: FieldDef[] = [
  field('number'),
  field('title'),
  pluck('author', 'login', 'author'),
  mapEnum('reviewDecision', { APPROVED: 'approved', CHANGES_REQUESTED: 'changes_requested', REVIEW_REQUIRED: 'required' }, 'none', 'review'),
];

const runSchema: FieldDef[] = [
  field('databaseId', 'id'),
  field('displayTitle', 'title'),
  lower('status'),
  field('workflowName', 'workflow'),
];

export async function homeCommand(_args: string[], ctx?: RepoContext): Promise<string> {
  // Run 3 queries in parallel
  const [issues, prs, runs] = await Promise.all([
    ghJson<Record<string, unknown>[]>(
      ['issue', 'list', '--json', 'number,title,state,author', '--limit', '2'],
      ctx,
    ).catch(() => [] as Record<string, unknown>[]),
    ghJson<Record<string, unknown>[]>(
      ['pr', 'list', '--json', 'number,title,author,reviewDecision', '--limit', '1'],
      ctx,
    ).catch(() => [] as Record<string, unknown>[]),
    ghJson<Record<string, unknown>[]>(
      ['run', 'list', '--json', 'databaseId,displayTitle,status,workflowName', '--limit', '1'],
      ctx,
    ).catch(() => [] as Record<string, unknown>[]),
  ]);

  const blocks: string[] = [];

  if (ctx) {
    blocks.push(encode({ repo: ctx.nwo }));
  }

  blocks.push(renderList('issues', issues, issueSchema));
  blocks.push(renderList('prs', prs, prSchema));
  blocks.push(renderList('runs', runs, runSchema));

  const suggestions = getSuggestions({ domain: 'home', action: 'home', repo: ctx });
  blocks.push(renderHelp(suggestions));

  return renderOutput(blocks);
}
