import { describe, it, expect } from 'vitest';
import {
  getFlag,
  takeFlag,
  hasFlag,
  takeBoolFlag,
  getAllFlags,
  getPositional,
  requireNumber,
} from '../src/args.js';
import { AxiError } from '../src/errors.js';

describe('getFlag', () => {
  it('returns the value following the flag', () => {
    expect(getFlag(['--repo', 'cli/cli', '--state', 'open'], '--repo')).toBe('cli/cli');
  });

  it('returns undefined when flag is missing', () => {
    expect(getFlag(['--state', 'open'], '--repo')).toBeUndefined();
  });

  it('returns undefined when flag is last element (no value)', () => {
    expect(getFlag(['--state', 'open', '--repo'], '--repo')).toBeUndefined();
  });

  it('does not modify the args array', () => {
    const args = ['--repo', 'cli/cli'];
    getFlag(args, '--repo');
    expect(args).toEqual(['--repo', 'cli/cli']);
  });
});

describe('takeFlag', () => {
  it('returns value and removes flag+value from args', () => {
    const args = ['--repo', 'cli/cli', '--state', 'open'];
    const val = takeFlag(args, '--repo');
    expect(val).toBe('cli/cli');
    expect(args).toEqual(['--state', 'open']);
  });

  it('returns undefined when flag is missing', () => {
    const args = ['--state', 'open'];
    expect(takeFlag(args, '--repo')).toBeUndefined();
    expect(args).toEqual(['--state', 'open']);
  });

  it('removes flag+value even when value is undefined-ish', () => {
    const args = ['--flag', 'val', '--other'];
    // --other is at index 2, takeFlag('--flag') removes indices 0,1
    const val = takeFlag(args, '--flag');
    expect(val).toBe('val');
    expect(args).toEqual(['--other']);
  });
});

describe('hasFlag', () => {
  it('returns true when flag is present', () => {
    expect(hasFlag(['--full', '--json'], '--full')).toBe(true);
  });

  it('returns false when flag is absent', () => {
    expect(hasFlag(['--json'], '--full')).toBe(false);
  });

  it('returns false for empty args', () => {
    expect(hasFlag([], '--full')).toBe(false);
  });
});

describe('takeBoolFlag', () => {
  it('returns true and removes flag', () => {
    const args = ['--full', '--json'];
    expect(takeBoolFlag(args, '--full')).toBe(true);
    expect(args).toEqual(['--json']);
  });

  it('returns false when flag is absent', () => {
    const args = ['--json'];
    expect(takeBoolFlag(args, '--full')).toBe(false);
    expect(args).toEqual(['--json']);
  });
});

describe('getAllFlags', () => {
  it('collects all values for a repeatable flag', () => {
    const args = ['--label', 'bug', '--state', 'open', '--label', 'help wanted'];
    expect(getAllFlags(args, '--label')).toEqual(['bug', 'help wanted']);
  });

  it('returns empty array when flag is absent', () => {
    expect(getAllFlags(['--state', 'open'], '--label')).toEqual([]);
  });

  it('returns empty array for empty args', () => {
    expect(getAllFlags([], '--label')).toEqual([]);
  });

  it('skips flag at end of array with no value', () => {
    const args = ['--label', 'bug', '--label'];
    expect(getAllFlags(args, '--label')).toEqual(['bug']);
  });
});

describe('getPositional', () => {
  it('returns first non-flag arg from startIndex', () => {
    expect(getPositional(['view', '42', '--full'], 0)).toBe('view');
  });

  it('skips -- prefixed flags but not their values', () => {
    // getPositional only skips args starting with '--', flag values are treated as positionals
    expect(getPositional(['--state', 'open', '42'], 0)).toBe('open');
  });

  it('returns first non-flag token', () => {
    expect(getPositional(['--verbose', '42'], 0)).toBe('42');
  });

  it('returns undefined when all args are flags', () => {
    expect(getPositional(['--state', '--verbose'], 0)).toBeUndefined();
  });

  it('respects startIndex', () => {
    expect(getPositional(['view', '42', '--full'], 1)).toBe('42');
  });

  it('returns undefined for empty args', () => {
    expect(getPositional([], 0)).toBeUndefined();
  });
});

describe('requireNumber', () => {
  it('parses a valid number string', () => {
    expect(requireNumber('42', 'issue')).toBe(42);
  });

  it('parses zero', () => {
    expect(requireNumber('0', 'issue')).toBe(0);
  });

  it('throws AxiError for undefined input', () => {
    expect(() => requireNumber(undefined, 'issue')).toThrow(AxiError);
    expect(() => requireNumber(undefined, 'issue')).toThrow('Missing issue number');
  });

  it('throws AxiError for empty string', () => {
    expect(() => requireNumber('', 'pr')).toThrow(AxiError);
    expect(() => requireNumber('', 'pr')).toThrow('Missing pr number');
  });

  it('throws AxiError for non-numeric string', () => {
    expect(() => requireNumber('abc', 'issue')).toThrow(AxiError);
    expect(() => requireNumber('abc', 'issue')).toThrow('Invalid issue number: abc');
  });

  it('thrown error has VALIDATION_ERROR code', () => {
    try {
      requireNumber('abc', 'issue');
    } catch (e) {
      expect(e).toBeInstanceOf(AxiError);
      expect((e as AxiError).code).toBe('VALIDATION_ERROR');
    }
  });
});
