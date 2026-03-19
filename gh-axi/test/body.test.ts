import { describe, it, expect } from 'vitest';
import { cleanBody, truncateBody } from '../src/body.js';

describe('cleanBody', () => {
  it('normalizes GitHub PR markdown links to short references', () => {
    const input = '[Fix bug](https://github.com/cli/cli/pull/123)';
    expect(cleanBody(input)).toBe('[Fix bug](PR#123)');
  });

  it('normalizes GitHub issue markdown links to short references', () => {
    const input = '[Bug report](https://github.com/cli/cli/issues/456)';
    expect(cleanBody(input)).toBe('[Bug report](Issue#456)');
  });

  it('normalizes bare GitHub PR URLs', () => {
    const input = 'See https://github.com/cli/cli/pull/789 for details';
    expect(cleanBody(input)).toBe('See PR#789 for details');
  });

  it('normalizes bare GitHub issue URLs', () => {
    const input = 'Related to https://github.com/cli/cli/issues/100';
    expect(cleanBody(input)).toBe('Related to Issue#100');
  });

  it('does not normalize PR URL inside parentheses (markdown link target)', () => {
    // The negative lookbehind (?<!\() should prevent replacing URLs that are link targets
    const input = '[Fix](https://github.com/cli/cli/pull/123)';
    // This is a markdown link, handled by the first regex
    expect(cleanBody(input)).toBe('[Fix](PR#123)');
  });

  it('strips markdown image embeds with alt text', () => {
    const input = '![screenshot](https://example.com/img.png)';
    expect(cleanBody(input)).toBe('[image: screenshot]');
  });

  it('strips markdown image embeds without alt text', () => {
    const input = '![](https://example.com/img.png)';
    expect(cleanBody(input)).toBe('[image]');
  });

  it('strips long URLs in markdown links (>80 chars)', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(80);
    const input = `[click here](${longUrl})`;
    expect(cleanBody(input)).toBe('[click here]');
  });

  it('preserves short URLs in markdown links', () => {
    const shortUrl = 'https://example.com/short';
    const input = `[click here](${shortUrl})`;
    expect(cleanBody(input)).toBe(`[click here](${shortUrl})`);
  });

  it('strips standalone long URLs (>100 chars)', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(100);
    const input = `Check ${longUrl} for info`;
    expect(cleanBody(input)).toBe('Check [long URL removed] for info');
  });

  it('collapses quoted blocks of 3+ lines', () => {
    const input = '> line1\n> line2\n> line3\n> line4';
    expect(cleanBody(input)).toContain('[quoted text removed]');
  });

  it('does not collapse fewer than 3 quoted lines', () => {
    const input = '> line1\n> line2\nsome text';
    expect(cleanBody(input)).toContain('> line1');
    expect(cleanBody(input)).toContain('> line2');
  });

  it('passes through plain text unchanged', () => {
    const input = 'This is a simple body with no special content.';
    expect(cleanBody(input)).toBe(input);
  });
});

describe('truncateBody', () => {
  it('passes through short strings unchanged', () => {
    expect(truncateBody('short text', 500)).toBe('short text');
  });

  it('passes through strings exactly at maxLen', () => {
    const text = 'x'.repeat(500);
    expect(truncateBody(text, 500)).toBe(text);
  });

  it('truncates long strings', () => {
    const text = 'x'.repeat(600);
    const result = truncateBody(text, 500);
    expect(result).toContain('truncated');
    expect(result).toContain('600 chars total');
  });

  it('returns empty string for non-string input', () => {
    expect(truncateBody(null)).toBe('');
    expect(truncateBody(undefined)).toBe('');
    expect(truncateBody(123 as unknown)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(truncateBody('')).toBe('');
  });

  it('applies cleaning before truncation and may avoid truncation', () => {
    // Create a body that is over 100 chars but cleaning brings it under
    const longUrl = 'https://example.com/' + 'a'.repeat(100);
    const prefix = 'Check ';
    const body = prefix + longUrl;
    // body is ~127 chars, after cleaning URL becomes [long URL removed] (~35 chars)
    const result = truncateBody(body, 100);
    // Should contain "cleaned from" since cleaning made it fit
    expect(result).toContain('cleaned from');
    expect(result).toContain('use --full to see original');
  });

  it('truncates even after cleaning when still too long', () => {
    const text = 'a'.repeat(1000);
    const result = truncateBody(text, 100);
    expect(result.length).toBeLessThan(1000);
    expect(result).toContain('truncated');
  });

  it('uses default maxLen of 500', () => {
    const text = 'x'.repeat(501);
    const result = truncateBody(text);
    expect(result).toContain('truncated');
  });
});
