/**
 * HTTP client for the chrome-devtools-axi bridge + bridge lifecycle management.
 */

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { request } from "node:http";

const STATE_DIR = join(homedir(), ".chrome-devtools-axi");
const PID_FILE = join(STATE_DIR, "bridge.pid");
const DEFAULT_PORT = 9224;

export type ErrorCode =
  | "BRIDGE_NOT_READY"
  | "REF_NOT_FOUND"
  | "TIMEOUT"
  | "BROWSER_ERROR"
  | "VALIDATION_ERROR"
  | "UNKNOWN";

export class CdpError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly suggestions: string[] = [],
  ) {
    super(message);
    this.name = "CdpError";
  }
}

interface PidInfo {
  pid: number;
  port: number;
}

function readPidFile(): PidInfo | null {
  try {
    if (!existsSync(PID_FILE)) return null;
    const data = JSON.parse(readFileSync(PID_FILE, "utf-8"));
    if (typeof data.pid === "number" && typeof data.port === "number") {
      return data as PidInfo;
    }
    return null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function httpGet(port: number, path: string, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: "127.0.0.1", port, path, method: "GET", timeout: timeoutMs },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.end();
  });
}

function httpPost(port: number, path: string, body: unknown, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        timeout: timeoutMs,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(data));
          } else {
            resolve(data);
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.write(payload);
    req.end();
  });
}

async function checkBridgeHealth(port: number): Promise<boolean> {
  try {
    const resp = await httpGet(port, "/health");
    const data = JSON.parse(resp);
    return data.status === "ok";
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Ensure the bridge is running, starting it if needed. Returns the port.
 */
export async function ensureBridge(): Promise<number> {
  const port = parseInt(process.env.CHROME_DEVTOOLS_AXI_PORT ?? String(DEFAULT_PORT), 10);

  // Check existing bridge via PID file
  const pidInfo = readPidFile();
  if (pidInfo && isProcessAlive(pidInfo.pid)) {
    if (await checkBridgeHealth(pidInfo.port)) {
      return pidInfo.port;
    }
  }

  // Start a new bridge
  console.error("[chrome-devtools-axi] Starting browser...");

  const bridgeScript = resolve(import.meta.dirname, "bridge.js");
  // Try .ts first (dev mode), fall back to .js (built)
  const script = existsSync(bridgeScript.replace(/\.js$/, ".ts"))
    ? bridgeScript.replace(/\.js$/, ".ts")
    : bridgeScript;
  const runner = script.endsWith(".ts") ? "tsx" : "node";

  const child = spawn(runner === "tsx" ? "npx" : "node", runner === "tsx" ? ["tsx", script] : [script], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, CHROME_DEVTOOLS_AXI_PORT: String(port) },
    detached: true,
  });
  child.unref();
  // Detach stdin so parent can exit
  child.stdin?.end();

  // Poll for health (max 30s — Chrome launch can be slow)
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await checkBridgeHealth(port)) {
      return port;
    }
    await sleep(500);
  }

  throw new CdpError(
    "Bridge failed to start within 30s",
    "BRIDGE_NOT_READY",
    ["Check that chrome-devtools-mcp is installed: npx chrome-devtools-mcp@latest --help"],
  );
}

/**
 * Call an MCP tool via the bridge. Returns the text result.
 */
export async function callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const port = await ensureBridge();

  try {
    const resp = await httpPost(port, "/call", { name, args });
    const data = JSON.parse(resp);
    if (data.error) {
      throw new Error(data.error);
    }
    return data.result ?? "";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw mapError(message);
  }
}

function mapError(message: string): CdpError {
  if (message.includes("ECONNREFUSED") || message.includes("ECONNRESET")) {
    return new CdpError("Bridge is not running", "BRIDGE_NOT_READY", [
      "Run `chrome-devtools-axi open <url>` — the bridge starts automatically",
    ]);
  }
  if ((message.includes("uid") || message.includes("element")) &&
      (message.includes("not found") || message.includes("invalid"))) {
    return new CdpError(message, "REF_NOT_FOUND", [
      "Run `chrome-devtools-axi snapshot` to see available elements and their @uid refs",
    ]);
  }
  if (message.includes("timeout") || message.includes("timed out")) {
    return new CdpError(message, "TIMEOUT", [
      "Run `chrome-devtools-axi snapshot` to see current page state",
    ]);
  }
  // Try to parse JSON error
  try {
    const parsed = JSON.parse(message);
    if (parsed.error) {
      return new CdpError(parsed.error, "BROWSER_ERROR", [
        "Run `chrome-devtools-axi snapshot` to see current page state",
      ]);
    }
  } catch {
    // Not JSON
  }
  return new CdpError(message, "UNKNOWN");
}

/**
 * Stop the bridge process.
 */
export async function stopBridge(): Promise<void> {
  const pidInfo = readPidFile();
  if (!pidInfo) {
    return;
  }
  if (isProcessAlive(pidInfo.pid)) {
    process.kill(pidInfo.pid, "SIGTERM");
  }
  // PID file is cleaned up by the bridge on shutdown
}
