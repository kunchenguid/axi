/**
 * Dependency-free entry-point fast path.
 *
 * This module deliberately imports nothing - not even other SDK modules - so a
 * tool's `bin/` can answer `--version` before its heavy command graph is
 * loaded:
 *
 * ```js
 * #!/usr/bin/env node
 * import { tryFastPath } from "axi-sdk-js/fast-path";
 * import { VERSION } from "../src/version.js"; // leaf module, node builtins only
 *
 * if (!tryFastPath(process.argv.slice(2), { version: VERSION })) {
 *   const { main } = await import("../src/cli.js"); // heavy graph loads only here
 *   await main();
 * }
 * ```
 *
 * The accepted flags and the emitted output are kept identical to the version
 * handling inside `runAxiCli`, so adopting the fast path is observationally
 * equivalent to routing the same argv through the full CLI. A parity test in
 * `test/fast-path.test.ts` guards that equivalence.
 */

export interface AxiFastPathOptions {
  version: string;
  stdout?: { write: (chunk: string) => unknown };
}

/**
 * Handle a bare version flag (`-v`, `-V`, `--version`) without loading the
 * tool's command graph.
 *
 * Returns `true` when the argv was handled (the version was written); returns
 * `false` and writes nothing otherwise, so the caller can fall through to
 * `runAxiCli`. Version flags in any other position are deliberately not
 * handled here - `runAxiCli` remains the single owner of the general case.
 */
export function tryFastPath(
  argv: string[],
  options: AxiFastPathOptions,
): boolean {
  if (argv.length !== 1) {
    return false;
  }

  const flag = argv[0];
  if (flag !== "-v" && flag !== "-V" && flag !== "--version") {
    return false;
  }

  (options.stdout ?? process.stdout).write(`${options.version}\n`);
  return true;
}
