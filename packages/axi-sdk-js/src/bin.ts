import { basename } from "node:path";

/** The executable name as invoked, for `Run \`<bin> ...\`` suggestions. */
export function resolveBinName(): string {
  return basename(process.argv[1] ?? "tool") || "tool";
}
