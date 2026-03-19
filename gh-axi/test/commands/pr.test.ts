import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/gh.js', () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghJson, ghExec, ghRaw } from '../../src/gh.js';
import { prCommand, PR_HELP } from '../../src/commands/pr.js';
import type { RepoContext } from '../../src/context.js';

const mockedGhJson = vi.mocked(ghJson);
const mockedGhExec = vi.mocked(ghExec);
const mockedGhRaw = vi.mocked(ghRaw);

const ctx: RepoContext = { owner: 'octo', name: 'repo', nwo: 'octo/repo', source: 'flag' };

describe('prCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('router', () => {
    it('returns help when --help is passed', async () => {
      const result = await prCommand(['--help']);
      expect(result).toBe(PR_HELP);
    });

    it('returns help when no subcommand is given', async () => {
      const result = await prCommand([]);
      expect(result).toBe(PR_HELP);
    });

    it('returns error for unknown subcommand', async () => {
      const result = await prCommand(['unknown']);
      expect(result).toContain('Unknown pr subcommand: unknown');
    });
  });

  describe('list', () => {
    it('returns list with count line', async () => {
      mockedGhJson.mockResolvedValue([
        { number: 1, title: 'Fix bug', state: 'OPEN', author: { login: 'alice' }, isDraft: false, reviewDecision: 'APPROVED' },
        { number: 2, title: 'Add feature', state: 'OPEN', author: { login: 'bob' }, isDraft: true, reviewDecision: '' },
      ]);

      const result = await prCommand(['list'], ctx);

      expect(result).toContain('count: 2');
      expect(result).toContain('Fix bug');
      expect(result).toContain('Add feature');
      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(['pr', 'list', '--json']),
        ctx,
      );
    });
  });

  describe('view', () => {
    it('returns detail with schema fields', async () => {
      mockedGhJson.mockResolvedValue({
        number: 42,
        title: 'My PR',
        state: 'OPEN',
        author: { login: 'alice' },
        isDraft: false,
        mergedAt: null,
        statusCheckRollup: [],
        body: 'PR description here',
        comments: [],
      });

      const result = await prCommand(['view', '42'], ctx);

      expect(result).toContain('42');
      expect(result).toContain('My PR');
      expect(result).toContain('open');
      expect(result).toContain('alice');
    });
  });

  describe('close', () => {
    it('returns already closed when PR is already closed (idempotent)', async () => {
      mockedGhJson.mockResolvedValue({ state: 'CLOSED' });

      const result = await prCommand(['close', '10'], ctx);

      expect(result).toContain('closed');
      expect(result).toContain('already');
      expect(mockedGhExec).not.toHaveBeenCalled();
    });
  });

  describe('merge', () => {
    it('returns already merged when PR is already merged (idempotent)', async () => {
      mockedGhJson.mockResolvedValue({
        state: 'MERGED',
        mergedBy: { login: 'alice' },
        mergedAt: '2024-01-01T00:00:00Z',
      });

      const result = await prCommand(['merge', '10'], ctx);

      expect(result).toContain('merged');
      expect(result).toContain('alice');
      expect(mockedGhExec).not.toHaveBeenCalled();
    });
  });

  describe('checks', () => {
    it('returns message when no checks configured', async () => {
      mockedGhJson.mockResolvedValue({ statusCheckRollup: [] });

      const result = await prCommand(['checks', '5'], ctx);

      expect(result).toContain('no CI checks configured');
    });

    it('returns check summary with checks', async () => {
      mockedGhJson.mockResolvedValue({
        statusCheckRollup: [
          { name: 'build', conclusion: 'SUCCESS' },
          { name: 'lint', conclusion: 'FAILURE' },
          { name: 'test', conclusion: 'SKIPPED' },
        ],
      });

      const result = await prCommand(['checks', '5'], ctx);

      expect(result).toContain('1 passed');
      expect(result).toContain('1 failed');
      expect(result).toContain('1 skipped');
      expect(result).toContain('3 total');
    });
  });

  describe('diff', () => {
    it('returns raw diff', async () => {
      mockedGhExec.mockResolvedValue('diff --git a/file.ts b/file.ts\n+added line\n');

      const result = await prCommand(['diff', '7'], ctx);

      expect(result).toContain('diff --git');
      expect(result).toContain('+added line');
    });
  });
});
