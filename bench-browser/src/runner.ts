/**
 * Benchmark runner — executes browser agent tasks and grades results.
 *
 * Per RunSpec:
 * 1. Create artifact dir: results/{condition}/{task}/{runN}/
 * 2. Create workspace with condition-specific CLAUDE.md
 * 3. Run Claude agent with MCP isolation (--strict-mcp-config)
 * 4. Parse JSONL output -> usage metrics
 * 5. Run grader -> grade.json
 * 6. Append to results.jsonl
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import type { RunSpec, RunResult, ConditionDef, TaskDef } from "./types.js";
import { parseClaudeJsonl } from "./usage.js";
import { grade } from "./grader.js";

const BENCH_ROOT = resolve(import.meta.dirname, "..");
const RESULTS_DIR = join(BENCH_ROOT, "results");


export function runOne(
  spec: RunSpec,
  condition: ConditionDef,
  task: TaskDef,
): RunResult {
  // 1. Create artifact dir
  const artifactDir = join(RESULTS_DIR, spec.condition, spec.task, `run${spec.run}`);
  mkdirSync(artifactDir, { recursive: true });

  // 2. Set up workspace: just a directory with CLAUDE.md (no repo clone needed)
  const workspaceDir = join(artifactDir, "workspace");

  try {
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(join(workspaceDir, "CLAUDE.md"), condition.agents_md);

    // Write MCP config for chrome-devtools-mcp condition
    if (condition.mcp_config) {
      writeFileSync(
        join(artifactDir, ".mcp-config.json"),
        JSON.stringify(condition.mcp_config),
      );
    }

    // Write empty MCP config for CLI conditions (used with --strict-mcp-config
    // to prevent user's local MCP servers from leaking in)
    const emptyMcpConfigPath = join(artifactDir, ".empty-mcp-config.json");
    writeFileSync(emptyMcpConfigPath, JSON.stringify({ mcpServers: {} }));

    // Copy browser-code wrapper library into workspace for code-mode condition
    if (spec.condition === "chrome-devtools-mcp-code") {
      const browserCodeSrc = join(BENCH_ROOT, "lib", "browser-code");
      const browserCodeDst = join(workspaceDir, "browser-code");
      execSync(`cp -r ${browserCodeSrc} ${browserCodeDst}`, { stdio: "pipe" });
    }

    // 3. Run agent
    const { agentOutput, wallClockSeconds } = runAgent(spec, condition, task, artifactDir, workspaceDir);

    // Save raw output
    writeFileSync(join(artifactDir, "agent_output.txt"), agentOutput);

    // 4. Parse usage
    const usage = parseClaudeJsonl(agentOutput, { model: spec.model, wallClockSeconds });

    // Extract final text output for the result record
    const finalOutput = extractClaudeFinalOutput(agentOutput);

    // 5. Grade — pass raw JSONL so the judge sees the full trajectory
    const gradeResult = grade(task.grading, task.prompt, agentOutput, artifactDir);
    writeFileSync(join(artifactDir, "grade.json"), JSON.stringify(gradeResult, null, 2));

    // 6. Build result
    const result: RunResult = {
      condition: spec.condition,
      task: spec.task,
      run: spec.run,
      model: spec.model,
      timestamp: new Date().toISOString(),
      usage,
      grade: gradeResult,
      agent_output: finalOutput.slice(0, 2000), // Truncate for JSONL
    };

    // 7. Append to results.jsonl
    const resultsJsonl = join(RESULTS_DIR, "results.jsonl");
    appendFileSync(resultsJsonl, JSON.stringify(result) + "\n");

    return result;
  } finally {
    // Always remove workspace to avoid leaving browser data on disk
    if (existsSync(workspaceDir)) {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  }
}

/** Extract the agent's final text output from Claude stream-json output. */
function extractClaudeFinalOutput(jsonl: string): string {
  const parts: string[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      // result event contains the final text
      if (entry.type === "result" && typeof entry.result === "string") {
        return entry.result;
      }
      // assistant message events with text content
      if (entry.type === "assistant") {
        const msg = entry.message as Record<string, unknown> | undefined;
        if (msg && Array.isArray(msg.content)) {
          for (const block of msg.content) {
            const b = block as Record<string, unknown>;
            if (b.type === "text" && typeof b.text === "string") {
              parts.push(b.text);
            }
          }
        }
      }
    } catch {
      continue;
    }
  }
  return parts.length > 0 ? parts.join("\n") : jsonl;
}

function runAgent(
  spec: RunSpec,
  condition: ConditionDef,
  task: TaskDef,
  artifactDir: string,
  workspaceDir: string,
): { agentOutput: string; wallClockSeconds: number } {
  // Build Claude CLI args array (using execFileSync to avoid shell interpretation
  // of backticks and angle brackets in the system prompt)
  const args: string[] = [
    "--setting-sources", "''",
    "-p", task.prompt,
    "--model", spec.model,
    "--output-format", "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--no-session-persistence",
    "--append-system-prompt", condition.agents_md,
    "--disable-slash-commands",
  ];

  if (condition.id === "chrome-devtools-mcp") {
    // MCP without ToolSearch: tools loaded upfront into context
    const mcpConfigPath = join(artifactDir, ".mcp-config.json");
    args.push(
      "--strict-mcp-config",
      "--mcp-config", mcpConfigPath,
      "--allowedTools", "Read,Write",
      "--disallowedTools", "ToolSearch",
    );
  } else if (condition.id === "chrome-devtools-mcp-search") {
    // MCP with ToolSearch: tools discovered on demand
    const mcpConfigPath = join(artifactDir, ".mcp-config.json");
    args.push(
      "--strict-mcp-config",
      "--mcp-config", mcpConfigPath,
      "--allowedTools", "Read,Write",
    );
  } else if (condition.id === "chrome-devtools-mcp-code") {
    // Code execution: agent writes TypeScript scripts using browser-code library.
    // Needs Bash to run scripts, plus a headless Chrome on :9222.
    const emptyMcpConfigPath = join(artifactDir, ".empty-mcp-config.json");
    args.push(
      "--strict-mcp-config",
      "--mcp-config", emptyMcpConfigPath,
      "--allowedTools", "Bash,Read,Write",
    );
  } else if (condition.mcp_compressor) {
    // MCP Compressor wrapper mode: wraps backend MCP server via uvx mcp-compressor.
    // Agent gets compressed MCP tools (list_tools, get_tool_schema, invoke_tool).
    const { level, server_name, cli_mode, backend_command } = condition.mcp_compressor;
    // mcp-compressor flags go before `--`, backend command goes after.
    // Without `--`, flags like `-y` from `npx -y` are parsed by mcp-compressor.
    const compressorArgs = [
      "mcp-compressor",
      "-c", level,
    ];
    if (server_name) {
      compressorArgs.push("--server-name", server_name);
    }
    if (cli_mode) {
      compressorArgs.push("--cli-mode");
    }
    compressorArgs.push("--", ...(backend_command ?? []));
    const mcpConfig = {
      mcpServers: {
        "compressed-browser": {
          command: "uvx",
          args: compressorArgs,
        },
      },
    };
    const mcpConfigPath = join(artifactDir, ".mcp-config.json");
    writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig));
    // Wrapper mode: agent uses MCP tools. CLI mode: agent uses Bash.
    const allowedTools = cli_mode ? "Bash,Read,Write" : "Read,Write";
    args.push(
      "--strict-mcp-config",
      "--mcp-config", mcpConfigPath,
      "--allowedTools", allowedTools,
    );
  } else {
    // CLI conditions: --strict-mcp-config with empty config prevents user's
    // local MCP servers (e.g. chrome-devtools-mcp) from leaking in
    const emptyMcpConfigPath = join(artifactDir, ".empty-mcp-config.json");
    args.push(
      "--strict-mcp-config",
      "--mcp-config", emptyMcpConfigPath,
      "--allowedTools", "Bash,Read,Write",
    );
  }

  const startTime = Date.now();
  let agentOutput = "";
  try {
    agentOutput = execFileSync("claude", args, {
      encoding: "utf-8",
      timeout: 5 * 60 * 1000,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      cwd: workspaceDir,
    });
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string };
    agentOutput = execErr.stdout ?? "";
    const stderr = execErr.stderr ?? "";
    writeFileSync(join(artifactDir, "stderr.txt"), stderr);
  }
  return { agentOutput, wallClockSeconds: (Date.now() - startTime) / 1000 };
}
