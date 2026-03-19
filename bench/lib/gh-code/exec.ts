import { execFileSync } from "node:child_process";

const MCP_URL = "https://api.githubcopilot.com/mcp/";

function getToken(): string {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error("GH_TOKEN environment variable is required");
  return token;
}

/** Call a tool on the GitHub MCP server via HTTP and return parsed result. */
export function callMcpTool<T = any>(toolName: string, args: Record<string, unknown>): T {
  const token = getToken();

  const body = JSON.stringify({
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name: toolName, arguments: args },
    id: 1,
  });

  const raw = execFileSync("curl", [
    "-s", "-X", "POST", MCP_URL,
    "-H", `Authorization: Bearer ${token}`,
    "-H", "Content-Type: application/json",
    "-d", body,
  ], { encoding: "utf-8", timeout: 30000 });

  // The MCP endpoint returns SSE format: "event: message\ndata: {...}\n"
  // Extract JSON from the "data:" line.
  let jsonStr = raw;
  const dataMatch = raw.match(/^data: (.+)$/m);
  if (dataMatch) {
    jsonStr = dataMatch[1];
  }

  const response = JSON.parse(jsonStr);
  if (response.error) throw new Error(response.error.message);

  // MCP tool results come as content array with text fields
  const content = response.result?.content;
  if (content && content[0]?.text) {
    return JSON.parse(content[0].text) as T;
  }
  return response.result as T;
}

/** Call the GitHub REST API directly via curl. */
export function githubApi<T = any>(path: string): T {
  const token = getToken();

  const result = execFileSync("curl", [
    "-s",
    "-H", `Authorization: Bearer ${token}`,
    "-H", "Accept: application/vnd.github+json",
    `https://api.github.com${path}`,
  ], { encoding: "utf-8", timeout: 30000 });

  return JSON.parse(result) as T;
}
