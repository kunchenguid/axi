import { describe, it, expect } from "vitest";
import { parseClaudeJsonl } from "../src/usage.js";

/**
 * A run that crashed before emitting its `result` event: usage is known but
 * cost is not, so cost has to be computed from the model's pricing. This is
 * the only path where the pricing table is consulted.
 */
const resultLessRun = (inputTokens: number, outputTokens: number) =>
  JSON.stringify({
    type: "assistant",
    message: {
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  });

const costOf = (model: string) =>
  parseClaudeJsonl(resultLessRun(1_000_000, 1_000_000), { model })
    .total_cost_usd;

describe("Claude model pricing", () => {
  const sonnetIds = [
    "sonnet",
    "claude-sonnet-4-5",
    "claude-sonnet-4-6",
    "claude-sonnet-4-5-20250929",
    "claude-sonnet-5",
    "us.anthropic.claude-sonnet-4-5-v1:0",
  ];
  const opusIds = ["opus", "claude-opus-4-5", "claude-opus-4-6"];
  const haikuIds = ["haiku", "claude-haiku-4-5", "claude-haiku-4-5-20251001"];

  for (const model of [...sonnetIds, ...opusIds, ...haikuIds]) {
    it(`prices a result-less run for ${model}`, () => {
      expect(costOf(model)).toBeGreaterThan(0);
    });
  }

  it("prices every id in a family identically", () => {
    expect(new Set(sonnetIds.map(costOf)).size).toBe(1);
    expect(new Set(opusIds.map(costOf)).size).toBe(1);
    expect(new Set(haikuIds.map(costOf)).size).toBe(1);
  });

  it("orders the family price tiers opus > sonnet > haiku", () => {
    expect(costOf("claude-opus-4-5")).toBeGreaterThan(
      costOf("claude-sonnet-4-5"),
    );
    expect(costOf("claude-sonnet-4-5")).toBeGreaterThan(
      costOf("claude-haiku-4-5"),
    );
    expect(costOf("claude-haiku-4-5")).toBeGreaterThan(0);
  });

  it("computes the published per-1M rate", () => {
    // 1M uncached input + 1M output at $3 / $15 per 1M.
    expect(costOf("claude-sonnet-4-6")).toBeCloseTo(18.0, 6);
  });

  it("leaves non-Claude models unpriced", () => {
    expect(costOf("gpt-5.4")).toBe(0);
  });
});
