import { execFile } from 'node:child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type ErrorCode =
  | 'NOT_INSTALLED'
  | 'DAEMON_NOT_RUNNING'
  | 'REF_NOT_FOUND'
  | 'TIMEOUT'
  | 'BROWSER_ERROR'
  | 'VALIDATION_ERROR'
  | 'UNKNOWN';

export class AbError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly suggestions: string[] = [],
  ) {
    super(message);
    this.name = 'AbError';
  }
}

const MAX_BUFFER = 50 * 1024 * 1024; // 50 MB — snapshots can be large

function run(args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile('agent-browser', args, { maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve({ stdout: '', stderr: 'ENOENT', exitCode: 127 });
        return;
      }
      const exitCode = error ? (error as Error & { code?: string | number }).code ?? 1 : 0;
      resolve({
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        exitCode: typeof exitCode === 'number' ? exitCode : 1,
      });
    });
  });
}

function notInstalledError(): AbError {
  return new AbError(
    'agent-browser is not installed',
    'NOT_INSTALLED',
    ['Run `npm install -g agent-browser` then `agent-browser install` to set up'],
  );
}

function mapAbError(output: string, exitCode: number): AbError {
  const firstLine = output.trim().split('\n')[0] || `agent-browser exited with code ${exitCode}`;

  // Try to parse JSON error response
  try {
    const parsed = JSON.parse(output) as { error?: string };
    if (parsed.error) {
      return new AbError(parsed.error, 'BROWSER_ERROR', [
        'Run `agent-browser-axi` to see current page state',
      ]);
    }
  } catch {
    // Not JSON — continue with text matching
  }

  if (output.includes('no browser') || output.includes('not running') || output.includes('daemon')) {
    return new AbError('Browser daemon is not running', 'DAEMON_NOT_RUNNING', [
      'The daemon starts automatically on first command — retry the command',
    ]);
  }

  if ((output.includes('ref') || output.includes('element')) &&
      (output.includes('not found') || output.includes('invalid'))) {
    return new AbError(firstLine, 'REF_NOT_FOUND', [
      'Run `agent-browser-axi snapshot --interactive` to see available interactive elements',
    ]);
  }

  if (output.includes('timeout') || output.includes('timed out')) {
    return new AbError(firstLine, 'TIMEOUT', [
      'Run `agent-browser-axi` to see current page state',
    ]);
  }

  return new AbError(firstLine, 'UNKNOWN');
}

/** Execute agent-browser and return stdout. Throws on failure. */
export async function abExec(args: string[]): Promise<string> {
  const result = await run(args);
  if (result.stderr === 'ENOENT') throw notInstalledError();
  if (result.exitCode !== 0) throw mapAbError(result.stderr || result.stdout, result.exitCode);
  return result.stdout;
}

/** Execute agent-browser, returning result without throwing on non-zero exit. */
export async function abRaw(args: string[]): Promise<ExecResult> {
  const result = await run(args);
  if (result.stderr === 'ENOENT') throw notInstalledError();
  return result;
}
