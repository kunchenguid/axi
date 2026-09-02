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
  inferenceGeo?: string;
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
      inference_geo: opts.inferenceGeo,
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

  it("uses point-release pricing or rejects an unpriced run", () => {
    const raw = JSON.stringify({
      type: "assistant",
      message: { usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } },
    });

    expect(
      parseClaudeJsonl(raw, { model: "claude-opus-4-5" }).total_cost_usd,
    ).toBeCloseTo(30);
    expect(
      parseClaudeJsonl(raw, { model: "claude-opus-4-1" }).total_cost_usd,
    ).toBeCloseTo(90);
    expect(() => parseClaudeJsonl(raw, { model: "opus" })).toThrow(
      'No pricing configured for Claude model "opus"',
    );
    expect(() => parseClaudeJsonl(raw, { model: "claude-fable-5" })).toThrow(
      'No pricing configured for Claude model "claude-fable-5"',
    );
    const rawWithoutCost = JSON.stringify({
      type: "result",
      usage: { input_tokens: 1_000_000 },
    });
    expect(() =>
      parseClaudeJsonl(rawWithoutCost, { model: "claude-fable-5" }),
    ).toThrow('No pricing configured for Claude model "claude-fable-5"');
  });

  it("accumulates provisional assistant usage by message id", () => {
    const provisional = [
      {
        type: "assistant",
        message: {
          id: "msg-1",
          usage: { input_tokens: 100, output_tokens: 10 },
        },
      },
      {
        type: "assistant",
        message: {
          id: "msg-1",
          usage: { input_tokens: 100, output_tokens: 10 },
        },
      },
      {
        type: "assistant",
        message: {
          id: "msg-2",
          usage: { input_tokens: 200, output_tokens: 20 },
        },
      },
    ];
    const raw = provisional.map(JSON.stringify).join("\n");

    expect(parseClaudeJsonl(raw, { model: "claude-sonnet-4-6" })).toMatchObject({
      input_tokens: 300,
      output_tokens: 30,
    });
    expect(
      parseClaudeJsonl(
        `${raw}\n${claudeResult({
          numTurns: 2,
          costUsd: 0.01,
          durationMs: 100,
          inputTokens: 7,
          outputTokens: 3,
        })}`,
        { model: "claude-sonnet-4-6" },
      ),
    ).toMatchObject({ input_tokens: 7, output_tokens: 3 });
  });

  // token mix from a published agent-browser run: 15474 uncached input,
  // 60499 cache-read, 401 output tokens
  it.each([
    ["claude-sonnet-4-6", 0.0705867],
    ["claude-sonnet-4-5-20250514", 0.0705867],
    ["claude-sonnet-4-5-20250929", 0.0705867],
    ["claude-opus-4-1", 0.3529335],
    ["claude-opus-4-1-20250805", 0.3529335],
    ["claude-opus-4-5", 0.1176445],
    ["claude-opus-4-5-20251101", 0.1176445],
    ["claude-opus-4-6", 0.1176445],
    ["claude-opus-4-7", 0.1176445],
    ["claude-opus-4-8", 0.1176445],
    ["claude-haiku-4-5-20251001", 0.0235289],
  ])("prices a result-less %s run at its configured rate", (model, expected) => {
    const raw = JSON.stringify({
      type: "assistant",
      message: {
        usage: {
          input_tokens: 15_474,
          cache_read_input_tokens: 60_499,
          output_tokens: 401,
        },
      },
    });

    expect(parseClaudeJsonl(raw, { model }).total_cost_usd).toBeCloseTo(
      expected,
      6,
    );
  });

  it.each([
    ["claude-sonnet-4-6", 30.855],
    ["claude-opus-4-6", 51.425],
    ["claude-opus-4-7", 51.425],
    ["claude-opus-4-8", 51.425],
    ["claude-sonnet-4-5-20250929", 28.05],
    ["claude-opus-4-5", 46.75],
    ["claude-opus-4-1", 140.25],
    ["claude-haiku-4-5-20251001", 9.35],
  ])("prices US inference for %s", (model, expected) => {
    const raw = JSON.stringify({
      type: "assistant",
      message: {
        usage: {
          input_tokens: 1_000_000,
          cache_creation_input_tokens: 2_000_000,
          cache_creation: {
            ephemeral_5m_input_tokens: 1_000_000,
            ephemeral_1h_input_tokens: 1_000_000,
          },
          cache_read_input_tokens: 1_000_000,
          output_tokens: 1_000_000,
          inference_geo: "us",
        },
      },
    });

    expect(parseClaudeJsonl(raw, { model }).total_cost_usd).toBeCloseTo(
      expected,
      6,
    );
  });

  it("prices cache creation by duration", () => {
    const raw = JSON.stringify({
      type: "assistant",
      message: {
        usage: {
          input_tokens: 1_000,
          cache_creation_input_tokens: 2_000,
          cache_creation: {
            ephemeral_5m_input_tokens: 1_000,
            ephemeral_1h_input_tokens: 1_000,
          },
          cache_read_input_tokens: 3_000,
          output_tokens: 500,
        },
      },
    });

    expect(
      parseClaudeJsonl(raw, { model: "claude-sonnet-4-6" }).total_cost_usd,
    ).toBeCloseTo(0.02115, 6);
    expect(
      parseClaudeJsonl(raw, { model: "claude-opus-4-5" }).total_cost_usd,
    ).toBeCloseTo(0.03525, 6);
  });

  it("uses reported cost regardless of model", () => {
    const raw = claudeResult({
      numTurns: 1,
      costUsd: 0.05,
      durationMs: 3000,
      inputTokens: 1000,
      outputTokens: 200,
      cacheRead: 400,
      inferenceGeo: "us",
    });

    const result = parseClaudeJsonl(raw, { model: "claude-sonnet-4-6" });

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
