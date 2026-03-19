import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/gh.js', () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghJson, ghExec } from '../../src/gh.js';
import { labelCommand, LABEL_HELP } from '../../src/commands/label.js';
import { AxiError } from '../../src/errors.js';

const mockedGhJson = vi.mocked(ghJson);
const mockedGhExec = vi.mocked(ghExec);

describe('labelCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('router', () => {
    it('returns help when --help is passed', async () => {
      const result = await labelCommand(['--help']);
      expect(result).toBe(LABEL_HELP);
    });

    it('returns help when no subcommand is given', async () => {
      const result = await labelCommand([]);
      expect(result).toBe(LABEL_HELP);
    });

    it('returns error for unknown subcommand', async () => {
      const result = await labelCommand(['unknown']);
      expect(result).toContain('Unknown subcommand: unknown');
    });
  });

  describe('list', () => {
    it('returns label list', async () => {
      mockedGhJson.mockResolvedValue([
        { name: 'bug' },
        { name: 'enhancement' },
        { name: 'documentation' },
      ]);

      const result = await labelCommand(['list']);

      expect(result).toContain('bug');
      expect(result).toContain('enhancement');
      expect(result).toContain('documentation');
      expect(result).toContain('count: 3');
      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(['label', 'list', '--json', 'name', '--limit', '500']),
        undefined,
      );
    });

    it('respects --limit flag', async () => {
      mockedGhJson.mockResolvedValue([{ name: 'bug' }]);

      await labelCommand(['list', '--limit', '10']);

      expect(mockedGhJson).toHaveBeenCalledWith(
        expect.arrayContaining(['--limit', '10']),
        undefined,
      );
    });
  });

  describe('create', () => {
    it('creates a label with --name and --color', async () => {
      // First call: check existing labels; second call would be the list
      mockedGhJson.mockResolvedValue([]);
      mockedGhExec.mockResolvedValue('');

      const result = await labelCommand(['create', '--name', 'bug', '--color', 'FF0000']);

      expect(result).toContain('created');
      expect(result).toContain('bug');
      expect(mockedGhExec).toHaveBeenCalledWith(
        expect.arrayContaining(['label', 'create', 'bug', '--color', 'FF0000']),
        undefined,
      );
    });

    it('returns already_exists when label exists (idempotent)', async () => {
      mockedGhJson.mockResolvedValue([{ name: 'bug' }]);

      const result = await labelCommand(['create', '--name', 'bug', '--color', 'FF0000']);

      expect(result).toContain('already_exists');
      expect(mockedGhExec).not.toHaveBeenCalled();
    });

    it('throws when --name is missing', async () => {
      await expect(
        labelCommand(['create', '--color', 'FF0000']),
      ).rejects.toThrow(AxiError);
    });

    it('throws when --color is missing', async () => {
      await expect(
        labelCommand(['create', '--name', 'bug']),
      ).rejects.toThrow(AxiError);
    });

    it('passes --description when provided', async () => {
      mockedGhJson.mockResolvedValue([]);
      mockedGhExec.mockResolvedValue('');

      await labelCommand(['create', '--name', 'bug', '--color', 'FF0000', '--description', 'A bug']);

      expect(mockedGhExec).toHaveBeenCalledWith(
        expect.arrayContaining(['--description', 'A bug']),
        undefined,
      );
    });
  });

  describe('delete', () => {
    it('deletes a label by name', async () => {
      mockedGhExec.mockResolvedValue('');

      const result = await labelCommand(['delete', 'bug']);

      expect(result).toContain('delete');
      expect(result).toContain('ok');
      expect(result).toContain('bug');
      expect(mockedGhExec).toHaveBeenCalledWith(
        ['label', 'delete', 'bug', '--yes'],
        undefined,
      );
    });

    it('throws when label name is missing', async () => {
      await expect(
        labelCommand(['delete']),
      ).rejects.toThrow(AxiError);
    });
  });
});
