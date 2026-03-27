/**
 * Daemon lifecycle management for browser benchmark conditions.
 *
 * Each condition has different daemon requirements:
 * - agent-browser: auto-launches daemon on first command; install once via `agent-browser install`
 * - chrome-devtools-axi: explicit `chrome-devtools-axi start` / `chrome-devtools-axi stop`
 * - chrome-devtools-mcp / -search / -compressed: no daemon — MCP server managed by Claude process
 * - chrome-devtools-mcp-code: supergateway daemon bridging chrome-devtools-mcp stdio→HTTP
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";
import type { ConditionDef } from "./types.js";

/** How long to wait for daemon health check (ms). */
const HEALTH_CHECK_TIMEOUT_MS = 10_000;
/** Interval between health check retries (ms). */
const HEALTH_CHECK_INTERVAL_MS = 500;
/** Port for the supergateway HTTP bridge (code-mode). */
const CODE_MODE_BRIDGE_PORT = 9223;

import { resolve } from "node:path";

/** Tracks the bridge process for code-mode. */
let bridgeProcess: ChildProcess | null = null;
const BENCH_ROOT = resolve(import.meta.dirname, "..");

/**
 * Start the daemon for a condition (if needed).
 *
 * - "auto": run install command if provided, daemon self-manages
 * - "explicit": run daemon_start command and wait for health
 * - "none": no-op (MCP server managed by Claude), except code-mode which
 *   starts a persistent supergateway bridge
 */
export function startDaemon(condition: ConditionDef): void {
  switch (condition.daemon) {
    case "auto":
      // agent-browser auto-launches its daemon on first command.
      // Run install if it hasn't been done.
      if (condition.install_command) {
        try {
          execSync(condition.install_command, {
            encoding: "utf-8",
            timeout: 30_000,
            stdio: "pipe",
          });
          console.log(`  [lifecycle] Ran install: ${condition.install_command}`);
        } catch {
          // Install may fail if already installed; that's fine.
          console.log(`  [lifecycle] Install already done or skipped: ${condition.install_command}`);
        }
      }
      break;

    case "explicit":
      if (condition.daemon_start) {
        console.log(`  [lifecycle] Starting daemon: ${condition.daemon_start}`);
        try {
          execSync(condition.daemon_start, {
            encoding: "utf-8",
            timeout: 15_000,
            stdio: "pipe",
          });
        } catch (err: unknown) {
          const execErr = err as { stderr?: string };
          // Daemon may already be running
          console.log(`  [lifecycle] Daemon start note: ${execErr.stderr ?? "already running?"}`);
        }
        waitForHealth(condition);
      }
      break;

    case "none":
      // For code-mode: start supergateway bridging chrome-devtools-mcp
      // stdio to HTTP so scripts can call tools across invocations.
      if (condition.id === "chrome-devtools-mcp-code") {
        startBridge();
      }
      break;
  }
}

/**
 * Stop the daemon for a condition (if needed).
 */
export function stopDaemon(condition: ConditionDef): void {
  switch (condition.daemon) {
    case "explicit":
      if (condition.daemon_stop) {
        console.log(`  [lifecycle] Stopping daemon: ${condition.daemon_stop}`);
        try {
          execSync(condition.daemon_stop, {
            encoding: "utf-8",
            timeout: 10_000,
            stdio: "pipe",
          });
        } catch {
          console.log(`  [lifecycle] Daemon stop failed (may already be stopped)`);
        }
      }
      break;

    case "auto":
    case "none":
      // none: nothing to stop (except code-mode bridge)
      stopBridge();
      break;
  }

  // Always try to kill orphaned Chrome/Chromium processes
  killOrphanedBrowsers();
}

/**
 * Check if the daemon is healthy by running a simple command.
 */
export function checkHealth(condition: ConditionDef): boolean {
  const healthCmd = getHealthCommand(condition);
  if (!healthCmd) return true; // No health check needed

  try {
    execSync(healthCmd, {
      encoding: "utf-8",
      timeout: 5_000,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for daemon to become healthy, with retries.
 * Throws if health check times out.
 */
function waitForHealth(condition: ConditionDef): void {
  const healthCmd = getHealthCommand(condition);
  if (!healthCmd) return;

  const deadline = Date.now() + HEALTH_CHECK_TIMEOUT_MS;
  let healthy = false;

  while (Date.now() < deadline) {
    try {
      execSync(healthCmd, {
        encoding: "utf-8",
        timeout: 5_000,
        stdio: "pipe",
      });
      healthy = true;
      break;
    } catch {
      // Sleep briefly before retrying
      execSync(`sleep ${HEALTH_CHECK_INTERVAL_MS / 1000}`, { stdio: "pipe" });
    }
  }

  if (healthy) {
    console.log(`  [lifecycle] Daemon is healthy`);
  } else {
    console.warn(`  [lifecycle] WARNING: Daemon health check timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`);
  }
}

/**
 * Get the health check command for a condition.
 */
function getHealthCommand(condition: ConditionDef): string | null {
  switch (condition.id) {
    case "agent-browser":
    case "agent-browser-axi":
      return "agent-browser navigate about:blank";
    case "chrome-devtools-axi":
      return "curl -sf http://127.0.0.1:9224/health";
    default:
      return null;
  }
}

/**
 * Start the MCP bridge: a Node.js HTTP server that holds a persistent
 * chrome-devtools-mcp session so browser state survives across scripts.
 */
function startBridge(): void {
  console.log(`  [lifecycle] Starting MCP bridge on :${CODE_MODE_BRIDGE_PORT}`);
  const bridgeScript = resolve(BENCH_ROOT, "lib", "browser-code", "bridge.ts");
  bridgeProcess = spawn("npx", ["tsx", bridgeScript], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, BROWSER_CODE_BRIDGE_PORT: String(CODE_MODE_BRIDGE_PORT) },
    detached: true,
  });
  bridgeProcess.unref();

  // Wait for the bridge to be ready (it prints "READY" on stdout)
  const deadline = Date.now() + 30_000; // chrome launch can be slow
  while (Date.now() < deadline) {
    try {
      execSync(`curl -s http://127.0.0.1:${CODE_MODE_BRIDGE_PORT}/health`, {
        encoding: "utf-8",
        timeout: 2_000,
        stdio: "pipe",
      });
      console.log(`  [lifecycle] Bridge is ready on :${CODE_MODE_BRIDGE_PORT}`);
      return;
    } catch {
      execSync(`sleep ${HEALTH_CHECK_INTERVAL_MS / 1000}`, { stdio: "pipe" });
    }
  }
  console.warn(`  [lifecycle] WARNING: Bridge didn't become ready on :${CODE_MODE_BRIDGE_PORT}`);
}

/** Stop the MCP bridge if running. */
function stopBridge(): void {
  if (bridgeProcess) {
    console.log(`  [lifecycle] Stopping bridge (pid ${bridgeProcess.pid})`);
    bridgeProcess.kill();
    bridgeProcess = null;
  }
}

/**
 * Kill orphaned Chrome/Chromium processes that may have been left behind.
 * This is a best-effort cleanup to prevent resource leaks.
 * Skipped in parallel child processes (BENCH_PARALLEL_CHILD=1) to avoid
 * killing browsers still in use by sibling conditions.
 */
export function killOrphanedBrowsers(): void {
  if (process.env.BENCH_PARALLEL_CHILD === "1") return;
  try {
    // Only kill headless Chrome processes that were likely spawned by the benchmark
    execSync("pkill -f 'chrome.*--headless' 2>/dev/null || true", {
      encoding: "utf-8",
      timeout: 5_000,
      stdio: "pipe",
    });
  } catch {
    // Best effort — ignore failures
  }
}
