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
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import type { RunSpec, RunResult, ConditionDef, TaskDef } from "./types.js";
import { isActionbookConditionId, prewarmActionbookDaemon } from "./actionbook.js";
import { resolveClaudeAuth } from "./claude-auth.js";
import { parseClaudeJsonl } from "./usage.js";
import { grade } from "./grader.js";
import { validateCommandPolicy } from "./validation.js";

const BENCH_ROOT = resolve(import.meta.dirname, "..");
const RESULTS_DIR = join(BENCH_ROOT, "results");

function makeBrowserName(spec: Pick<RunSpec, "condition" | "task" | "run">): string {
  const raw = `axi-bench-${spec.condition}-${spec.task}-run${spec.run}`;
  return raw.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export function renderAgentsMd(
  spec: Pick<RunSpec, "condition" | "task" | "run">,
  condition: Pick<ConditionDef, "agents_md">,
): string {
  const browserName = makeBrowserName(spec);
  const devBrowserCommand = `dev-browser --headless --browser ${browserName}`;
  return condition.agents_md
    .replaceAll("__AXI_BENCH_BROWSER_NAME__", browserName)
    .replaceAll("__AXI_BENCH_DEV_BROWSER_CMD__", devBrowserCommand);
}

export function buildConditionEnv(
  condition: Pick<ConditionDef, "id">,
  artifactDir: string,
): Record<string, string> {
  if (!isActionbookConditionId(condition.id)) {
    return {};
  }

  const shortId = createHash("sha1").update(artifactDir).digest("hex").slice(0, 12);

  return {
    ACTIONBOOK_HOME: join("/tmp", `axi-ab-${shortId}`),
    ACTIONBOOK_BROWSER_MODE: "local",
    ACTIONBOOK_BROWSER_HEADLESS: "true",
  };
}

function cleanupActionbookHome(actionbookHome: string): void {
  const pidPath = join(actionbookHome, "daemon.pid");
  if (existsSync(pidPath)) {
    try {
      const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
      if (Number.isFinite(pid) && pid > 0) {
        process.kill(pid, "SIGTERM");
      }
    } catch {
      // Best-effort cleanup only.
    }
  }

  try {
    rmSync(actionbookHome, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup only.
  }
}

export function runOne(
  spec: RunSpec,
  condition: ConditionDef,
  task: TaskDef,
): RunResult {
  // 1. Create artifact dir
  const artifactDir = join(RESULTS_DIR, spec.condition, spec.task, `run${spec.run}`);
  mkdirSync(artifactDir, { recursive: true });
  const conditionEnv = buildConditionEnv(condition, artifactDir);
  if (conditionEnv.ACTIONBOOK_HOME) {
    mkdirSync(conditionEnv.ACTIONBOOK_HOME, { recursive: true });
    prewarmActionbookDaemon({ ...process.env, ...conditionEnv });
  }

  // 2. Set up workspace: just a directory with CLAUDE.md (no repo clone needed)
  const workspaceDir = join(artifactDir, "workspace");

  try {
    mkdirSync(workspaceDir, { recursive: true });
    const agentsMd = renderAgentsMd(spec, condition);
    // Written for workspace auditability only — not read by Claude (--setting-sources "" disables auto-discovery).
    // Agent receives this content via --append-system-prompt instead.
    writeFileSync(join(workspaceDir, "CLAUDE.md"), agentsMd);

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

    // Code-mode setup: copy browser-code client library, then run codegen
    // to generate strongly-typed MCP wrappers under servers/chrome-devtools/.
    if (spec.condition === "chrome-devtools-mcp-code") {
      const browserCodeSrc = join(BENCH_ROOT, "lib", "browser-code");
      const browserCodeDst = join(workspaceDir, "browser-code");
      execSync(`cp -r ${browserCodeSrc} ${browserCodeDst}`, { stdio: "pipe" });

      const codegenScript = join(BENCH_ROOT, "lib", "browser-code", "codegen.ts");
      const serversDir = join(workspaceDir, "servers", "chrome-devtools");
      execSync(`npx tsx ${codegenScript} ${serversDir}`, {
        stdio: "pipe",
        timeout: 30_000,
      });
    }

    // 3. Run agent
    const { agentOutput, wallClockSeconds } = runAgent(spec, condition, task, artifactDir, workspaceDir, agentsMd, conditionEnv);

    // Save raw output
    writeFileSync(join(artifactDir, "agent_output.txt"), agentOutput);

    // 4. Parse usage
    const usage = parseClaudeJsonl(agentOutput, { model: spec.model, wallClockSeconds });

    // Extract final text output for the result record
    const finalOutput = extractClaudeFinalOutput(agentOutput);

    // 5. Grade — pass raw JSONL so the judge sees the full trajectory
    const usageValidationError = validateCommandPolicy(condition, usage.command_log, agentOutput);
    const gradeResult = usageValidationError
      ? {
          task_success: false,
          details: usageValidationError,
          failure_reason: "policy_violation" as const,
        }
      : grade(
          task.grading,
          task.prompt,
          agentOutput,
          artifactDir,
          spec.claude_auth_mode ?? "auto",
        );
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

    // 7. Upsert into per-condition results file
    const conditionJsonl = join(RESULTS_DIR, `${spec.condition}.jsonl`);
    if (existsSync(conditionJsonl)) {
      const kept = readFileSync(conditionJsonl, "utf-8")
        .split("\n")
        .filter((l) => {
          if (!l.trim()) return false;
          try {
            const r = JSON.parse(l) as { task: string; run: number };
            return !(r.task === spec.task && r.run === spec.run);
          } catch { return true; }
        });
      writeFileSync(conditionJsonl, kept.length > 0 ? kept.join("\n") + "\n" : "");
    }
    appendFileSync(conditionJsonl, JSON.stringify(result) + "\n");

    return result;
  } finally {
    // Always remove workspace to avoid leaving browser data on disk
    if (existsSync(workspaceDir)) {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
    if (conditionEnv.ACTIONBOOK_HOME) {
      cleanupActionbookHome(conditionEnv.ACTIONBOOK_HOME);
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
  agentsMd: string,
  conditionEnv: Record<string, string>,
): { agentOutput: string; wallClockSeconds: number } {
  const auth = resolveClaudeAuth(
    spec.claude_auth_mode ?? "auto",
    { ...process.env, ...conditionEnv },
  );
  // Build Claude CLI args array (using execFileSync to avoid shell interpretation
  // of backticks and angle brackets in the system prompt)
  const args: string[] = [
    "--setting-sources", "",
    "-p", task.prompt,
    "--model", spec.model,
    "--output-format", "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--no-session-persistence",
    "--append-system-prompt", agentsMd,
    "--disable-slash-commands",
  ];

  // All conditions: disallow WebFetch/WebSearch so agents must use the
  // designated browser tool, not built-in fetch capabilities.
  const disallowedTools: string[] = ["WebFetch", "WebSearch"];

  if (condition.id === "chrome-devtools-mcp") {
    // MCP without ToolSearch: tools loaded upfront into context
    const mcpConfigPath = join(artifactDir, ".mcp-config.json");
    disallowedTools.push("ToolSearch");
    args.push(
      "--strict-mcp-config",
      "--mcp-config", mcpConfigPath,
      "--allowedTools", "Read,Write",
      "--disallowedTools", disallowedTools.join(","),
    );
  } else if (condition.id === "chrome-devtools-mcp-search") {
    // MCP with ToolSearch: tools discovered on demand
    const mcpConfigPath = join(artifactDir, ".mcp-config.json");
    args.push(
      "--strict-mcp-config",
      "--mcp-config", mcpConfigPath,
      "--allowedTools", "Read,Write",
      "--disallowedTools", disallowedTools.join(","),
    );
  } else if (condition.id === "chrome-devtools-mcp-code") {
    // Code execution: agent writes TypeScript scripts using browser-code library.
    // Needs Bash to run scripts, plus a headless Chrome on :9222.
    const emptyMcpConfigPath = join(artifactDir, ".empty-mcp-config.json");
    args.push(
      "--strict-mcp-config",
      "--mcp-config", emptyMcpConfigPath,
      "--allowedTools", "Bash,Read,Write",
      "--disallowedTools", disallowedTools.join(","),
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
      "--disallowedTools", disallowedTools.join(","),
    );
  } else {
    // CLI conditions: --strict-mcp-config with empty config prevents user's
    // local MCP servers (e.g. chrome-devtools-mcp) from leaking in
    const emptyMcpConfigPath = join(artifactDir, ".empty-mcp-config.json");
    args.push(
      "--strict-mcp-config",
      "--mcp-config", emptyMcpConfigPath,
      "--allowedTools", "Bash,Read,Write",
      "--disallowedTools", disallowedTools.join(","),
    );
  }

  const startTime = Date.now();
  let agentOutput = "";
  try {
    agentOutput = execFileSync("claude", args, {
      encoding: "utf-8",
      timeout: 5 * 60 * 1000,
      maxBuffer: 50 * 1024 * 1024, // 50MB — screenshots produce large base64 output
      stdio: ["pipe", "pipe", "pipe"],
      env: auth.env,
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
