import { encode } from '@toon-format/toon';
import type { RepoContext } from '../context.js';
import { ghExec } from '../gh.js';
import { AxiError } from '../errors.js';
import { hasFlag, getAllFlags } from '../args.js';
import { cleanBody } from '../body.js';

export const API_HELP = `usage: gh-axi api [<method>] <path>
description: Make an authenticated GitHub API request. Defaults to GET if no method specified.
methods[6]:
  GET, POST, PUT, PATCH, DELETE, HEAD
flags[3]:
  --field <key=value> (repeatable), --header <key:value> (repeatable), --paginate`;

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);

/** Maximum length for raw (non-JSON) API output before truncation. */
const RAW_OUTPUT_TRUNCATION_LIMIT = 4000;

/** Strings longer than this threshold are cleaned up (image/URL stripping). */
const LONG_STRING_CLEANUP_THRESHOLD = 200;

/** Maximum length for cleaned string values before truncation. */
const STRING_VALUE_TRUNCATION_LIMIT = 2000;


export async function apiCommand(args: string[], ctx?: RepoContext): Promise<string> {
  if (args[0] === '--help' || args.length === 0) return API_HELP;

  // Parse method and path from positional args
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      i++; // skip flag value
    } else {
      positionals.push(args[i]);
    }
  }

  let method: string;
  let path: string;

  if (positionals.length >= 2 && HTTP_METHODS.has(positionals[0].toUpperCase())) {
    method = positionals[0].toUpperCase();
    path = positionals[1];
  } else if (positionals.length >= 1) {
    method = 'GET';
    path = positionals[0];
  } else {
    throw new AxiError('API path is required: gh-axi api [<method>] <path>', 'VALIDATION_ERROR');
  }

  const ghArgs = ['api', path, '--method', method];

  const fields = getAllFlags(args, '--field');
  for (const f of fields) {
    ghArgs.push('--field', f);
  }

  const headers = getAllFlags(args, '--header');
  for (const h of headers) {
    ghArgs.push('--header', h);
  }

  if (hasFlag(args, '--paginate')) ghArgs.push('--paginate');

  // Try to parse as JSON, strip noisy fields, encode to TOON; fall back to raw output
  const raw = await ghExec(ghArgs, ctx);
  try {
    const data = JSON.parse(raw);
    const cleaned = stripNoisyFields(data);
    return encode(cleaned);
  } catch {
    // Not JSON — return raw output (truncated if too long)
    const trimmed = raw.trim();
    if (trimmed.length > RAW_OUTPUT_TRUNCATION_LIMIT) {
      return trimmed.slice(0, RAW_OUTPUT_TRUNCATION_LIMIT) + '\n... (truncated)';
    }
    return trimmed;
  }
}

/** Fields from raw GitHub API responses that are noisy/useless for agents */
const NOISY_KEYS = new Set([
  'avatar_url', 'gravatar_id', 'followers_url', 'following_url',
  'gists_url', 'starred_url', 'subscriptions_url', 'organizations_url',
  'repos_url', 'events_url', 'received_events_url', 'labels_url',
  'comments_url', 'events_url', 'timeline_url', 'performed_via_github_app',
  'node_id', 'url', 'repository_url', 'html_url',
  'reactions', 'user_view_type', 'site_admin',
  'issue_dependencies_summary', 'sub_issues_summary', 'pinned_comment',
  'score', 'permissions', 'verification', '_links',
]);

/** Keys ending in _url that are template URLs agents never use */
function isTemplateUrlKey(key: string): boolean {
  if (!key.endsWith('_url')) return false;
  // Keep a few meaningful URL keys
  const KEEP_URL_KEYS = new Set([
    'diff_url', 'patch_url', 'clone_url', 'ssh_url', 'git_url', 'svn_url',
    'commit_url', // useful for linking to specific commits
  ]);
  return !KEEP_URL_KEYS.has(key);
}

/** Collapse repo/repository objects to essential fields only */
function collapseRepo(obj: Record<string, unknown>): Record<string, unknown> {
  if ('full_name' in obj) {
    const collapsed: Record<string, unknown> = { full_name: obj.full_name };
    if (obj.default_branch) collapsed.default_branch = obj.default_branch;
    if (obj.private) collapsed.private = obj.private;
    return collapsed;
  }
  return obj;
}

function stripNoisyFields(obj: unknown, depth = 0): unknown {
  if (depth > 8) return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => stripNoisyFields(item, depth + 1));
  }
  if (obj !== null && typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (NOISY_KEYS.has(key)) continue;
      if (isTemplateUrlKey(key)) continue;
      // Strip nested user objects down to just login
      if (key === 'user' && value && typeof value === 'object' && 'login' in (value as Record<string, unknown>)) {
        result[key] = (value as Record<string, unknown>).login;
        continue;
      }
      // Collapse repo/repository objects to essential fields
      if ((key === 'repo' || key === 'repository') && value && typeof value === 'object') {
        result[key] = collapseRepo(value as Record<string, unknown>);
        continue;
      }
      result[key] = stripNoisyFields(value, depth + 1);
    }
    return result;
  }
  // Clean and truncate long string values (e.g. bodies, comments)
  if (typeof obj === 'string' && obj.length > LONG_STRING_CLEANUP_THRESHOLD) {
    const s = cleanBody(obj);
    if (s.length > STRING_VALUE_TRUNCATION_LIMIT) {
      return s.slice(0, STRING_VALUE_TRUNCATION_LIMIT) + '... (truncated)';
    }
    return s;
  }
  return obj;
}
