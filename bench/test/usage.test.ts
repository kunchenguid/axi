import { describe, it, expect } from "vitest";
import { parseCodexJsonl, parseClaudeJsonl } from "../src/usage.js";

/** OpenAI API format: nested input_tokens_details.cached_tokens */
const turnEvent = (input: number, output: number, reasoning: number, cached = 0) =>
  JSON.stringify({
    type: "turn.completed",
    usage: {
      input_tokens: input,
      output_tokens: output,
      reasoning_tokens: reasoning,
      cost_usd: 0.01,
      input_tokens_details: { cached_tokens: cached },
    },
  });

/** Codex CLI format: top-level cached_input_tokens */
const turnEventCodex = (input: number, output: number, cached = 0) =>
  JSON.stringify({
    type: "turn.completed",
    usage: {
      input_tokens: input,
      output_tokens: output,
      cached_input_tokens: cached,
    },
  });

const cmdEvent = (command: string, exitCode = 0) =>
  JSON.stringify({
    type: "item.completed",
    item: { type: "command_execution", command, exit_code: exitCode },
  });

describe("parseCodexJsonl", () => {
  it("parses turn and command events", () => {
    const raw = [
      turnEvent(1000, 200, 50),
      cmdEvent("gh issue list --repo facebook/react"),
      turnEvent(1500, 300, 100, 800),
      cmdEvent("gh issue view 123 --repo facebook/react"),
    ].join("\n");

    const result = parseCodexJsonl(raw);

    expect(result.turn_count).toBe(2);
    expect(result.input_tokens).toBe(2500);
    expect(result.input_tokens_cached).toBe(800);
    expect(result.input_tokens_uncached).toBe(1700);
    expect(result.output_tokens).toBe(500);
    expect(result.reasoning_tokens).toBe(150);
    expect(result.command_count).toBe(2);
    expect(result.error_count).toBe(0);
    expect(result.command_log).toEqual([
      "gh issue list --repo facebook/react",
      "gh issue view 123 --repo facebook/react",
    ]);
  });

  it("counts errors from non-zero exit codes", () => {
    const raw = [
      turnEvent(100, 50, 0),
      cmdEvent("gh issue view 999999", 1),
      cmdEvent("gh issue list", 0),
    ].join("\n");

    const result = parseCodexJsonl(raw);
    expect(result.error_count).toBe(1);
    expect(result.command_count).toBe(2);
  });

  it("returns zeros for empty input", () => {
    const result = parseCodexJsonl("");
    expect(result.turn_count).toBe(0);
    expect(result.input_tokens).toBe(0);
    expect(result.command_count).toBe(0);
  });

  it("skips malformed JSON lines", () => {
    const raw = [
      "not valid json",
      turnEvent(100, 50, 10),
      "{broken",
    ].join("\n");

    const result = parseCodexJsonl(raw);
    expect(result.turn_count).toBe(1);
    expect(result.input_tokens).toBe(100);
  });

  it("computes cost from pricing when model is provided", () => {
    const raw = turnEvent(1000, 200, 0, 400);
    const result = parseCodexJsonl(raw, { model: "o4-mini" });

    // o4-mini: $0.55/1M input, $0.275/1M cached, $2.20/1M output
    // 600 uncached × 0.55/1M + 400 cached × 0.275/1M + 200 output × 2.20/1M
    const expected = 600 * 0.55e-6 + 400 * 0.275e-6 + 200 * 2.2e-6;
    expect(result.total_cost_usd).toBeCloseTo(expected, 8);
  });

  it("uses reported cost when model pricing is unknown", () => {
    const raw = turnEvent(1000, 200, 0);
    const result = parseCodexJsonl(raw, { model: "unknown-model" });
    expect(result.total_cost_usd).toBe(0.01);
  });

  it("parses cached_input_tokens from Codex CLI format", () => {
    const raw = [
      turnEventCodex(22133, 265, 20736),
      cmdEvent("gh repo view facebook/react"),
    ].join("\n");

    const result = parseCodexJsonl(raw);
    expect(result.input_tokens).toBe(22133);
    expect(result.input_tokens_cached).toBe(20736);
    expect(result.input_tokens_uncached).toBe(22133 - 20736);
  });
});

// ── Claude JSONL parsing ──────────────────────────────────────────

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
      claudeToolUse("Bash", "gh issue list"),
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
    expect(result.command_log).toEqual(["gh issue list"]);
    expect(result.reasoning_tokens).toBe(0);
  });

  it("counts Bash tool uses as commands", () => {
    const raw = [
      claudeToolUse("Bash", "gh issue list"),
      claudeToolResult("Bash"),
      claudeToolUse("Read"),
      claudeToolResult("Read"),
      claudeToolUse("Bash", "gh pr view 123"),
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
    expect(result.command_log).toEqual(["gh issue list", "gh pr view 123"]);
  });

  it("counts tool errors", () => {
    const raw = [
      claudeToolUse("Bash", "gh issue view 999"),
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
});
