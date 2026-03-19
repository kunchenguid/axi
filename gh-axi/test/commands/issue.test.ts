import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/gh.js', () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghJson, ghExec } from '../../src/gh.js';
import { issueCommand, ISSUE_HELP } from '../../src/commands/issue.js';
import { AxiError } from '../../src/errors.js';
import type { RepoContext } from '../../src/context.js';

const mockedGhJson = vi.mocked(ghJson);
const mockedGhExec = vi.mocked(ghExec);

const ctx: RepoContext = { owner: 'octo', name: 'repo', nwo: 'octo/repo', source: 'flag' };

describe('issueCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('router', () => {
    it('returns help when --help is passed', async () => {
      const result = await issueCommand(['--help'], ctx);
      expect(result).toContain(ISSUE_HELP);
    });

    it('returns help when no subcommand is given', async () => {
      const result = await issueCommand([], ctx);
      expect(result).toContain(ISSUE_HELP);
    });

    it('returns error for unknown subcommand (not throw)', async () => {
      const result = await issueCommand(['unknown'], ctx);
      expect(result).toContain('Unknown issue subcommand: unknown');
    });
  });

  describe('list', () => {
    it('returns list with count', async () => {
      mockedGhJson.mockResolvedValue([
        { number: 1, title: 'Bug report', state: 'OPEN', author: { login: 'alice' }, createdAt: '2024-01-01T00:00:00Z' },
        { number: 2, title: 'Feature request', state: 'OPEN', author: { login: 'bob' }, createdAt: '2024-01-02T00:00:00Z' },
      ]);

      const result = await issueCommand(['list'], ctx);

      expect(result).toContain('count: 2');
      expect(result).toContain('Bug report');
      expect(result).toContain('Feature request');
    });
  });

  describe('view', () => {
    it('returns detail', async () => {
      mockedGhJson.mockResolvedValue({
        number: 42,
        title: 'Critical bug',
        state: 'OPEN',
        author: { login: 'alice' },
        createdAt: '2024-01-01T00:00:00Z',
        body: 'Some issue body',
      });

      const result = await issueCommand(['view', '42'], ctx);

      expect(result).toContain('42');
      expect(result).toContain('Critical bug');
      expect(result).toContain('open');
      expect(result).toContain('alice');
    });
  });

  describe('create', () => {
    it('requires --title', async () => {
      await expect(
        issueCommand(['create'], ctx),
      ).rejects.toThrow(AxiError);
    });

    it('returns created issue', async () => {
      mockedGhExec.mockResolvedValue('https://github.com/octo/repo/issues/99\n');
      mockedGhJson.mockResolvedValue({
        number: 99,
        title: 'New issue',
        state: 'OPEN',
        url: 'https://github.com/octo/repo/issues/99',
      });

      const result = await issueCommand(['create', '--title', 'New issue'], ctx);

      expect(result).toContain('99');
      expect(result).toContain('New issue');
      expect(mockedGhExec).toHaveBeenCalledWith(
        expect.arrayContaining(['issue', 'create', '--title', 'New issue']),
        ctx,
      );
    });
  });

  describe('close', () => {
    it('returns already closed when issue is already closed (idempotent)', async () => {
      // First call: check current state
      mockedGhJson.mockResolvedValueOnce({ state: 'closed' });
      // Second call: fetch for display
      mockedGhJson.mockResolvedValueOnce({ number: 10, state: 'closed' });

      const result = await issueCommand(['close', '10'], ctx);

      expect(result).toContain('closed');
      expect(result).toContain('Already closed');
      expect(mockedGhExec).not.toHaveBeenCalled();
    });
  });

  describe('lock', () => {
    it('returns already locked when issue is already locked (idempotent)', async () => {
      mockedGhJson.mockResolvedValue({ locked: true, state: 'OPEN' });

      const result = await issueCommand(['lock', '10'], ctx);

      expect(result).toContain('Already locked');
      expect(mockedGhExec).not.toHaveBeenCalled();
    });
  });
});
