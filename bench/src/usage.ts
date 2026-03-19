/**
 * Parse Codex CLI `--json` JSONL output into usage metrics.
 * TypeScript port of _parse_codex() from mcp-vs-cli-bench/bench/src/billing.py.
 *
 * Codex emits newline-delimited JSON with event types:
 *   - turn.completed  → usage.{input_tokens, output_tokens, reasoning_tokens, cost_usd}
 *                        usage.input_tokens_details.cached_tokens (optional)
 *   - item.completed  → item.{type:"command_execution", command, exit_code}
 */

import type { UsageMetrics } from "./types.js";

/**
 * Per-model pricing in USD per 1M tokens.
 * Source: https://openai.com/api/pricing/ (as of March 2026)
 *
 * Stored as $/1M for readability; converted to $/token at lookup time.
 */
interface ModelPricing {
  input: number; // $/1M uncached input tokens
  input_cached: number; // $/1M cached input tokens
  output: number; // $/1M output tokens
}

const CLAUDE_PRICING_PER_1M: Record<string, ModelPricing> = {
  // ── Claude Sonnet family ───────────────────────────────────────
  "claude-sonnet-4-6": { input: 3.0, input_cached: 0.3, output: 15.0 },
  "claude-sonnet-4-5-20250514": { input: 3.0, input_cached: 0.3, output: 15.0 },
  "sonnet": { input: 3.0, input_cached: 0.3, output: 15.0 },
  // ── Claude Opus family ─────────────────────────────────────────
  "claude-opus-4-6": { input: 15.0, input_cached: 1.5, output: 75.0 },
  "opus": { input: 15.0, input_cached: 1.5, output: 75.0 },
  // ── Claude Haiku family ────────────────────────────────────────
  "claude-haiku-4-5-20251001": { input: 0.80, input_cached: 0.08, output: 4.0 },
  "haiku": { input: 0.80, input_cached: 0.08, output: 4.0 },
};

const PRICING_PER_1M: Record<string, ModelPricing> = {
  // ── GPT-5.x family ────────────────────────────────────────────
  "gpt-5.4": { input: 2.5, input_cached: 0.25, output: 15.0 },
  "gpt-5.4-mini": { input: 0.75, input_cached: 0.075, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, input_cached: 0.02, output: 1.25 },
  "gpt-5.4-pro": { input: 30.0, input_cached: 30.0, output: 180.0 },
  "gpt-5.3-chat": { input: 1.75, input_cached: 0.175, output: 14.0 },
  "gpt-5.3-codex": { input: 1.75, input_cached: 0.175, output: 14.0 },
  "gpt-5.2": { input: 1.75, input_cached: 0.175, output: 14.0 },
  "gpt-5.2-chat": { input: 0.875, input_cached: 0.175, output: 7.0 },
  "gpt-5.2-codex": { input: 1.75, input_cached: 0.175, output: 14.0 },
  "gpt-5.1": { input: 1.25, input_cached: 0.125, output: 10.0 },
  "gpt-5.1-chat": { input: 1.25, input_cached: 0.125, output: 10.0 },
  "gpt-5.1-codex": { input: 1.25, input_cached: 0.125, output: 10.0 },
  "gpt-5.1-codex-mini": { input: 0.25, input_cached: 0.025, output: 2.0 },
  "gpt-5": { input: 1.25, input_cached: 0.125, output: 10.0 },
  "gpt-5-mini": { input: 0.25, input_cached: 0.025, output: 2.0 },
  "gpt-5-nano": { input: 0.05, input_cached: 0.005, output: 0.4 },

  // ── o-series (reasoning) ──────────────────────────────────────
  "o3": { input: 2.0, input_cached: 0.5, output: 8.0 },
  "o3-mini": { input: 1.1, input_cached: 0.55, output: 4.4 },
  "o3-pro": { input: 20.0, input_cached: 20.0, output: 80.0 },
  "o4-mini": { input: 0.55, input_cached: 0.275, output: 2.2 },
  "o4-mini-high": { input: 1.1, input_cached: 0.275, output: 4.4 },

  // ── GPT-4.1 family ────────────────────────────────────────────
  "gpt-4.1": { input: 2.0, input_cached: 0.5, output: 8.0 },
  "gpt-4.1-mini": { input: 0.2, input_cached: 0.1, output: 0.8 },
  "gpt-4.1-nano": { input: 0.05, input_cached: 0.025, output: 0.2 },

  // ── GPT-4o family (legacy) ────────────────────────────────────
  "gpt-4o": { input: 2.5, input_cached: 1.25, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, input_cached: 0.075, output: 0.6 },
};

function getPricing(model: string): ModelPricing | undefined {
  const entry = PRICING_PER_1M[model];
  if (!entry) return undefined;
  return {
    input: entry.input / 1e6,
    input_cached: entry.input_cached / 1e6,
    output: entry.output / 1e6,
  };
}

export interface ParseOptions {
  /** Model id for cost computation. Falls back to Codex-reported cost_usd. */
  model?: string;
  /** Wall-clock seconds (measured externally). */
  wallClockSeconds?: number;
}

export function parseCodexJsonl(
  raw: string,
  opts: ParseOptions = {},
): UsageMetrics {
  const lines = raw.split("\n").filter((l) => l.trim());

  let turnCount = 0;
  let inputTokens = 0;
  let inputTokensCached = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let reportedCost = 0;
  let commandCount = 0;
  let errorCount = 0;
  const commandLog: string[] = [];

  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (entry.type === "turn.completed") {
      turnCount++;
      const usage = (entry.usage ?? {}) as Record<string, unknown>;
      inputTokens += Number(usage.input_tokens ?? 0);
      outputTokens += Number(usage.output_tokens ?? 0);
      reasoningTokens += Number(usage.reasoning_tokens ?? 0);
      reportedCost += Number(usage.cost_usd ?? 0);

      // Codex CLI uses top-level `cached_input_tokens`.
      // OpenAI API uses nested `input_tokens_details.cached_tokens`.
      // Check both.
      const cachedDirect = Number(usage.cached_input_tokens ?? 0);
      const details = (usage.input_tokens_details ?? {}) as Record<
        string,
        unknown
      >;
      const cachedNested = Number(details.cached_tokens ?? 0);
      inputTokensCached += cachedDirect || cachedNested;
    }

    if (entry.type === "item.completed") {
      const item = (entry.item ?? {}) as Record<string, unknown>;
      if (item.type === "command_execution") {
        commandCount++;
        if (item.command) commandLog.push(String(item.command));
        if (Number(item.exit_code ?? 0) !== 0) errorCount++;
      }
    }
  }

  const inputTokensUncached = inputTokens - inputTokensCached;

  // Compute cost from token counts if pricing is available, else use reported.
  let totalCost: number;
  const pricing = opts.model ? getPricing(opts.model) : undefined;
  if (pricing) {
    totalCost =
      inputTokensUncached * pricing.input +
      inputTokensCached * pricing.input_cached +
      outputTokens * pricing.output;
  } else {
    totalCost = reportedCost;
  }

  return {
    input_tokens: inputTokens,
    input_tokens_cached: inputTokensCached,
    input_tokens_uncached: inputTokensUncached,
    output_tokens: outputTokens,
    reasoning_tokens: reasoningTokens,
    total_cost_usd: totalCost,
    wall_clock_seconds: opts.wallClockSeconds ?? 0,
    turn_count: turnCount,
    command_count: commandCount,
    error_count: errorCount,
    command_log: commandLog,
  };
}

function getClaudePricing(model: string): ModelPricing | undefined {
  const entry = CLAUDE_PRICING_PER_1M[model];
  if (!entry) return undefined;
  return {
    input: entry.input / 1e6,
    input_cached: entry.input_cached / 1e6,
    output: entry.output / 1e6,
  };
}

/**
 * Parse Claude CLI `--output-format stream-json` JSONL output into usage metrics.
 *
 * Claude emits newline-delimited JSON with event types:
 *   - system (subtype: init) → session initialization
 *   - assistant → message with content blocks (text, tool_use, thinking)
 *   - tool_use / tool_result → tool invocations
 *   - result (subtype: success) → final summary with usage, cost, duration
 */
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

    // Tool use events: count Bash commands
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

    // Tool result events: check for errors
    if (entry.type === "tool_result") {
      if (entry.is_error === true) {
        errorCount++;
      }
    }

    // Result event: contains aggregated usage and cost
    if (entry.type === "result") {
      reportedCost = Number(entry.total_cost_usd ?? 0);
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
      // Accumulate if result event hasn't provided totals.
      // Claude's usage.input_tokens is only the non-cached, non-cache-creation
      // portion — total input = input_tokens + cache_creation + cache_read.
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

  // Use Claude's reported cost when available. When the result event is missing
  // (agent crashed), compute from tokens. Cache creation is priced at 1.25× base.
  let totalCost = reportedCost;
  if (!totalCost && inputTokens > 0) {
    const pricing = opts.model ? getClaudePricing(opts.model) : undefined;
    if (pricing) {
      const baseInputTokens = inputTokensUncached - inputTokensCacheCreation;
      totalCost =
        baseInputTokens * pricing.input +
        inputTokensCacheCreation * pricing.input * 1.25 +
        inputTokensCached * pricing.input_cached +
        outputTokens * pricing.output;
    }
  }

  return {
    input_tokens: inputTokens,
    input_tokens_cached: inputTokensCached,
    input_tokens_uncached: inputTokensUncached,
    output_tokens: outputTokens,
    reasoning_tokens: 0, // Claude doesn't expose reasoning tokens separately
    total_cost_usd: totalCost,
    wall_clock_seconds: wallClockSeconds,
    turn_count: turnCount,
    command_count: commandCount,
    error_count: errorCount,
    command_log: commandLog,
  };
}
