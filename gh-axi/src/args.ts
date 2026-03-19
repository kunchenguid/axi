import { AxiError } from './errors.js';

/** Get a flag's value without modifying the args array. */
export function getFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

/** Get a flag's value and remove both the flag and value from args. */
export function takeFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  const val = args[idx + 1];
  args.splice(idx, 2);
  return val;
}

/** Check if a boolean flag is present. */
export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

/** Check if a boolean flag is present and remove it from args. */
export function takeBoolFlag(args: string[], flag: string): boolean {
  const idx = args.indexOf(flag);
  if (idx === -1) return false;
  args.splice(idx, 1);
  return true;
}

/** Collect all values for a repeatable flag. */
export function getAllFlags(args: string[], flag: string): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) {
      result.push(args[i + 1]);
      i++;
    }
  }
  return result;
}

/** Get the first positional arg (non-flag) starting from startIndex. */
export function getPositional(args: string[], startIndex: number): string | undefined {
  for (let i = startIndex; i < args.length; i++) {
    if (!args[i].startsWith('--')) return args[i];
  }
  return undefined;
}

/** Parse and validate a required numeric argument. */
export function requireNumber(raw: string | undefined, label: string): number {
  if (!raw) throw new AxiError(`Missing ${label} number`, 'VALIDATION_ERROR');
  const n = parseInt(raw, 10);
  if (isNaN(n)) throw new AxiError(`Invalid ${label} number: ${raw}`, 'VALIDATION_ERROR');
  return n;
}

/** Find the first numeric positional arg, remove it from args, and return it as a number. */
export function takeNumber(args: string[], label: string): number {
  const raw = args.find((a) => /^\d+$/.test(a));
  if (!raw) throw new AxiError(`Missing ${label} number`, 'VALIDATION_ERROR');
  args.splice(args.indexOf(raw), 1);
  return Number(raw);
}
