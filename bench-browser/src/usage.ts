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
  supportsUsInference?: boolean;
}

const OPUS_4_1_PRICING = { input: 15.0, input_cached: 1.5, output: 75.0 };
const OPUS_4_5_PRICING = { input: 5.0, input_cached: 0.5, output: 25.0 };
const HAIKU_4_5_PRICING = { input: 1.0, input_cached: 0.1, output: 5.0 };

const CLAUDE_PRICING_PER_1M: Record<string, ModelPricing> = {
  "claude-sonnet-4-6": {
    input: 3.0,
    input_cached: 0.3,
    output: 15.0,
    supportsUsInference: true,
  },
  "claude-sonnet-4-5-20250514": { input: 3.0, input_cached: 0.3, output: 15.0 },
  "claude-sonnet-4-5-20250929": { input: 3.0, input_cached: 0.3, output: 15.0 },
  sonnet: { input: 3.0, input_cached: 0.3, output: 15.0 },
  "claude-opus-4-1": OPUS_4_1_PRICING,
  "claude-opus-4-1-20250805": OPUS_4_1_PRICING,
  "claude-opus-4-5": OPUS_4_5_PRICING,
  "claude-opus-4-5-20251101": OPUS_4_5_PRICING,
  "claude-opus-4-6": { ...OPUS_4_5_PRICING, supportsUsInference: true },
  "claude-opus-4-7": { ...OPUS_4_5_PRICING, supportsUsInference: true },
  "claude-opus-4-8": { ...OPUS_4_5_PRICING, supportsUsInference: true },
  "claude-haiku-4-5-20251001": HAIKU_4_5_PRICING,
};

function getClaudePricing(model: string | undefined): ModelPricing {
  const entry = model ? CLAUDE_PRICING_PER_1M[model] : undefined;
  if (!entry) {
    const description = model ? `Claude model "${model}"` : "a Claude model id";
    throw new Error(`No pricing configured for ${description}`);
  }
  return {
    input: entry.input / 1e6,
    input_cached: entry.input_cached / 1e6,
    output: entry.output / 1e6,
    supportsUsInference: entry.supportsUsInference,
  };
}

function parseClaudeUsage(usage: Record<string, unknown>) {
  const baseInput = Number(usage.input_tokens ?? 0);
  const cacheCreation = Number(usage.cache_creation_input_tokens ?? 0);
  const cacheRead = Number(usage.cache_read_input_tokens ?? 0);
  const cacheCreationDetails = (usage.cache_creation ?? {}) as Record<
    string,
    unknown
  >;
  const cacheCreation1h = Number(
    cacheCreationDetails.ephemeral_1h_input_tokens ?? 0,
  );
  const cacheCreation5m = Number(
    cacheCreationDetails.ephemeral_5m_input_tokens ??
      cacheCreation - cacheCreation1h,
  );
  const serverToolUse = (usage.server_tool_use ?? {}) as Record<
    string,
    unknown
  >;

  return {
    inputTokens: baseInput + cacheCreation + cacheRead,
    inputTokensCached: cacheRead,
    inputTokensCacheCreation5m: cacheCreation5m,
    inputTokensCacheCreation1h: cacheCreation1h,
    outputTokens: Number(usage.output_tokens ?? 0),
    inferenceGeo:
      typeof usage.inference_geo === "string" ? usage.inference_geo : "",
    webSearchRequests: Number(serverToolUse.web_search_requests ?? 0),
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
  let inputTokensCacheCreation5m = 0;
  let inputTokensCacheCreation1h = 0;
  let outputTokens = 0;
  let reportedCost = 0;
  let hasReportedCost = false;
  let turnCount = 0;
  let commandCount = 0;
  let errorCount = 0;
  let wallClockSeconds = opts.wallClockSeconds ?? 0;
  const commandLog: string[] = [];
  const assistantMessageIds = new Set<string>();
  let hasResultUsage = false;
  let inferenceGeo = "";
  let webSearchRequests = 0;

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

      const usage = parseClaudeUsage(
        (entry.usage ?? {}) as Record<string, unknown>,
      );
      inputTokens = usage.inputTokens;
      inputTokensCached = usage.inputTokensCached;
      inputTokensCacheCreation5m = usage.inputTokensCacheCreation5m;
      inputTokensCacheCreation1h = usage.inputTokensCacheCreation1h;
      outputTokens = usage.outputTokens;
      inferenceGeo = usage.inferenceGeo;
      webSearchRequests = usage.webSearchRequests;
      hasResultUsage = true;
    }

    // Assistant message events also carry per-message usage
    if (entry.type === "assistant") {
      const msg = (entry.message ?? {}) as Record<string, unknown>;
      const messageId = typeof msg.id === "string" ? msg.id : undefined;
      const usage = parseClaudeUsage(
        (msg.usage ?? {}) as Record<string, unknown>,
      );
      if (
        !hasResultUsage &&
        usage.inputTokens + usage.outputTokens + usage.webSearchRequests > 0 &&
        (!messageId || !assistantMessageIds.has(messageId))
      ) {
        if (messageId) assistantMessageIds.add(messageId);
        inputTokens += usage.inputTokens;
        outputTokens += usage.outputTokens;
        inputTokensCached += usage.inputTokensCached;
        inputTokensCacheCreation5m += usage.inputTokensCacheCreation5m;
        inputTokensCacheCreation1h += usage.inputTokensCacheCreation1h;
        if (usage.inferenceGeo === "us") inferenceGeo = "us";
        webSearchRequests += usage.webSearchRequests;
      }
    }
  }

  const inputTokensUncached = inputTokens - inputTokensCached;

  // Use Claude's reported cost when available. When it is absent, compute from
  // tokens and web-search requests.
  let totalCost = reportedCost;
  if (!hasReportedCost && (inputTokens > 0 || webSearchRequests > 0)) {
    const pricing = getClaudePricing(opts.model);
    const geoMultiplier =
      inferenceGeo === "us" && pricing.supportsUsInference ? 1.1 : 1;
    totalCost =
      ((inputTokensUncached -
        inputTokensCacheCreation5m -
        inputTokensCacheCreation1h) *
        pricing.input +
        inputTokensCacheCreation5m * pricing.input * 1.25 +
        inputTokensCacheCreation1h * pricing.input * 2 +
        inputTokensCached * pricing.input_cached +
        outputTokens * pricing.output) *
        geoMultiplier +
      webSearchRequests * 0.01;
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
