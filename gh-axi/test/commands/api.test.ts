import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/gh.js', () => ({
  ghJson: vi.fn(),
  ghExec: vi.fn(),
  ghRaw: vi.fn(),
}));

import { ghExec } from '../../src/gh.js';
import { apiCommand, API_HELP } from '../../src/commands/api.js';

const mockedGhExec = vi.mocked(ghExec);

describe('apiCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns help when --help is passed', async () => {
    const result = await apiCommand(['--help']);
    expect(result).toBe(API_HELP);
  });

  it('returns help when no args are passed', async () => {
    const result = await apiCommand([]);
    expect(result).toBe(API_HELP);
  });

  it('defaults to GET method', async () => {
    mockedGhExec.mockResolvedValue('{}');

    await apiCommand(['/repos/octo/repo']);

    expect(mockedGhExec).toHaveBeenCalledWith(
      expect.arrayContaining(['api', '/repos/octo/repo', '--method', 'GET']),
      undefined,
    );
  });

  it('uses explicit method when provided', async () => {
    mockedGhExec.mockResolvedValue('{}');

    await apiCommand(['POST', '/repos/octo/repo/issues']);

    expect(mockedGhExec).toHaveBeenCalledWith(
      expect.arrayContaining(['--method', 'POST']),
      undefined,
    );
  });

  it('passes --field flags', async () => {
    mockedGhExec.mockResolvedValue('{}');

    await apiCommand(['POST', '/repos/octo/repo/issues', '--field', 'title=Bug']);

    expect(mockedGhExec).toHaveBeenCalledWith(
      expect.arrayContaining(['--field', 'title=Bug']),
      undefined,
    );
  });

  it('passes --header flags', async () => {
    mockedGhExec.mockResolvedValue('{}');

    await apiCommand(['/repos/octo/repo', '--header', 'Accept:application/json']);

    expect(mockedGhExec).toHaveBeenCalledWith(
      expect.arrayContaining(['--header', 'Accept:application/json']),
      undefined,
    );
  });

  it('cleans JSON output by stripping noisy fields', async () => {
    mockedGhExec.mockResolvedValue(JSON.stringify({
      id: 1,
      title: 'Test issue',
      node_id: 'abc123',
      avatar_url: 'https://avatars.example.com/u/123',
      user: { login: 'alice', avatar_url: 'https://example.com', node_id: 'xyz' },
    }));

    const result = await apiCommand(['/repos/octo/repo/issues/1']);

    expect(result).toContain('Test issue');
    // node_id and avatar_url are noisy fields, should be stripped
    expect(result).not.toContain('abc123');
    expect(result).not.toContain('avatars.example.com');
    // user should be collapsed to login
    expect(result).toContain('alice');
  });

  it('returns raw output when response is not JSON', async () => {
    mockedGhExec.mockResolvedValue('plain text response');

    const result = await apiCommand(['/some/endpoint']);

    expect(result).toBe('plain text response');
  });

  it('truncates long non-JSON output', async () => {
    const longText = 'x'.repeat(5000);
    mockedGhExec.mockResolvedValue(longText);

    const result = await apiCommand(['/some/endpoint']);

    expect(result).toContain('... (truncated)');
    expect(result.length).toBeLessThan(5000);
  });
});
