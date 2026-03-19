export type ErrorCode =
  | 'REPO_NOT_FOUND'
  | 'NOT_FOUND'
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'GH_NOT_INSTALLED'
  | 'UNKNOWN';

export class AxiError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly suggestions: string[] = [],
  ) {
    super(message);
    this.name = 'AxiError';
  }
}

interface ErrorPattern {
  pattern: RegExp;
  code: ErrorCode;
  message: (match: RegExpMatchArray, stderr: string) => string;
  suggestions?: (match: RegExpMatchArray) => string[];
}

const patterns: ErrorPattern[] = [
  {
    pattern: /Could not resolve to a Repository with the name '([^']+)'/,
    code: 'REPO_NOT_FOUND',
    message: (m) => `Repository "${m[1]}" not found`,
    suggestions: () => ['Run `gh-axi repo list` to see your repositories'],
  },
  {
    pattern: /Could not resolve to an? .+? with the number of (\d+)/,
    code: 'NOT_FOUND',
    message: (m) => `Item #${m[1]} does not exist in this repository`,
    suggestions: () => [],
  },
  {
    pattern: /issue (\d+) not found/i,
    code: 'NOT_FOUND',
    message: (m) => `Issue #${m[1]} does not exist`,
    suggestions: () => [],
  },
  {
    pattern: /pull request (\d+) not found/i,
    code: 'NOT_FOUND',
    message: (m) => `Pull request #${m[1]} does not exist`,
    suggestions: () => [],
  },
  {
    pattern: /release with tag "([^"]+)" not found/i,
    code: 'NOT_FOUND',
    message: (m) => `Release "${m[1]}" not found`,
    suggestions: () => [`Run \`gh-axi release list\` to see available releases`],
  },
  {
    pattern: /run (\d+) not found/i,
    code: 'NOT_FOUND',
    message: (m) => `Run ${m[1]} not found`,
    suggestions: () => [`Run \`gh-axi run list\` to see recent runs`],
  },
  {
    pattern: /gh auth login/,
    code: 'AUTH_REQUIRED',
    message: () => 'GitHub auth required — run `gh auth login` first',
  },
  {
    pattern: /HTTP 403/,
    code: 'FORBIDDEN',
    message: () => 'Insufficient permissions for this action',
  },
  {
    pattern: /HTTP 422/,
    code: 'VALIDATION_ERROR',
    message: (_m, stderr) => {
      // Try to extract a meaningful message from the 422 body
      const msgMatch = stderr.match(/"message"\s*:\s*"([^"]+)"/);
      return msgMatch ? msgMatch[1] : 'Validation error';
    },
  },
];

export function mapGhError(stderr: string, exitCode: number): AxiError {
  for (const { pattern, code, message, suggestions } of patterns) {
    const match = stderr.match(pattern);
    if (match) {
      return new AxiError(message(match, stderr), code, suggestions?.(match) ?? []);
    }
  }

  // Generic not-found for any 404-like message
  if (stderr.includes('not found') || stderr.includes('Not Found')) {
    return new AxiError(stderr.trim().split('\n')[0], 'NOT_FOUND');
  }

  return new AxiError(stderr.trim().split('\n')[0] || `gh exited with code ${exitCode}`, 'UNKNOWN');
}

export function ghNotInstalledError(): AxiError {
  return new AxiError(
    'gh CLI is not installed — see https://cli.github.com',
    'GH_NOT_INSTALLED',
  );
}
