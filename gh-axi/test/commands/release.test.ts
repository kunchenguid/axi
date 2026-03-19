import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/gh.js', () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghJson } from '../../src/gh.js';
import { releaseCommand, RELEASE_HELP } from '../../src/commands/release.js';
import { AxiError } from '../../src/errors.js';
import type { RepoContext } from '../../src/context.js';

const mockedGhJson = vi.mocked(ghJson);

const ctx: RepoContext = { owner: 'octo', name: 'repo', nwo: 'octo/repo', source: 'flag' };

describe('releaseCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('router', () => {
    it('returns help when --help is passed', async () => {
      const result = await releaseCommand(['--help']);
      expect(result).toBe(RELEASE_HELP);
    });

    it('returns help when no subcommand is given', async () => {
      const result = await releaseCommand([]);
      expect(result).toBe(RELEASE_HELP);
    });

    it('returns error for unknown subcommand', async () => {
      const result = await releaseCommand(['unknown']);
      expect(result).toContain('Unknown subcommand: unknown');
    });
  });

  describe('list', () => {
    it('returns release list', async () => {
      mockedGhJson.mockResolvedValue([
        { tagName: 'v1.0.0', name: 'Release 1.0', isDraft: false, isPrerelease: false, publishedAt: '2024-01-01T00:00:00Z' },
        { tagName: 'v0.9.0', name: 'Beta', isDraft: false, isPrerelease: true, publishedAt: '2023-12-01T00:00:00Z' },
      ]);

      const result = await releaseCommand(['list'], ctx);

      expect(result).toContain('count: 2');
      expect(result).toContain('v1.0.0');
      expect(result).toContain('v0.9.0');
    });
  });

  describe('view', () => {
    it('requires tag', async () => {
      await expect(
        releaseCommand(['view'], ctx),
      ).rejects.toThrow(AxiError);
    });

    it('returns release detail when tag is provided', async () => {
      mockedGhJson.mockResolvedValue({
        tagName: 'v1.0.0',
        name: 'Release 1.0',
        publishedAt: '2024-01-01T00:00:00Z',
        author: { login: 'alice' },
        body: 'Release notes here',
      });

      const result = await releaseCommand(['view', 'v1.0.0'], ctx);

      expect(result).toContain('v1.0.0');
      expect(result).toContain('Release 1.0');
      expect(result).toContain('alice');
    });
  });
});
