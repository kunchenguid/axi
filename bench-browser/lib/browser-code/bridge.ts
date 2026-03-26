#!/usr/bin/env tsx
/**
 * Persistent MCP bridge server for code-mode benchmarks.
 *
 * Spawns chrome-devtools-mcp as a child process and maintains a single
 * persistent MCP session. Exposes a simple HTTP API:
 *   POST /call  { name, args }  → { result }
 *   GET  /tools                 → [{ name, description }]
 *   GET  /health                → "ok"
 *
 * Usage:
 *   npx tsx browser-code/bridge.ts &    # start in background
 *   # ... agent scripts call http://127.0.0.1:9223/call
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer } from "node:http";

const PORT = parseInt(process.env.BROWSER_CODE_BRIDGE_PORT ?? "9223", 10);

async function main() {
  // Connect to chrome-devtools-mcp via stdio
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "chrome-devtools-mcp@latest", "--headless", "--isolated"],
  });
  const client = new Client({ name: "browser-code-bridge", version: "1.0.0" });
  await client.connect(transport);
  console.error(`[bridge] Connected to chrome-devtools-mcp`);

  const server = createServer(async (req, res) => {
    // CORS headers (not needed but harmless)
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
    console.error(`[bridge] Listening on http://127.0.0.1:${PORT}`);
    // Signal readiness to parent
    console.log("READY");
  });

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    server.close();
    await client.close();
    await transport.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(`[bridge] Fatal: ${err}`);
  process.exit(1);
});
