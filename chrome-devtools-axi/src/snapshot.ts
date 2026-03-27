export interface RefInfo {
  ref: string;
  label: string;
  type: string;
}

/** Count interactive refs (uid=...) in snapshot text. */
export function countRefs(snapshot: string): number {
  const matches = snapshot.match(/\buid=\S+/g);
  return matches ? matches.length : 0;
}

/** Extract ref IDs with labels and types from snapshot text. */
export function extractRefs(snapshot: string): RefInfo[] {
  const refs: RefInfo[] = [];
  for (const line of snapshot.split("\n")) {
    const m = line.match(/\buid=(\S+)\s+(\w+)\s+"([^"]*)"/);
    if (!m) continue;
    refs.push({ ref: m[1], type: m[2], label: m[3] });
  }
  return refs;
}

/** Extract page title from snapshot (RootWebArea or first heading). */
export function extractTitle(snapshot: string): string {
  const rootMatch = snapshot.match(/RootWebArea\s+"([^"]+)"/);
  if (rootMatch) return rootMatch[1];
  const headingMatch = snapshot.match(/\bheading\s+"([^"]+)"/);
  if (headingMatch) return headingMatch[1];
  return "";
}

const INPUT_TYPES = ["textbox", "searchbox", "input", "combobox", "textarea"];

/** Check if a ref type is an input/form field. */
export function isInputType(type: string): boolean {
  return INPUT_TYPES.includes(type);
}
