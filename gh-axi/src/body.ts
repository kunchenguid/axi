/**
 * Shared body cleaning and truncation for all entity types.
 *
 * Cleanups are only applied when content needs truncation.
 * When --full is used, the raw body is returned as-is.
 */

/** Clean up a body string to reduce token cost before truncation. */
export function cleanBody(text: string): string {
  // Normalize GitHub PR/issue URLs to short references
  let s = text.replace(/\[([^\]]+)\]\(https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)\)/g, '[$1](PR#$2)');
  s = s.replace(/\[([^\]]+)\]\(https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)\)/g, '[$1](Issue#$2)');
  s = s.replace(/(?<!\()https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/g, 'PR#$1');
  s = s.replace(/(?<!\()https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/g, 'Issue#$1');
  // Strip markdown image embeds: ![alt](url) → [image: alt]
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, (_m, alt) => alt ? `[image: ${alt}]` : '[image]');
  // Strip long URLs (>80 chars) in markdown links: [text](longurl) → [text]
  s = s.replace(/\[([^\]]+)\]\(([^)]{80,})\)/g, '[$1]');
  // Strip standalone long URLs (>100 chars) not in markdown
  s = s.replace(/(?<!\()https?:\/\/\S{100,}/g, '[long URL removed]');
  // Collapse email-style quoted blocks (lines starting with >) to a summary
  s = s.replace(/(^|\n)(>\s?[^\n]*\n?){3,}/gm, '$1[quoted text removed]\n');
  return s;
}

/**
 * Truncate a body field for display.
 * Cleanups are only applied when truncation is needed.
 * Returns the raw body when it fits within maxLen.
 */
export function truncateBody(body: unknown, maxLen = 500): string {
  if (typeof body !== 'string' || !body) return '';
  if (body.length <= maxLen) return body;
  const cleaned = cleanBody(body);
  if (cleaned.length <= maxLen) {
    // Cleanup made it fit, but content was modified — offer --full for the original
    if (cleaned !== body) {
      return cleaned + '\n(cleaned from ' + body.length + ' chars — use --full to see original)';
    }
    return cleaned;
  }
  return cleaned.slice(0, maxLen) + '\n... (truncated, ' + cleaned.length + ' chars total — use --full to see complete body)';
}
