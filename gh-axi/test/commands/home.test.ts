import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/gh.js', () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghJson } from '../../src/gh.js';
import { homeCommand } from '../../src/commands/home.js';
import type { RepoContext } from '../../src/context.js';

const mockedGhJson = vi.mocked(ghJson);

describe('homeCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns output with issues, prs, and runs sections', async () => {
    mockedGhJson.mockImplementation(async (args: string[]) => {
      if (args[0] === 'issue') {
        return [
          { number: 1, title: 'Bug report', state: 'OPEN', author: { login: 'alice' } },
          { number: 2, title: 'Feature request', state: 'OPEN', author: { login: 'bob' } },
        ];
      }
      if (args[0] === 'pr') {
        return [
          { number: 10, title: 'Add feature', author: { login: 'charlie' }, reviewDecision: 'APPROVED' },
        ];
      }
      if (args[0] === 'run') {
        return [
          { databaseId: 100, displayTitle: 'CI', status: 'COMPLETED', workflowName: 'build' },
        ];
      }
      return [];
    });

    const result = await homeCommand([], { owner: 'octo', name: 'repo', nwo: 'octo/repo', source: 'flag' });

    expect(result).toContain('issues');
    expect(result).toContain('Bug report');
    expect(result).toContain('prs');
    expect(result).toContain('Add feature');
    expect(result).toContain('runs');
    expect(result).toContain('CI');
    expect(mockedGhJson).toHaveBeenCalledTimes(3);
  });

  it('includes repo context when provided', async () => {
    mockedGhJson.mockResolvedValue([]);

    const ctx: RepoContext = { owner: 'octo', name: 'repo', nwo: 'octo/repo', source: 'flag' };
    const result = await homeCommand([], ctx);

    expect(result).toContain('octo/repo');
  });

  it('handles ghJson failures gracefully', async () => {
    mockedGhJson.mockRejectedValue(new Error('network error'));

    const result = await homeCommand([]);

    // Should return output with empty sections, not throw
    expect(result).toContain('issues');
    expect(result).toContain('prs');
    expect(result).toContain('runs');
  });

  it('works without repo context', async () => {
    mockedGhJson.mockResolvedValue([]);

    const result = await homeCommand([]);

    expect(result).toContain('issues');
    expect(result).not.toContain('repo:');
  });
});
