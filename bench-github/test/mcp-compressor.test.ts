import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

import { buildMcpCompressorConfig } from "../src/runner.js";

const BENCH_ROOT = resolve(import.meta.dirname, "..");

describe("MCP Compressor benchmark conditions", () => {
  it("keeps every recovered compression mode in the condition catalog", () => {
    const raw = readFileSync(join(BENCH_ROOT, "config", "conditions.yaml"), "utf-8");
    const parsed = parseYaml(raw) as { conditions: Record<string, unknown> };

    expect(Object.keys(parsed.conditions)).toEqual(expect.arrayContaining([
      "mcp-compressed-low",
      "mcp-compressed-medium",
      "mcp-compressed-high",
      "mcp-compressed-max",
      "mcp-compressed-cli",
    ]));
  });

  it("builds a noninteractive stdio MCP config for CLI mode", () => {
    expect(buildMcpCompressorConfig({
      level: "medium",
      server_name: "github",
      cli_mode: true,
    }, "test-token")).toEqual({
      mcpServers: {
        "compressed-github": {
          command: "uvx",
          args: [
            "mcp-compressor",
            "https://api.githubcopilot.com/mcp/",
            "-H",
            "Authorization=Bearer test-token",
            "-c",
            "medium",
            "--server-name",
            "github",
            "--cli-mode",
          ],
        },
      },
    });
  });
});
