/**
 * Parse Claude CLI `--output-format stream-json` JSONL output into usage metrics.
 *
 * Adapted from bench-github/src/usage.ts — Claude-only (no Codex support needed).
 *
 * Claude emits newline-delimited JSON with event types:
 *   - system (subtype: init) -> session initialization
 *   - assistant -> message with content blocks (text, tool_use, thinking)
 *   - tool_use / tool_result -> tool invocations
 *   - result (subtype: success) -> final summary with usage, cost, duration
 */

import type { UsageMetrics } from "./types.js";

interface ModelPricing {
  input: number; // $/1M uncached input tokens
  input_cached: number; // $/1M cached input tokens
  output: number; // $/1M output tokens
}

const OPUS_4_1_PRICING = { input: 15.0, input_cached: 1.5, output: 75.0 };
const OPUS_4_5_PRICING = { input: 5.0, input_cached: 0.5, output: 25.0 };
const HAIKU_4_5_PRICING = { input: 1.0, input_cached: 0.1, output: 5.0 };

const CLAUDE_PRICING_PER_1M: Record<string, ModelPricing> = {
  "claude-sonnet-4-6": { input: 3.0, input_cached: 0.3, output: 15.0 },
  "claude-sonnet-4-5-20250514": { input: 3.0, input_cached: 0.3, output: 15.0 },
  sonnet: { input: 3.0, input_cached: 0.3, output: 15.0 },
  "claude-opus-4-1": OPUS_4_1_PRICING,
  "claude-opus-4-5": OPUS_4_5_PRICING,
  "claude-opus-4-6": OPUS_4_5_PRICING,
  "claude-opus-4-7": OPUS_4_5_PRICING,
  "claude-opus-4-8": OPUS_4_5_PRICING,
  "claude-haiku-4-5-20251001": HAIKU_4_5_PRICING,
};

function getClaudePricing(model: string | undefined): ModelPricing {
  const entry = model ? CLAUDE_PRICING_PER_1M[model] : undefined;
  if (!entry) {
    const description = model
      ? `Claude model \"${model}\"`
      : "a Claude model id";
    throw new Error(`No pricing configured for ${description}`);
  }
  return {
    input: entry.input / 1e6,
    input_cached: entry.input_cached / 1e6,
    output: entry.output / 1e6,
  };
}

export interface ParseOptions {
  /** Model id for cost computation. Falls back to Claude-reported cost. */
  model?: string;
  /** Wall-clock seconds (measured externally). */
  wallClockSeconds?: number;
}

export function parseClaudeJsonl(
  raw: string,
  opts: ParseOptions = {},
): UsageMetrics {
  const lines = raw.split("\n").filter((l) => l.trim());

  let inputTokens = 0;
  let inputTokensCached = 0;
  let inputTokensCacheCreation = 0;
  let outputTokens = 0;
  let reportedCost = 0;
  let hasReportedCost = false;
  let turnCount = 0;
  let commandCount = 0;
  let errorCount = 0;
  let wallClockSeconds = opts.wallClockSeconds ?? 0;
  const commandLog: string[] = [];

  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    // Tool use events: count Bash commands (top-level or nested in assistant messages)
    if (entry.type === "tool_use") {
      const toolName = entry.tool ?? entry.name ?? "";
      if (toolName === "Bash") {
        commandCount++;
        const input = (entry.input ?? {}) as Record<string, unknown>;
        if (typeof input.command === "string") {
          commandLog.push(input.command);
        }
      }
    }
    if (entry.type === "assistant") {
      const msg = (entry.message ?? {}) as Record<string, unknown>;
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          const b = block as Record<string, unknown>;
          if (b.type === "tool_use" && b.name === "Bash") {
            commandCount++;
            const input = (b.input ?? {}) as Record<string, unknown>;
            if (typeof input.command === "string") {
              commandLog.push(input.command);
            }
          }
        }
      }
    }

    // Tool result events: check for errors
    if (entry.type === "tool_result") {
      if (entry.is_error === true) {
        errorCount++;
      }
    }
    if (entry.type === "user") {
      const msg = (entry.message ?? {}) as Record<string, unknown>;
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          const b = block as Record<string, unknown>;
          if (b.type === "tool_result" && b.is_error === true) {
            errorCount++;
          }
        }
      }
    }

    // Result event: contains aggregated usage and cost
    if (entry.type === "result") {
      if (entry.total_cost_usd != null) {
        reportedCost = Number(entry.total_cost_usd);
        hasReportedCost = true;
      }
      turnCount = Number(entry.num_turns ?? 0);

      if (!wallClockSeconds && entry.duration_ms) {
        wallClockSeconds = Number(entry.duration_ms) / 1000;
      }

      const usage = (entry.usage ?? {}) as Record<string, unknown>;
      const baseInput = Number(usage.input_tokens ?? 0);
      const cacheCreation = Number(usage.cache_creation_input_tokens ?? 0);
      const cacheRead = Number(usage.cache_read_input_tokens ?? 0);
      inputTokens = baseInput + cacheCreation + cacheRead;
      inputTokensCached = cacheRead;
      inputTokensCacheCreation = cacheCreation;
      outputTokens = Number(usage.output_tokens ?? 0);
    }

    // Assistant message events also carry per-message usage
    if (entry.type === "assistant") {
      const msg = (entry.message ?? {}) as Record<string, unknown>;
      const usage = (msg.usage ?? {}) as Record<string, unknown>;
      if (usage.input_tokens && !inputTokens) {
        const base = Number(usage.input_tokens ?? 0);
        const creation = Number(usage.cache_creation_input_tokens ?? 0);
        const read = Number(usage.cache_read_input_tokens ?? 0);
        inputTokens += base + creation + read;
        outputTokens += Number(usage.output_tokens ?? 0);
        inputTokensCached += read;
        inputTokensCacheCreation += creation;
      }
    }
  }

  const inputTokensUncached = inputTokens - inputTokensCached;

  // Use Claude's reported cost when available. When it is absent, compute from
  // tokens.
  let totalCost = reportedCost;
  if (!hasReportedCost && inputTokens > 0) {
    const pricing = getClaudePricing(opts.model);
    totalCost =
      (inputTokensUncached - inputTokensCacheCreation) * pricing.input +
      inputTokensCacheCreation * pricing.input * 1.25 +
      inputTokensCached * pricing.input_cached +
      outputTokens * pricing.output;
  }

  return {
    input_tokens: inputTokens,
    input_tokens_cached: inputTokensCached,
    input_tokens_uncached: inputTokensUncached,
    output_tokens: outputTokens,
    reasoning_tokens: 0,
    total_cost_usd: totalCost,
    wall_clock_seconds: wallClockSeconds,
    turn_count: turnCount,
    command_count: commandCount,
    error_count: errorCount,
    command_log: commandLog,
  };
}
