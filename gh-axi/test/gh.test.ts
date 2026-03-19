import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';
import { ghJson, ghExec, ghRaw } from '../src/gh.js';
import type { RepoContext } from '../src/context.js';
import { AxiError } from '../src/errors.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

const mockedExecFile = vi.mocked(execFile);

/** Helper to make mockedExecFile call its callback with specified values. */
function mockExecFileResult(
  error: (Error & { code?: string | number }) | null,
  stdout: string,
  stderr: string,
) {
  mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
    (callback as Function)(error, stdout, stderr);
    return {} as ReturnType<typeof execFile>;
  });
}

/** Helper to simulate ENOENT (gh not installed). */
function mockExecFileEnoent() {
  mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
    const err = new Error('spawn gh ENOENT') as Error & { code: string };
    err.code = 'ENOENT';
    (callback as Function)(err, '', '');
    return {} as ReturnType<typeof execFile>;
  });
}

describe('ghJson', () => {
  beforeEach(() => {
    mockedExecFile.mockReset();
  });

  it('parses JSON output correctly', async () => {
    mockExecFileResult(null, '{"id": 1, "title": "test"}', '');
    const result = await ghJson<{ id: number; title: string }>(['issue', 'view', '1', '--json', 'id,title']);
    expect(result).toEqual({ id: 1, title: 'test' });
  });

  it('throws on non-zero exit code', async () => {
    const error = new Error('exit 1') as Error & { code: number };
    error.code = 1;
    mockExecFileResult(error, '', 'issue 42 not found');
    await expect(ghJson(['issue', 'view', '42'])).rejects.toThrow(AxiError);
    try {
      mockExecFileResult(error, '', 'issue 42 not found');
      await ghJson(['issue', 'view', '42']);
    } catch (e) {
      expect((e as AxiError).code).toBe('NOT_FOUND');
    }
  });

  it('throws on invalid JSON', async () => {
    mockExecFileResult(null, 'not json at all', '');
    await expect(ghJson(['issue', 'list'])).rejects.toThrow(AxiError);
    try {
      mockExecFileResult(null, 'not json at all', '');
      await ghJson(['issue', 'list']);
    } catch (e) {
      expect((e as AxiError).code).toBe('UNKNOWN');
      expect((e as AxiError).message).toContain('Unexpected gh output');
    }
  });

  it('throws ghNotInstalledError on ENOENT', async () => {
    mockExecFileEnoent();
    await expect(ghJson(['issue', 'list'])).rejects.toThrow(AxiError);
    try {
      mockExecFileEnoent();
      await ghJson(['issue', 'list']);
    } catch (e) {
      expect((e as AxiError).code).toBe('GH_NOT_INSTALLED');
    }
  });

  it('appends --repo for non-git sources', async () => {
    mockExecFileResult(null, '[]', '');
    const ctx: RepoContext = { owner: 'cli', name: 'cli', nwo: 'cli/cli', source: 'flag' };
    await ghJson(['issue', 'list'], ctx);
    const callArgs = mockedExecFile.mock.calls[0][1] as string[];
    expect(callArgs).toContain('--repo');
    expect(callArgs).toContain('cli/cli');
  });

  it('does not append --repo for git source', async () => {
    mockExecFileResult(null, '[]', '');
    const ctx: RepoContext = { owner: 'cli', name: 'cli', nwo: 'cli/cli', source: 'git' };
    await ghJson(['issue', 'list'], ctx);
    const callArgs = mockedExecFile.mock.calls[0][1] as string[];
    expect(callArgs).not.toContain('--repo');
  });
});

describe('ghExec', () => {
  beforeEach(() => {
    mockedExecFile.mockReset();
  });

  it('returns stdout on success', async () => {
    mockExecFileResult(null, 'output text', '');
    const result = await ghExec(['issue', 'create']);
    expect(result).toBe('output text');
  });

  it('throws on non-zero exit code', async () => {
    const error = new Error('exit 1') as Error & { code: number };
    error.code = 1;
    mockExecFileResult(error, '', 'HTTP 403: Forbidden');
    await expect(ghExec(['issue', 'create'])).rejects.toThrow(AxiError);
    try {
      mockExecFileResult(error, '', 'HTTP 403: Forbidden');
      await ghExec(['issue', 'create']);
    } catch (e) {
      expect((e as AxiError).code).toBe('FORBIDDEN');
    }
  });

  it('throws ghNotInstalledError on ENOENT', async () => {
    mockExecFileEnoent();
    await expect(ghExec(['version'])).rejects.toThrow(AxiError);
    try {
      mockExecFileEnoent();
      await ghExec(['version']);
    } catch (e) {
      expect((e as AxiError).code).toBe('GH_NOT_INSTALLED');
    }
  });
});

describe('ghRaw', () => {
  beforeEach(() => {
    mockedExecFile.mockReset();
  });

  it('returns full result without throwing on non-zero exit', async () => {
    const error = new Error('exit 1') as Error & { code: number };
    error.code = 1;
    mockExecFileResult(error, 'some output', 'some error');
    const result = await ghRaw(['api', 'repos']);
    expect(result.stdout).toBe('some output');
    expect(result.stderr).toBe('some error');
    expect(result.exitCode).toBe(1);
  });

  it('returns result on success', async () => {
    mockExecFileResult(null, 'output', '');
    const result = await ghRaw(['api', 'repos']);
    expect(result.stdout).toBe('output');
    expect(result.exitCode).toBe(0);
  });

  it('throws ghNotInstalledError on ENOENT', async () => {
    mockExecFileEnoent();
    await expect(ghRaw(['version'])).rejects.toThrow(AxiError);
    try {
      mockExecFileEnoent();
      await ghRaw(['version']);
    } catch (e) {
      expect((e as AxiError).code).toBe('GH_NOT_INSTALLED');
    }
  });

  it('appends --repo for env source', async () => {
    mockExecFileResult(null, 'output', '');
    const ctx: RepoContext = { owner: 'o', name: 'r', nwo: 'o/r', source: 'env' };
    await ghRaw(['api', 'repos'], ctx);
    const callArgs = mockedExecFile.mock.calls[0][1] as string[];
    expect(callArgs).toContain('--repo');
    expect(callArgs).toContain('o/r');
  });
});
