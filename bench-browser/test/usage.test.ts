import { describe, it, expect } from "vitest";
import { parseClaudeJsonl } from "../src/usage.js";

const claudeToolUse = (tool: string, command?: string) =>
  JSON.stringify({
    type: "tool_use",
    tool,
    input: command ? { command } : {},
  });

const claudeToolResult = (tool: string, isError = false) =>
  JSON.stringify({
    type: "tool_result",
    tool,
    is_error: isError,
  });

const claudeResult = (opts: {
  numTurns: number;
  costUsd: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead?: number;
  cacheCreation?: number;
}) =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: opts.numTurns,
    total_cost_usd: opts.costUsd,
    duration_ms: opts.durationMs,
    result: "Final answer",
    usage: {
      input_tokens: opts.inputTokens,
      output_tokens: opts.outputTokens,
      cache_read_input_tokens: opts.cacheRead ?? 0,
      cache_creation_input_tokens: opts.cacheCreation ?? 0,
    },
  });

describe("parseClaudeJsonl", () => {
  it("parses result event with usage", () => {
    const raw = [
      claudeToolUse("Bash", "agent-browser navigate https://example.com"),
      claudeToolResult("Bash"),
      claudeResult({
        numTurns: 2,
        costUsd: 0.05,
        durationMs: 5000,
        inputTokens: 3000,
        outputTokens: 500,
        cacheRead: 1000,
      }),
    ].join("\n");

    const result = parseClaudeJsonl(raw);

    expect(result.turn_count).toBe(2);
    // total = input_tokens(3000) + cache_creation(0) + cache_read(1000) = 4000
    expect(result.input_tokens).toBe(4000);
    expect(result.input_tokens_cached).toBe(1000);
    expect(result.input_tokens_uncached).toBe(3000);
    expect(result.output_tokens).toBe(500);
    expect(result.command_count).toBe(1);
    expect(result.error_count).toBe(0);
    expect(result.command_log).toEqual(["agent-browser navigate https://example.com"]);
    expect(result.reasoning_tokens).toBe(0);
  });

  it("counts Bash tool uses as commands", () => {
    const raw = [
      claudeToolUse("Bash", "agent-browser navigate https://example.com"),
      claudeToolResult("Bash"),
      claudeToolUse("Read"),
      claudeToolResult("Read"),
      claudeToolUse("Bash", "agent-browser snapshot"),
      claudeToolResult("Bash"),
      claudeResult({
        numTurns: 1,
        costUsd: 0.01,
        durationMs: 2000,
        inputTokens: 1000,
        outputTokens: 200,
      }),
    ].join("\n");

    const result = parseClaudeJsonl(raw);
    expect(result.command_count).toBe(2);
    expect(result.command_log).toEqual([
      "agent-browser navigate https://example.com",
      "agent-browser snapshot",
    ]);
  });

  it("counts tool errors", () => {
    const raw = [
      claudeToolUse("Bash", "agent-browser click @missing"),
      claudeToolResult("Bash", true),
      claudeResult({
        numTurns: 1,
        costUsd: 0.01,
        durationMs: 1000,
        inputTokens: 500,
        outputTokens: 100,
      }),
    ].join("\n");

    const result = parseClaudeJsonl(raw);
    expect(result.error_count).toBe(1);
    expect(result.command_count).toBe(1);
  });

  it("returns zeros for empty input", () => {
    const result = parseClaudeJsonl("");
    expect(result.turn_count).toBe(0);
    expect(result.input_tokens).toBe(0);
    expect(result.command_count).toBe(0);
  });

  it("uses reported cost regardless of model", () => {
    const raw = claudeResult({
      numTurns: 1,
      costUsd: 0.05,
      durationMs: 3000,
      inputTokens: 1000,
      outputTokens: 200,
      cacheRead: 400,
    });

    const result = parseClaudeJsonl(raw, { model: "haiku" });
    // Claude always uses reported cost (accounts for cache creation pricing)
    expect(result.total_cost_usd).toBe(0.05);
  });

  it("uses duration from result event when wallClockSeconds not provided", () => {
    const raw = claudeResult({
      numTurns: 1,
      costUsd: 0.01,
      durationMs: 5500,
      inputTokens: 100,
      outputTokens: 50,
    });

    const result = parseClaudeJsonl(raw);
    expect(result.wall_clock_seconds).toBe(5.5);
  });

  it("uses reported cost when model pricing is unknown", () => {
    const raw = claudeResult({
      numTurns: 1,
      costUsd: 0.05,
      durationMs: 3000,
      inputTokens: 1000,
      outputTokens: 200,
    });

    const result = parseClaudeJsonl(raw, { model: "unknown-claude-model" });
    expect(result.total_cost_usd).toBe(0.05);
  });
});
