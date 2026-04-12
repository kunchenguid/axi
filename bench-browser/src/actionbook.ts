import { execSync } from "node:child_process";

export const ACTIONBOOK_WARMUP_SESSION_ID = "axi-bench-warmup";

export function isActionbookConditionId(id: string): boolean {
  return id === "actionbook" || id === "actionbook-parallel";
}

export function buildActionbookWarmupScript(): string {
  return [
    "if [ -z \"${ACTIONBOOK_HOME:-}\" ]; then",
    "  exit 0",
    "fi",
    "",
    `actionbook browser start --headless --set-session-id ${ACTIONBOOK_WARMUP_SESSION_ID} --json >\"$ACTIONBOOK_HOME/warmup-start.json\" 2>&1 &`,
    "sleep 3",
    "actionbook browser list-sessions --json >\"$ACTIONBOOK_HOME/warmup-list.json\" 2>&1 || true",
    `actionbook browser close --session ${ACTIONBOOK_WARMUP_SESSION_ID} --json >\"$ACTIONBOOK_HOME/warmup-close.json\" 2>&1 || true`,
  ].join("\n");
}

export function prewarmActionbookDaemon(env: NodeJS.ProcessEnv): void {
  if (!env.ACTIONBOOK_HOME) {
    return;
  }

  try {
    execSync(buildActionbookWarmupScript(), {
      encoding: "utf-8",
      env,
      shell: "/bin/zsh",
      stdio: "pipe",
      timeout: 15_000,
    });
  } catch {
    // Best-effort prewarm only. The agent can still recover during the run.
  }
}
