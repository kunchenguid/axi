import { execFileSync } from 'node:child_process';

export interface RepoContext {
  owner: string;
  name: string;
  /** Full "OWNER/NAME" string */
  nwo: string;
  /** How the repo was resolved — determines whether to append --repo to gh calls */
  source: 'flag' | 'env' | 'git';
}

/**
 * Resolve the target repository.
 * Priority: --repo flag > GH_REPO env > git remote origin.
 */
export function resolveRepo(flagValue?: string): RepoContext | undefined {
  if (flagValue) {
    return parseNwo(flagValue, 'flag');
  }

  const envRepo = process.env['GH_REPO'];
  if (envRepo) {
    return parseNwo(envRepo, 'env');
  }

  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return parseRemoteUrl(url);
  } catch {
    return undefined;
  }
}

function parseNwo(nwo: string, source: 'flag' | 'env'): RepoContext | undefined {
  const parts = nwo.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
  return { owner: parts[0], name: parts[1], nwo, source };
}

function parseRemoteUrl(url: string): RepoContext | undefined {
  // SSH: git@github.com:OWNER/NAME.git
  const sshMatch = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    const owner = sshMatch[1];
    const name = sshMatch[2];
    return { owner, name, nwo: `${owner}/${name}`, source: 'git' };
  }
  // HTTPS: https://github.com/OWNER/NAME.git
  const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) {
    const owner = httpsMatch[1];
    const name = httpsMatch[2];
    return { owner, name, nwo: `${owner}/${name}`, source: 'git' };
  }
  return undefined;
}
