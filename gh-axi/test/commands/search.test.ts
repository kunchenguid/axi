import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/gh.js', () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghJson } from '../../src/gh.js';
import { searchCommand, SEARCH_HELP } from '../../src/commands/search.js';
import { AxiError } from '../../src/errors.js';
import type { RepoContext } from '../../src/context.js';

const mockedGhJson = vi.mocked(ghJson);

const ctx: RepoContext = { owner: 'octo', name: 'repo', nwo: 'octo/repo', source: 'flag' };

describe('searchCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('router', () => {
    it('returns help when --help is passed', async () => {
      const result = await searchCommand(['--help']);
      expect(result).toBe(SEARCH_HELP);
    });

    it('returns help when no subcommand is given', async () => {
      const result = await searchCommand([]);
      expect(result).toBe(SEARCH_HELP);
    });

    it('returns error for unknown type', async () => {
      const result = await searchCommand(['unknown', 'query']);
      expect(result).toContain('Unknown search type: unknown');
    });
  });

  describe('searchIssues', () => {
    it('requires query', async () => {
      await expect(
        searchCommand(['issues']),
      ).rejects.toThrow(AxiError);
    });

    it('returns results with count', async () => {
      mockedGhJson.mockResolvedValue([
        { number: 1, title: 'Bug', repository: { nameWithOwner: 'octo/repo' }, state: 'OPEN', author: { login: 'alice' }, labels: [], createdAt: '2024-01-01T00:00:00Z' },
        { number: 2, title: 'Feature', repository: { nameWithOwner: 'octo/repo' }, state: 'CLOSED', author: { login: 'bob' }, labels: [], createdAt: '2024-01-02T00:00:00Z' },
      ]);

      const result = await searchCommand(['issues', 'test query'], ctx);

      expect(result).toContain('count: 2');
      expect(result).toContain('Bug');
      expect(result).toContain('Feature');
    });
  });

  describe('searchRepos', () => {
    it('returns results', async () => {
      mockedGhJson.mockResolvedValue([
        { fullName: 'octo/repo', description: 'A test repo', stargazersCount: 100, forksCount: 10, language: 'TypeScript', updatedAt: '2024-01-01T00:00:00Z' },
      ]);

      const result = await searchCommand(['repos', 'typescript'], ctx);

      expect(result).toContain('octo/repo');
      expect(result).toContain('A test repo');
    });
  });
});
