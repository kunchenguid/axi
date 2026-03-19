import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/gh.js', () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghJson, ghExec } from '../../src/gh.js';
import { runCommand, RUN_HELP } from '../../src/commands/run.js';
import type { RepoContext } from '../../src/context.js';

const mockedGhJson = vi.mocked(ghJson);
const mockedGhExec = vi.mocked(ghExec);

const ctx: RepoContext = { owner: 'octo', name: 'repo', nwo: 'octo/repo', source: 'flag' };

describe('runCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('router', () => {
    it('returns help when --help is passed', async () => {
      const result = await runCommand(['--help']);
      expect(result).toBe(RUN_HELP);
    });

    it('returns help when no subcommand is given', async () => {
      const result = await runCommand([]);
      expect(result).toBe(RUN_HELP);
    });

    it('returns error for unknown subcommand', async () => {
      const result = await runCommand(['unknown']);
      expect(result).toContain('Unknown subcommand: unknown');
    });
  });

  describe('list', () => {
    it('returns runs list', async () => {
      mockedGhJson.mockResolvedValue([
        { databaseId: 100, displayTitle: 'CI Build', status: 'completed', conclusion: 'success', workflowName: 'CI', headBranch: 'main', event: 'push', createdAt: '2024-01-01T00:00:00Z' },
        { databaseId: 101, displayTitle: 'Tests', status: 'in_progress', conclusion: null, workflowName: 'Test', headBranch: 'dev', event: 'pull_request', createdAt: '2024-01-02T00:00:00Z' },
      ]);

      const result = await runCommand(['list'], ctx);

      expect(result).toContain('count: 2');
      expect(result).toContain('CI Build');
      expect(result).toContain('Tests');
    });
  });

  describe('view', () => {
    it('returns run detail with jobs', async () => {
      mockedGhJson.mockResolvedValue({
        databaseId: 100,
        displayTitle: 'CI Build',
        status: 'completed',
        conclusion: 'success',
        workflowName: 'CI',
        headBranch: 'main',
        createdAt: '2024-01-01T00:00:00Z',
        jobs: [
          { name: 'build', status: 'completed', conclusion: 'success' },
          { name: 'test', status: 'completed', conclusion: 'failure' },
        ],
      });

      const result = await runCommand(['view', '100'], ctx);

      expect(result).toContain('CI Build');
      expect(result).toContain('build');
      expect(result).toContain('test');
    });
  });

  describe('cancel', () => {
    it('returns already_completed when run is already completed (idempotent)', async () => {
      mockedGhJson.mockResolvedValue({ status: 'completed', conclusion: 'success' });

      const result = await runCommand(['cancel', '100'], ctx);

      expect(result).toContain('already_completed');
      expect(mockedGhExec).not.toHaveBeenCalled();
    });
  });
});
