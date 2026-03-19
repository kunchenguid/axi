import { describe, it, expect } from 'vitest';
import {
  extract,
  field,
  pluck,
  joinArray,
  relativeTime,
  boolYesNo,
  mapEnum,
  lower,
  checksSummary,
  custom,
  renderList,
  renderDetail,
  renderHelp,
  renderError,
  renderOutput,
} from '../src/toon.js';

describe('field extractors', () => {
  it('field() passes through values', () => {
    const result = extract({ number: 42 }, [field('number')]);
    expect(result).toEqual({ number: 42 });
  });

  it('field() with alias', () => {
    const result = extract({ databaseId: 123 }, [field('databaseId', 'id')]);
    expect(result).toEqual({ id: 123 });
  });

  it('pluck() extracts nested value', () => {
    const result = extract({ author: { login: 'alice' } }, [pluck('author', 'login')]);
    expect(result).toEqual({ author: 'alice' });
  });

  it('pluck() returns null for missing', () => {
    const result = extract({}, [pluck('author', 'login')]);
    expect(result).toEqual({ author: null });
  });

  it('joinArray() joins sub-values', () => {
    const result = extract(
      { labels: [{ name: 'bug' }, { name: 'help wanted' }] },
      [joinArray('labels', 'name')],
    );
    expect(result).toEqual({ labels: 'bug,help wanted' });
  });

  it('joinArray() returns "none" for empty', () => {
    const result = extract({ labels: [] }, [joinArray('labels', 'name')]);
    expect(result).toEqual({ labels: 'none' });
  });

  it('boolYesNo() converts booleans', () => {
    expect(extract({ isDraft: true }, [boolYesNo('isDraft', 'draft')])).toEqual({ draft: 'yes' });
    expect(extract({ isDraft: false }, [boolYesNo('isDraft', 'draft')])).toEqual({ draft: 'no' });
  });

  it('mapEnum() maps values', () => {
    const map = { APPROVED: 'approved', REVIEW_REQUIRED: 'required' };
    expect(extract({ reviewDecision: 'APPROVED' }, [mapEnum('reviewDecision', map, 'none', 'review')])).toEqual({ review: 'approved' });
    expect(extract({ reviewDecision: '' }, [mapEnum('reviewDecision', map, 'none', 'review')])).toEqual({ review: 'none' });
  });

  it('lower() lowercases strings', () => {
    expect(extract({ state: 'OPEN' }, [lower('state')])).toEqual({ state: 'open' });
  });

  it('checksSummary() summarizes checks', () => {
    const checks = [
      { conclusion: 'SUCCESS' },
      { conclusion: 'FAILURE' },
      { conclusion: 'NEUTRAL' },
    ];
    expect(extract({ checks }, [checksSummary('checks')])).toEqual({ checks: '2/3 pass' });
  });

  it('checksSummary() returns "none" for empty', () => {
    expect(extract({ checks: [] }, [checksSummary('checks')])).toEqual({ checks: 'none' });
  });

  it('custom() runs arbitrary function', () => {
    const result = extract({ a: 1, b: 2 }, [custom('sum', (item) => item.a + item.b)]);
    expect(result).toEqual({ sum: 3 });
  });

  it('relativeTime() formats recent times', () => {
    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    const result = extract({ createdAt: fiveMinAgo }, [relativeTime('createdAt', 'created')]);
    expect(result.created).toBe('5m ago');
  });

  it('relativeTime() handles null', () => {
    const result = extract({ createdAt: null }, [relativeTime('createdAt', 'created')]);
    expect(result.created).toBe('unknown');
  });
});

describe('renderList', () => {
  it('renders a TOON list', () => {
    const items = [
      { number: 1, title: 'Bug', state: 'OPEN', author: { login: 'alice' } },
      { number: 2, title: 'Feature', state: 'CLOSED', author: { login: 'bob' } },
    ];
    const schema = [field('number'), field('title'), lower('state'), pluck('author', 'login')];
    const output = renderList('issues', items, schema);
    expect(output).toContain('issues[2]{number,title,state,author}:');
    expect(output).toContain('1,Bug,open,alice');
    expect(output).toContain('2,Feature,closed,bob');
  });
});

describe('renderDetail', () => {
  it('renders a TOON detail block', () => {
    const item = { number: 42, title: 'Test', state: 'OPEN' };
    const schema = [field('number'), field('title'), lower('state')];
    const output = renderDetail('issue', item, schema);
    expect(output).toContain('issue:');
    expect(output).toContain('number: 42');
    expect(output).toContain('title: Test');
    expect(output).toContain('state: open');
  });
});

describe('renderHelp', () => {
  it('renders help lines', () => {
    const output = renderHelp(['Do this', 'Do that']);
    expect(output).toBe('help[2]:\n  Do this\n  Do that');
  });

  it('returns empty for no lines', () => {
    expect(renderHelp([])).toBe('');
  });
});

describe('renderError', () => {
  it('renders error with code and suggestions', () => {
    const output = renderError('Not found', 'NOT_FOUND', ['Try listing']);
    expect(output).toContain('error: Not found');
    expect(output).toContain('code: NOT_FOUND');
    expect(output).toContain('help[1]:');
    expect(output).toContain('Try listing');
  });
});

describe('renderOutput', () => {
  it('combines blocks and filters empty', () => {
    expect(renderOutput(['block1', '', 'block2'])).toBe('block1\nblock2');
  });
});
