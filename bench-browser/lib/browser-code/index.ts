/**
 * Browser automation library for code-mode benchmarks.
 *
 * Thin wrapper that calls chrome-devtools-mcp tools via a local HTTP bridge.
 * The bridge (bridge.ts) maintains a persistent MCP session so browser state
 * persists across scripts.
 *
 * The agent must know tool names and build arguments — this library does NOT
 * provide high-level wrappers. This keeps the interface close to raw MCP,
 * isolating the "code execution" variable.
 *
 * Usage:
 *   import { callTool, listTools } from "./browser-code";
 *   const tools = await listTools();
 *   const result = await callTool("navigate_page", { url: "https://example.com" });
 *   console.log(result);
 */

const BRIDGE_URL = process.env.BROWSER_CODE_BRIDGE_URL ?? "http://127.0.0.1:9223";

/** List all available tools from the chrome-devtools-mcp server. */
export async function listTools(): Promise<Array<{ name: string; description?: string }>> {
  const res = await fetch(`${BRIDGE_URL}/tools`);
  if (!res.ok) throw new Error(`listTools failed: ${await res.text()}`);
  return res.json();
}

/**
 * Call an MCP tool by name with the given arguments.
 * Returns the text content of the tool result.
 *
 * Example:
 *   await callTool("navigate_page", { url: "https://example.com" })
 *   await callTool("take_snapshot")
 *   await callTool("click", { element: "@e1" })
 */
export async function callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const res = await fetch(`${BRIDGE_URL}/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, args }),
  });
  const data = await res.json() as { result?: string; error?: string };
  if (data.error) throw new Error(data.error);
  return data.result ?? "";
}
