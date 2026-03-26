/**
 * Benchmark runner — executes agent tasks and grades results.
 *
 * Per RunSpec:
 * 1. Create artifact dir: results/{condition}/{task}/{runN}/
 * 2. Write condition-specific AGENTS.md to workspace seed
 * 3. Run agent (codex or claude) in the workspace
 * 4. Parse JSONL output → usage metrics
 * 5. Run grader → grade.json
 * 6. Append to results.jsonl
 */

import { execSync, type ExecSyncOptionsWithStringEncoding } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import type { RunSpec, RunResult, ConditionDef, TaskDef, AgentBackend } from "./types.js";
import { parseCodexJsonl, parseClaudeJsonl } from "./usage.js";
import { grade } from "./grader.js";

const BENCH_ROOT = resolve(import.meta.dirname, "..");
const RESULTS_DIR = join(BENCH_ROOT, "results");
const REPO_URL = "https://github.com/openclaw/openclaw.git";

export function runOne(
  spec: RunSpec,
  condition: ConditionDef,
  task: TaskDef,
): RunResult {
  // 1. Create artifact dir
  const artifactDir = join(RESULTS_DIR, spec.condition, spec.task, `run${spec.run}`);
  mkdirSync(artifactDir, { recursive: true });

  // 2. Set up workspace: shallow-clone openclaw/openclaw so the agent runs
  //    inside a real repo with git remotes.
  const workspaceDir = join(artifactDir, "workspace");

  try {
    if (!existsSync(join(workspaceDir, ".git"))) {
      console.log("  Cloning openclaw/openclaw (shallow)...");
      execSync(`git clone --depth 1 ${REPO_URL} ${workspaceDir}`, {
        stdio: "pipe",
      });
    }
    // Drop AGENTS.md (for codex) and CLAUDE.md (for claude) on top of the clone
    writeFileSync(join(workspaceDir, "AGENTS.md"), condition.agents_md);
    writeFileSync(join(workspaceDir, "CLAUDE.md"), condition.agents_md);

    // Copy gh-code wrapper library into workspace for mcp_with_code_mode condition
    if (spec.condition === "mcp-with-code-mode") {
      const ghCodeSrc = join(BENCH_ROOT, "lib", "gh-code");
      const ghCodeDst = join(workspaceDir, "gh-code");
      execSync(`cp -r ${ghCodeSrc} ${ghCodeDst}`, { stdio: "pipe" });
    }

    const agent = spec.agent ?? "codex";

    // 3. Run agent
    const { agentOutput, wallClockSeconds } = runAgent(spec, condition, task, artifactDir, workspaceDir);

    // Save raw output
    writeFileSync(join(artifactDir, "agent_output.txt"), agentOutput);

    // 4. Parse usage
    const usage = agent === "claude"
      ? parseClaudeJsonl(agentOutput, { model: spec.model, wallClockSeconds })
      : parseCodexJsonl(agentOutput, { model: spec.model, wallClockSeconds });

    // Extract final text output for the result record
    const finalOutput = agent === "claude"
      ? extractClaudeFinalOutput(agentOutput)
      : extractFinalOutput(agentOutput);

    // 5. Grade — pass raw JSONL so the judge sees the full trajectory
    const gradeResult = grade(task.grading, task.prompt, agentOutput, agent, artifactDir);
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
    // Always remove workspace to avoid leaving massive cloned repos on disk.
    // The workspace is only needed during agent execution and grading; all
    // useful artifacts (agent_output.txt, grade.json, etc.) are saved outside it.
    if (existsSync(workspaceDir)) {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  }
}

/** Extract the agent's final text output from Codex JSONL stream. */
function extractFinalOutput(jsonl: string): string {
  const parts: string[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      // message events contain the agent's text output
      if (entry.type === "message" || entry.type === "response") {
        const content = entry.content ?? entry.text ?? "";
        if (typeof content === "string" && content) parts.push(content);
      }
      // item.completed with type "message" contains assistant text
      if (entry.type === "item.completed") {
        const item = (entry.item ?? {}) as Record<string, unknown>;
        if (item.type === "message" && typeof item.text === "string") {
          parts.push(item.text);
        }
      }
    } catch {
      continue;
    }
  }
  // If we couldn't extract structured output, fall back to the raw JSONL
  return parts.length > 0 ? parts.join("\n") : jsonl;
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
  const agent = spec.agent ?? "codex";

  let cmd: string[];

  if (agent === "claude") {
    // Ensure GH_TOKEN is set for conditions that need it (MCP, code-mode)
    if (!process.env.GH_TOKEN) {
      process.env.GH_TOKEN = execSync("gh auth token", { encoding: "utf-8" }).trim();
    }

    // Handle MCP condition for claude: create mcp-config file
    const mcpArgs: string[] = [];
    if (condition.id === "mcp-with-toolsearch" || condition.id === "mcp-no-toolsearch") {
      const ghToken = process.env.GH_TOKEN;
      const mcpConfig = {
        mcpServers: {
          github: {
            type: "http",
            url: "https://api.githubcopilot.com/mcp/",
            headers: { Authorization: `Bearer ${ghToken}` },
          },
        },
      };
      const mcpConfigPath = join(artifactDir, ".mcp-config.json");
      writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig));
      mcpArgs.push("--mcp-config", mcpConfigPath);
      if (condition.id === "mcp-no-toolsearch") {
        // Disable ToolSearch so MCP tools are loaded upfront into context
        mcpArgs.push("--disallowedTools", "ToolSearch");
      }
    }

    cmd = [
      "claude", "-p", JSON.stringify(task.prompt),
      "--model", spec.model,
      "--output-format", "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--no-session-persistence",
      "--allowedTools", "Bash", "Read", "Edit", "Glob", "Grep", "Agent", "WebFetch", "WebSearch",
      ...mcpArgs,
    ];
  } else {
    // Codex: register MCP server if needed
    if (condition.setup_commands) {
      for (const setupCmd of condition.setup_commands) {
        try {
          execSync(setupCmd, { encoding: "utf-8", cwd: workspaceDir, stdio: "pipe" });
        } catch {
          // MCP registration may fail if already registered; continue
        }
      }
    }

    cmd = [
      "codex", "exec", "--json",
      "--model", spec.model,
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "-C", workspaceDir,
      "--ephemeral",
      JSON.stringify(task.prompt),
    ];
  }

  const startTime = Date.now();
  let agentOutput = "";
  try {
    agentOutput = execSync(cmd.join(" "), {
      encoding: "utf-8",
      timeout: 5 * 60 * 1000,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      cwd: workspaceDir,
    } as ExecSyncOptionsWithStringEncoding);
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string };
    agentOutput = execErr.stdout ?? "";
    const stderr = execErr.stderr ?? "";
    writeFileSync(join(artifactDir, "stderr.txt"), stderr);
  }
  return { agentOutput, wallClockSeconds: (Date.now() - startTime) / 1000 };
}
