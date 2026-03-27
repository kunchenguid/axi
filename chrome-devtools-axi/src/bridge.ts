#!/usr/bin/env tsx
/**
 * Persistent MCP bridge server for chrome-devtools-axi.
 *
 * Spawns chrome-devtools-mcp as a child process and maintains a single
 * persistent MCP session. Exposes a simple HTTP API:
 *   POST /call  { name, args }  → { result }
 *   GET  /tools                 → [{ name, description }]
 *   GET  /health                → { status: "ok" }
 *
 * Writes a PID file to ~/.chrome-devtools-axi/bridge.pid on startup.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PORT = parseInt(process.env.CHROME_DEVTOOLS_AXI_PORT ?? "9224", 10);
const STATE_DIR = join(homedir(), ".chrome-devtools-axi");
const PID_FILE = join(STATE_DIR, "bridge.pid");

function writePidFile(port: number): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(PID_FILE, JSON.stringify({ pid: process.pid, port }));
}

function removePidFile(): void {
  try {
    unlinkSync(PID_FILE);
  } catch {
    // Already gone — fine
  }
}

async function main() {
  // Connect to chrome-devtools-mcp via stdio
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "chrome-devtools-mcp@latest", "--headless", "--isolated"],
  });
  const client = new Client({ name: "chrome-devtools-axi-bridge", version: "1.0.0" });
  await client.connect(transport);
  console.error(`[chrome-devtools-axi] Connected to chrome-devtools-mcp`);

  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");

    if (req.method === "GET" && req.url === "/health") {
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (req.method === "GET" && req.url === "/tools") {
      try {
        const result = await client.listTools();
        const tools = result.tools.map((t) => ({
          name: t.name,
          description: t.description,
        }));
        res.end(JSON.stringify(tools));
      } catch (err: any) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (req.method === "POST" && req.url === "/call") {
      let body = "";
      for await (const chunk of req) body += chunk;
      try {
        const { name, args } = JSON.parse(body);
        const result = await client.callTool({ name, arguments: args ?? {} });
        const parts: string[] = [];
        for (const block of result.content as Array<{ type: string; text?: string }>) {
          if (block.type === "text" && block.text) parts.push(block.text);
        }
        res.end(JSON.stringify({ result: parts.join("\n") }));
      } catch (err: any) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });

  server.listen(PORT, "127.0.0.1", () => {
    writePidFile(PORT);
    console.error(`[chrome-devtools-axi] Listening on http://127.0.0.1:${PORT}`);
    // Signal readiness to parent
    console.log("READY");
  });

  // Graceful shutdown
  const shutdown = async () => {
    removePidFile();
    server.close();
    await client.close();
    await transport.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error(`[chrome-devtools-axi] Fatal: ${err}`);
  removePidFile();
  process.exit(1);
});
