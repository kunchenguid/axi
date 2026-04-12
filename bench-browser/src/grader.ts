/**
 * LLM-as-Judge grading.
 *
 * After the benchmark agent finishes, the grader spawns a separate LLM call
 * to evaluate the agent's trajectory and determine whether it completed the task.
 *
 * Adapted from bench-github/src/grader.ts — domain-agnostic logic.
 */

import { execFileSync, execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolveClaudeAuth, type ClaudeAuthMode } from "./claude-auth.js";
import type { GradingSpec, GradeResult } from "./types.js";

const CLAUDE_JUDGE_MODEL = "claude-sonnet-4-6";
const MAX_JUDGE_RETRIES = 3;
const JUDGE_RETRY_BACKOFF_MS = [10_000, 30_000, 60_000];
const TOOL_OUTPUT_LIMIT = 30_000;


/**
 * Format raw JSONL from the agent run into a readable trajectory transcript.
 *
 * Extracts commands, their outputs/exit codes, and agent text messages.
 */
export function formatTrajectory(jsonl: string): string {
  const parts: string[] = [];

  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    // Claude: assistant messages with content blocks
    if (entry.type === "assistant") {
      const msg = (entry.message ?? {}) as Record<string, unknown>;
      const content = msg.content as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && typeof block.text === "string") {
            parts.push(`AGENT: ${block.text}`);
            parts.push("");
          }
          if (block.type === "tool_use") {
            const input = (block.input ?? {}) as Record<string, unknown>;
            if (block.name === "Bash" && typeof input.command === "string") {
              parts.push(`COMMAND: ${input.command}`);
            } else {
              parts.push(`TOOL_CALL: ${block.name}(${JSON.stringify(input)})`);
            }
          }
        }
      }
    }

    // Claude: tool results
    if (entry.type === "user") {
      const msg = (entry.message ?? {}) as Record<string, unknown>;
      const content = msg.content as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_result") {
            if (typeof block.content === "string") {
              const truncated = block.content.length > TOOL_OUTPUT_LIMIT;
              parts.push(`OUTPUT: ${block.content.slice(0, TOOL_OUTPUT_LIMIT)}${truncated ? ` [TRUNCATED from ${block.content.length} chars]` : ""}`);
            } else if (Array.isArray(block.content)) {
              // MCP tool results return an array of {type, text|image} objects
              const text = (block.content as Array<Record<string, unknown>>)
                .filter((c) => c.type !== "image") // Skip base64 image data
                .map((c) => (typeof c.text === "string" ? c.text : JSON.stringify(c)))
                .join("\n");
              const truncated = text.length > TOOL_OUTPUT_LIMIT;
              parts.push(`OUTPUT: ${text.slice(0, TOOL_OUTPUT_LIMIT)}${truncated ? ` [TRUNCATED from ${text.length} chars]` : ""}`);
            }
            parts.push("");
          }
        }
      }
    }

    // Claude: result event with final answer
    if (entry.type === "result" && typeof entry.result === "string") {
      parts.push(`AGENT: ${entry.result}`);
      parts.push("");
    }
  }

  const raw = parts.join("\n").trim();
  // Strip <system-reminder> tags that leak from Read tool outputs into the trajectory
  const sanitized = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "[system content stripped]")
    // Strip null bytes — MCP tool outputs sometimes contain them, and they cause
    // ERR_INVALID_ARG_VALUE when the prompt is passed as a CLI argument.
    .replace(/\0/g, "");
  return sanitized || "(empty trajectory)";
}

/**
 * Build the grading prompt for the LLM judge.
 */
export function buildGradingPrompt(
  taskPrompt: string,
  trajectory: string,
  gradingHint?: string,
): string {
  const hintSection = gradingHint ? `\nKNOWN FACTS: ${gradingHint}\n` : "";

  return `You are a benchmark grader evaluating whether an AI agent completed a browser automation task.

TASK: ${taskPrompt}
${hintSection}
AGENT TRAJECTORY:
${trajectory}

Rules:
- PASS if the agent navigated to the correct pages AND produced a correct, complete answer
- FAIL if the agent hallucinated data without actually browsing to the page
- FAIL if the agent browsed but misinterpreted the page content
- FAIL if the agent gave a partial answer when a complete one was requested
- For error recovery tasks, PASS if the agent correctly identified the error and then recovered
- For multi-step tasks, PASS only if all steps were completed

Respond with exactly: {"pass": true, "reason": "..."} or {"pass": false, "reason": "..."}`;
}

/**
 * Grade the agent's run by invoking a separate Claude call as judge.
 */
export function grade(
  spec: GradingSpec,
  taskPrompt: string,
  rawJsonl: string,
  artifactDir?: string,
  claudeAuthMode: ClaudeAuthMode = "env",
): GradeResult {
  const trajectory = formatTrajectory(rawJsonl);
  const prompt = buildGradingPrompt(taskPrompt, trajectory, spec.grading_hint);
  const judgeEnv = resolveClaudeAuth(claudeAuthMode, process.env).env;

  let judgeOutput: string = "";
  let lastError: string = "";

  for (let attempt = 0; attempt <= MAX_JUDGE_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoffMs = JUDGE_RETRY_BACKOFF_MS[attempt - 1] ?? 60_000;
      console.log(`  [grader] Retry ${attempt}/${MAX_JUDGE_RETRIES} after ${backoffMs / 1000}s backoff...`);
      execSync(`sleep ${backoffMs / 1000}`, { stdio: "pipe" });
    }

    try {
      judgeOutput = execFileSync(
        "claude",
        ["--setting-sources", "", "-p", prompt, "--model", CLAUDE_JUDGE_MODEL, "--output-format", "text", "--max-turns", "1", "--dangerously-skip-permissions", "--no-session-persistence"],
        {
          encoding: "utf-8",
          timeout: 120 * 1000,
          maxBuffer: 50 * 1024 * 1024,
          stdio: ["pipe", "pipe", "pipe"],
          env: judgeEnv,
        },
      );
      break; // Success
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string };
      judgeOutput = execErr.stdout ?? "";
      lastError = execErr.stderr ?? "unknown error";
      // If we got stdout content, treat as valid even on non-zero exit
      if (judgeOutput) break;
      // Otherwise retry
    }
  }

  if (!judgeOutput) {
    return {
      task_success: false,
      details: `Judge process failed after ${MAX_JUDGE_RETRIES} retries: ${lastError}`,
      failure_reason: "judge_error",
      judge_model: CLAUDE_JUDGE_MODEL,
    };
  }

  // Save judge trajectory for auditability
  if (artifactDir) {
    writeFileSync(`${artifactDir}/judge_output.txt`, judgeOutput);
    writeFileSync(`${artifactDir}/judge_model.txt`, CLAUDE_JUDGE_MODEL);
  }

  const verdict = extractVerdict(judgeOutput);
  if (!verdict) {
    return {
      task_success: false,
      details: `Could not parse judge verdict from output: ${judgeOutput.slice(0, 500)}`,
      failure_reason: "judge_parse_error",
      judge_model: CLAUDE_JUDGE_MODEL,
    };
  }

  return {
    task_success: verdict.pass,
    details: verdict.reason,
    failure_reason: verdict.pass ? undefined : "task_failure",
    judge_model: CLAUDE_JUDGE_MODEL,
  };
}

interface JudgeVerdict {
  pass: boolean;
  reason: string;
}

/**
 * Extract {"pass": bool, "reason": "..."} from the judge's output.
 * Handles both raw text and JSONL-wrapped responses.
 */
function extractVerdict(output: string): JudgeVerdict | null {
  // Strip markdown code fences (Claude judge wraps JSON in ```json ... ```)
  const stripped = output.replace(/```json\s*/g, "").replace(/```\s*/g, "");

  // Try to parse the stripped output directly as JSON first
  try {
    const direct = JSON.parse(stripped.trim()) as JudgeVerdict;
    if (typeof direct.pass === "boolean") {
      return { pass: direct.pass, reason: direct.reason ?? "" };
    }
  } catch {
    // fall through
  }

  // Try to find a JSON object with "pass" field anywhere in the output.
  const match = stripped.match(/\{\s*"pass"\s*:\s*(true|false)\s*,\s*"reason"\s*:\s*".*?"\s*\}/s)
    ?? stripped.match(/\{\s*"reason"\s*:\s*".*?"\s*,\s*"pass"\s*:\s*(true|false)\s*\}/s);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as JudgeVerdict;
      if (typeof parsed.pass === "boolean") {
        return { pass: parsed.pass, reason: parsed.reason ?? "" };
      }
    } catch {
      // fall through
    }
  }

  // Try parsing each JSONL line for message content containing the verdict
  for (const line of stripped.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      // Check direct content/text fields
      for (const field of ["content", "text"]) {
        if (typeof entry[field] === "string") {
          const nested = extractVerdict(entry[field] as string);
          if (nested) return nested;
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}
