export interface RefInfo {
  ref: string;
  label: string;
  type: string;
}

/** Count interactive refs in snapshot text. */
export function countRefs(snapshot: string): number {
  const matches = snapshot.match(/\bref=\w+/g);
  return matches ? matches.length : 0;
}

/** Extract ref IDs with labels and types from snapshot text. */
export function extractRefs(snapshot: string): RefInfo[] {
  const refs: RefInfo[] = [];
  for (const line of snapshot.split('\n')) {
    const refMatch = line.match(/\bref=(\w+)/);
    if (!refMatch) continue;
    const ref = refMatch[1];
    const typeMatch = line.match(/-\s+(\w+)\b/);
    const type = typeMatch ? typeMatch[1] : 'element';
    const labelMatch = line.match(/"([^"]+)"/);
    const label = labelMatch ? labelMatch[1] : '';
    refs.push({ ref, label, type });
  }
  return refs;
}

/** Extract page title from snapshot (document element or first heading). */
export function extractTitle(snapshot: string): string {
  const docMatch = snapshot.match(/-\s+document\s+"([^"]+)"/);
  if (docMatch) return docMatch[1];
  const headingMatch = snapshot.match(/-\s+heading\s+"([^"]+)"/);
  if (headingMatch) return headingMatch[1];
  return '';
}

const INPUT_TYPES = ['textbox', 'searchbox', 'input', 'combobox', 'textarea'];

/** Check if a ref type is an input/form field. */
export function isInputType(type: string): boolean {
  return INPUT_TYPES.includes(type);
}
