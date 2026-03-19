import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolveRepo } from '../src/context.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

describe('resolveRepo', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env['GH_REPO'];
    mockedExecFileSync.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns undefined when no repo is available', () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('not a git repo');
    });
    expect(resolveRepo()).toBeUndefined();
  });

  it('parses flag value correctly', () => {
    const result = resolveRepo('cli/cli');
    expect(result).toEqual({
      owner: 'cli',
      name: 'cli',
      nwo: 'cli/cli',
      source: 'flag',
    });
    // Should not call git when flag is provided
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it('returns undefined for invalid flag value', () => {
    expect(resolveRepo('invalid')).toBeUndefined();
    expect(resolveRepo('a/b/c')).toBeUndefined();
    expect(resolveRepo('/name')).toBeUndefined();
    expect(resolveRepo('owner/')).toBeUndefined();
  });

  it('uses GH_REPO env var', () => {
    process.env['GH_REPO'] = 'octocat/hello-world';
    const result = resolveRepo();
    expect(result).toEqual({
      owner: 'octocat',
      name: 'hello-world',
      nwo: 'octocat/hello-world',
      source: 'env',
    });
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it('parses SSH git remote URLs', () => {
    mockedExecFileSync.mockReturnValue('git@github.com:cli/cli.git\n');
    const result = resolveRepo();
    expect(result).toEqual({
      owner: 'cli',
      name: 'cli',
      nwo: 'cli/cli',
      source: 'git',
    });
  });

  it('parses SSH git remote URLs without .git suffix', () => {
    mockedExecFileSync.mockReturnValue('git@github.com:owner/repo\n');
    const result = resolveRepo();
    expect(result).toEqual({
      owner: 'owner',
      name: 'repo',
      nwo: 'owner/repo',
      source: 'git',
    });
  });

  it('parses HTTPS git remote URLs', () => {
    mockedExecFileSync.mockReturnValue('https://github.com/cli/cli.git\n');
    const result = resolveRepo();
    expect(result).toEqual({
      owner: 'cli',
      name: 'cli',
      nwo: 'cli/cli',
      source: 'git',
    });
  });

  it('parses HTTPS git remote URLs without .git suffix', () => {
    mockedExecFileSync.mockReturnValue('https://github.com/owner/repo\n');
    const result = resolveRepo();
    expect(result).toEqual({
      owner: 'owner',
      name: 'repo',
      nwo: 'owner/repo',
      source: 'git',
    });
  });

  it('prioritizes flag over env and git', () => {
    process.env['GH_REPO'] = 'env-owner/env-repo';
    mockedExecFileSync.mockReturnValue('git@github.com:git-owner/git-repo.git\n');
    const result = resolveRepo('flag-owner/flag-repo');
    expect(result!.source).toBe('flag');
    expect(result!.nwo).toBe('flag-owner/flag-repo');
  });

  it('prioritizes env over git', () => {
    process.env['GH_REPO'] = 'env-owner/env-repo';
    mockedExecFileSync.mockReturnValue('git@github.com:git-owner/git-repo.git\n');
    const result = resolveRepo();
    expect(result!.source).toBe('env');
    expect(result!.nwo).toBe('env-owner/env-repo');
  });
});
