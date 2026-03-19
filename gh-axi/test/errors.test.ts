import { describe, it, expect } from 'vitest';
import { AxiError, mapGhError, ghNotInstalledError } from '../src/errors.js';

describe('AxiError', () => {
  it('has correct code and message', () => {
    const err = new AxiError('not found', 'NOT_FOUND');
    expect(err.message).toBe('not found');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.name).toBe('AxiError');
    expect(err).toBeInstanceOf(Error);
  });

  it('has default empty suggestions', () => {
    const err = new AxiError('msg', 'UNKNOWN');
    expect(err.suggestions).toEqual([]);
  });

  it('stores custom suggestions', () => {
    const err = new AxiError('msg', 'NOT_FOUND', ['Try this', 'Try that']);
    expect(err.suggestions).toEqual(['Try this', 'Try that']);
  });
});

describe('mapGhError', () => {
  it('matches repo not found pattern', () => {
    const err = mapGhError("Could not resolve to a Repository with the name 'cli/cli'", 1);
    expect(err.code).toBe('REPO_NOT_FOUND');
    expect(err.message).toContain('cli/cli');
    expect(err.suggestions.length).toBeGreaterThan(0);
  });

  it('matches issue not found pattern (GraphQL)', () => {
    const err = mapGhError('Could not resolve to an Issue with the number of 999', 1);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toContain('999');
  });

  it('matches issue not found pattern (REST)', () => {
    const err = mapGhError('issue 42 not found', 1);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toContain('42');
  });

  it('matches pull request not found pattern', () => {
    const err = mapGhError('pull request 10 not found', 1);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toContain('10');
  });

  it('matches release not found pattern', () => {
    const err = mapGhError('release with tag "v1.0" not found', 1);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toContain('v1.0');
    expect(err.suggestions.some((s) => s.includes('release list'))).toBe(true);
  });

  it('matches run not found pattern', () => {
    const err = mapGhError('run 12345 not found', 1);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toContain('12345');
    expect(err.suggestions.some((s) => s.includes('run list'))).toBe(true);
  });

  it('matches auth required pattern', () => {
    const err = mapGhError('To get started, please run: gh auth login', 1);
    expect(err.code).toBe('AUTH_REQUIRED');
  });

  it('matches forbidden pattern', () => {
    const err = mapGhError('HTTP 403: Forbidden', 1);
    expect(err.code).toBe('FORBIDDEN');
  });

  it('matches validation error pattern with message extraction', () => {
    const stderr = 'HTTP 422: {"message": "Validation Failed", "errors": []}';
    const err = mapGhError(stderr, 1);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toBe('Validation Failed');
  });

  it('matches validation error pattern without extractable message', () => {
    const err = mapGhError('HTTP 422', 1);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toBe('Validation error');
  });

  it('returns NOT_FOUND for generic not found messages', () => {
    const err = mapGhError('something not found', 1);
    expect(err.code).toBe('NOT_FOUND');
  });

  it('returns NOT_FOUND for "Not Found" (capitalized)', () => {
    const err = mapGhError('Not Found', 1);
    expect(err.code).toBe('NOT_FOUND');
  });

  it('returns UNKNOWN for unrecognized errors', () => {
    const err = mapGhError('some random error', 1);
    expect(err.code).toBe('UNKNOWN');
    expect(err.message).toBe('some random error');
  });

  it('returns UNKNOWN with exit code message for empty stderr', () => {
    const err = mapGhError('', 2);
    expect(err.code).toBe('UNKNOWN');
    expect(err.message).toContain('exited with code 2');
  });

  it('uses first line of multi-line stderr for UNKNOWN errors', () => {
    const err = mapGhError('first line\nsecond line\nthird line', 1);
    expect(err.code).toBe('UNKNOWN');
    expect(err.message).toBe('first line');
  });
});

describe('ghNotInstalledError', () => {
  it('returns AxiError with GH_NOT_INSTALLED code', () => {
    const err = ghNotInstalledError();
    expect(err).toBeInstanceOf(AxiError);
    expect(err.code).toBe('GH_NOT_INSTALLED');
    expect(err.message).toContain('gh CLI');
  });
});
