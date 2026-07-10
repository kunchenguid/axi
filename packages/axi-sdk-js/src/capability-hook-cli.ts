#!/usr/bin/env node

import {
  runCapabilityHookProcess,
  type CapabilityHookRuntimeOptions,
} from "./capability-hooks.js";

const USAGE =
  "Usage: axi-capability-hook <session-start|pre-tool-use> --manifest <path> --policy <path> --identity <path> --evidence <path> [--tool-bin <name>] [--hook-version <version>]";

const FLAG_PROPERTIES = {
  "--manifest": "manifestPath",
  "--policy": "policyPath",
  "--identity": "identityPath",
  "--evidence": "evidencePath",
  "--tool-bin": "toolBin",
  "--hook-version": "hookVersion",
} as const satisfies Record<string, keyof CapabilityHookRuntimeOptions>;

const REQUIRED_FLAGS = [
  "--manifest",
  "--policy",
  "--identity",
  "--evidence",
] as const;

function usageError(message: string): number {
  process.stderr.write(
    `${JSON.stringify({
      error: { code: "INVALID_USAGE", message },
      help: [USAGE],
    })}\n`,
  );
  return 2;
}

function run(argv: string[]): number {
  const args = [...argv];
  const mode = args.shift();
  if (mode !== "session-start" && mode !== "pre-tool-use") {
    return usageError("Mode must be either session-start or pre-tool-use.");
  }

  const values = new Map<string, string>();
  while (args.length > 0) {
    const token = args.shift() as string;
    const equalsIndex = token.indexOf("=");
    const flag = equalsIndex === -1 ? token : token.slice(0, equalsIndex);
    if (!Object.hasOwn(FLAG_PROPERTIES, flag)) {
      return usageError(`Unsupported argument: ${flag}.`);
    }
    if (values.has(flag)) {
      return usageError(`Flag may be provided only once: ${flag}.`);
    }
    const value =
      equalsIndex === -1 ? args.shift() : token.slice(equalsIndex + 1);
    if (!value || value.startsWith("--")) {
      return usageError(`Flag requires a value: ${flag}.`);
    }
    values.set(flag, value);
  }

  for (const flag of REQUIRED_FLAGS) {
    if (!values.has(flag)) {
      return usageError(`Missing required flag: ${flag}.`);
    }
  }

  const options = {} as CapabilityHookRuntimeOptions;
  for (const [flag, value] of values) {
    options[FLAG_PROPERTIES[flag as keyof typeof FLAG_PROPERTIES]] = value;
  }
  return runCapabilityHookProcess(mode, options);
}

process.exitCode = run(process.argv.slice(2));
