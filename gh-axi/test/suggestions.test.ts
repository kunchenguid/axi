import { describe, it, expect } from 'vitest';
import { getSuggestions } from '../src/suggestions.js';

describe('getSuggestions', () => {
  it('returns home suggestions', () => {
    const lines = getSuggestions({ domain: 'home', action: 'home' });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes('issue') || l.includes('pr'))).toBe(true);
  });

  it('returns issue list suggestions when non-empty', () => {
    const lines = getSuggestions({ domain: 'issue', action: 'list', isEmpty: false });
    expect(lines.some((l) => l.includes('issue view'))).toBe(true);
  });

  it('returns issue list suggestions when empty', () => {
    const lines = getSuggestions({ domain: 'issue', action: 'list', isEmpty: true });
    expect(lines.some((l) => l.includes('issue create'))).toBe(true);
    expect(lines.some((l) => l.includes('--state closed'))).toBe(true);
  });

  it('returns open issue view suggestions', () => {
    const lines = getSuggestions({ domain: 'issue', action: 'view', state: 'open', id: 42 });
    expect(lines.some((l) => l.includes('comment 42'))).toBe(true);
    expect(lines.some((l) => l.includes('close 42'))).toBe(true);
  });

  it('returns closed issue view suggestions', () => {
    const lines = getSuggestions({ domain: 'issue', action: 'view', state: 'closed', id: 42 });
    expect(lines.some((l) => l.includes('reopen 42'))).toBe(true);
  });

  it('carries -R flag when repo source is not git', () => {
    const lines = getSuggestions({
      domain: 'issue',
      action: 'list',
      isEmpty: false,
      repo: { owner: 'cli', name: 'cli', nwo: 'cli/cli', source: 'flag' },
    });
    expect(lines.every((l) => l.includes('-R cli/cli'))).toBe(true);
  });

  it('does not carry -R flag when repo source is git', () => {
    const lines = getSuggestions({
      domain: 'issue',
      action: 'list',
      isEmpty: false,
      repo: { owner: 'cli', name: 'cli', nwo: 'cli/cli', source: 'git' },
    });
    expect(lines.every((l) => !l.includes('-R'))).toBe(true);
  });

  it('returns PR merge suggestions', () => {
    const lines = getSuggestions({ domain: 'pr', action: 'merge', id: 10 });
    expect(lines.some((l) => l.includes('revert'))).toBe(true);
  });

  it('returns run view suggestions for in-progress', () => {
    const lines = getSuggestions({ domain: 'run', action: 'view', state: 'in_progress', id: 123 });
    expect(lines.some((l) => l.includes('watch 123'))).toBe(true);
    expect(lines.some((l) => l.includes('cancel 123'))).toBe(true);
  });
});
