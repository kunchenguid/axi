import { execFileSync } from "node:child_process";

export type ClaudeAuthMode = "auto" | "env" | "subscription";

export interface ClaudeAuthStatus {
  loggedIn: boolean;
  authMethod?: string;
  apiProvider?: string;
  apiKeySource?: string;
}

export interface ResolvedClaudeAuth {
  env: NodeJS.ProcessEnv;
  mode: "env" | "subscription";
  status: ClaudeAuthStatus;
}

export type ClaudeAuthProbe = (env: NodeJS.ProcessEnv) => ClaudeAuthStatus;

const EXTERNAL_AUTH_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
];

export function stripExternalClaudeAuthEnv(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const next = { ...env };
  for (const key of EXTERNAL_AUTH_ENV_KEYS) {
    delete next[key];
  }
  return next;
}

export function hasExternalClaudeAuthEnv(env: NodeJS.ProcessEnv): boolean {
  return EXTERNAL_AUTH_ENV_KEYS.some((key) => {
    const value = env[key];
    return typeof value === "string" && value.length > 0;
  });
}

export function parseClaudeAuthStatus(raw: string): ClaudeAuthStatus {
  try {
    const parsed = JSON.parse(raw) as Partial<ClaudeAuthStatus>;
    return {
      loggedIn: parsed.loggedIn === true,
      authMethod: parsed.authMethod,
      apiProvider: parsed.apiProvider,
      apiKeySource: parsed.apiKeySource,
    };
  } catch {
    return { loggedIn: false, authMethod: "unknown" };
  }
}

export function probeClaudeAuthStatus(env: NodeJS.ProcessEnv): ClaudeAuthStatus {
  let output = "";
  try {
    output = execFileSync("claude", ["auth", "status"], {
      encoding: "utf-8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err: unknown) {
    output = (err as { stdout?: string }).stdout ?? "";
  }
  return parseClaudeAuthStatus(output);
}

export function resolveClaudeAuth(
  mode: ClaudeAuthMode,
  baseEnv: NodeJS.ProcessEnv,
  probe: ClaudeAuthProbe = probeClaudeAuthStatus,
): ResolvedClaudeAuth {
  const envAuthStatus = probe(baseEnv);
  if (mode === "env") {
    return { env: { ...baseEnv }, mode: "env", status: envAuthStatus };
  }

  const subscriptionEnv = stripExternalClaudeAuthEnv(baseEnv);
  const subscriptionStatus = probe(subscriptionEnv);
  if (subscriptionStatus.loggedIn) {
    return {
      env: subscriptionEnv,
      mode: "subscription",
      status: subscriptionStatus,
    };
  }

  if (mode === "subscription") {
    throw new Error(
      "Claude subscription auth requested, but no local Claude Code login was found. Run `claude auth login` or `claude setup-token` first.",
    );
  }

  if (hasExternalClaudeAuthEnv(baseEnv)) {
    return { env: { ...baseEnv }, mode: "env", status: envAuthStatus };
  }

  throw new Error(
    "Claude auth is not configured. Log in with `claude auth login` / `claude setup-token`, or provide external auth and use `--claude-auth env`.",
  );
}
