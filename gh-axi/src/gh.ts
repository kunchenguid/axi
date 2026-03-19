import { execFile } from 'node:child_process';
import { type RepoContext } from './context.js';
import { AxiError, ghNotInstalledError, mapGhError } from './errors.js';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function buildArgs(args: string[], ctx?: RepoContext): string[] {
  const out = [...args];
  // Append --repo for flag/env sources (git remote is auto-detected by gh)
  if (ctx && ctx.source !== 'git') {
    out.push('--repo', ctx.nwo);
  }
  return out;
}

const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MB

function run(args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile('gh', args, { maxBuffer: MAX_BUFFER_BYTES }, (error, stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve({ stdout: '', stderr: 'ENOENT', exitCode: 127 });
        return;
      }
      const exitCode = error ? (error as Error & { code?: string | number }).code ?? 1 : 0;
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '', exitCode: typeof exitCode === 'number' ? exitCode : 1 });
    });
  });
}

/** Execute gh and return parsed JSON. */
export async function ghJson<T = unknown>(args: string[], ctx?: RepoContext): Promise<T> {
  const result = await run(buildArgs(args, ctx));
  if (result.stderr === 'ENOENT') throw ghNotInstalledError();
  if (result.exitCode !== 0) throw mapGhError(result.stderr, result.exitCode);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new AxiError(`Unexpected gh output: ${result.stdout.slice(0, 200)}`, 'UNKNOWN');
  }
}

/** Execute gh and return raw stdout. */
export async function ghExec(args: string[], ctx?: RepoContext): Promise<string> {
  const result = await run(buildArgs(args, ctx));
  if (result.stderr === 'ENOENT') throw ghNotInstalledError();
  if (result.exitCode !== 0) throw mapGhError(result.stderr, result.exitCode);
  return result.stdout;
}

/** Execute gh, returning stdout + stderr without throwing on non-zero exit. */
export async function ghRaw(args: string[], ctx?: RepoContext): Promise<ExecResult> {
  const result = await run(buildArgs(args, ctx));
  if (result.stderr === 'ENOENT') throw ghNotInstalledError();
  return result;
}
