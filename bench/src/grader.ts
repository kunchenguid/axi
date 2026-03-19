/**
 * LLM-as-Judge grading.
 *
 * After the benchmark agent finishes, the grader spawns a separate LLM call
 * to evaluate the agent's trajectory and determine whether it completed the task.
 * Supports both codex (gpt-5.4-mini) and claude (haiku) as judge backends.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { AgentBackend, GradingSpec, GradeResult } from "./types.js";

const CODEX_JUDGE_MODEL = "gpt-5.4-mini";
const CLAUDE_JUDGE_MODEL = "claude-sonnet-4-6";

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

    if (entry.type === "item.completed") {
      const item = (entry.item ?? {}) as Record<string, unknown>;

      if (item.type === "command_execution") {
        parts.push(`COMMAND: ${item.command ?? "(unknown)"}`);
        const output = item.aggregated_output ?? item.output;
        if (output != null) {
          parts.push(`OUTPUT: ${String(output)}`);
        }
        parts.push(`EXIT_CODE: ${item.exit_code ?? 0}`);
        parts.push("");
      }

      if ((item.type === "message" || item.type === "agent_message") && typeof item.text === "string") {
        parts.push(`AGENT: ${item.text}`);
        parts.push("");
      }
    }

    // Also capture top-level message/response events (codex)
    if (entry.type === "message" || entry.type === "response") {
      const content = entry.content ?? entry.text ?? "";
      if (typeof content === "string" && content) {
        parts.push(`AGENT: ${content}`);
        parts.push("");
      }
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
              parts.push(`OUTPUT: ${block.content}`);
            } else if (Array.isArray(block.content)) {
              // MCP tool results return an array of {type, text} objects
              const text = (block.content as Array<Record<string, unknown>>)
                .map((c) => (typeof c.text === "string" ? c.text : JSON.stringify(c)))
                .join("\n");
              parts.push(`OUTPUT: ${text}`);
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

  return parts.join("\n").trim() || "(empty trajectory)";
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

  return `You are a benchmark grader evaluating whether an AI agent completed a task.

TASK: ${taskPrompt}
${hintSection}
AGENT TRAJECTORY:
${trajectory}

Rules:
- PASS if the agent executed appropriate commands AND produced a correct, complete answer
- FAIL if the agent hallucinated data without running commands
- FAIL if the agent ran commands but misinterpreted the results
- FAIL if the agent gave a partial answer when a complete one was requested
- For error recovery tasks, PASS if the agent correctly identified and reported the error

Respond with exactly: {"pass": true, "reason": "..."} or {"pass": false, "reason": "..."}`;
}

/**
 * Grade the agent's run by invoking a separate codex exec call as judge.
 *
 * @param spec - Grading spec (may contain grading_hint)
 * @param taskPrompt - The original task prompt given to the agent
 * @param rawJsonl - Raw JSONL output from the agent's codex run
 */
export function grade(
  spec: GradingSpec,
  taskPrompt: string,
  rawJsonl: string,
  judgeBackend: AgentBackend = "codex",
  artifactDir?: string,
): GradeResult {
  const trajectory = formatTrajectory(rawJsonl);
  const prompt = buildGradingPrompt(taskPrompt, trajectory, spec.grading_hint);

  let judgeOutput: string;
  try {
    const { cmd, args } = judgeBackend === "claude"
      ? { cmd: "claude", args: ["-p", prompt, "--model", CLAUDE_JUDGE_MODEL, "--output-format", "text", "--max-turns", "1", "--dangerously-skip-permissions", "--no-session-persistence"] }
      : { cmd: "codex", args: ["exec", "--json", "--model", CODEX_JUDGE_MODEL, "--ephemeral", prompt] };
    judgeOutput = execFileSync(
      cmd,
      args,
      {
        encoding: "utf-8",
        timeout: 60 * 1000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string };
    judgeOutput = execErr.stdout ?? "";
    if (!judgeOutput) {
      return {
        task_success: false,
        details: `Judge process failed: ${execErr.stderr ?? "unknown error"}`,
      };
    }
  }

  // Save judge trajectory for auditability
  if (artifactDir) {
    const judgeModel = judgeBackend === "claude" ? CLAUDE_JUDGE_MODEL : CODEX_JUDGE_MODEL;
    writeFileSync(`${artifactDir}/judge_output.txt`, judgeOutput);
    writeFileSync(`${artifactDir}/judge_model.txt`, judgeModel);
  }

  // Extract the judge's JSON verdict from its output.
  // The judge may wrap its response in JSONL events, so we search for the
  // {"pass": ...} object in either raw text or JSONL message content.
  const verdict = extractVerdict(judgeOutput);
  if (!verdict) {
    return {
      task_success: false,
      details: `Could not parse judge verdict from output: ${judgeOutput.slice(0, 500)}`,
    };
  }

  return {
    task_success: verdict.pass,
    details: verdict.reason,
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
  // Use a greedy match that allows nested braces (e.g., in issue titles).
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
      // Check item.completed messages
      if (entry.type === "item.completed") {
        const item = (entry.item ?? {}) as Record<string, unknown>;
        if (typeof item.text === "string") {
          const nested = extractVerdict(item.text);
          if (nested) return nested;
        }
      }
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
