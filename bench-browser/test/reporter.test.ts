import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { RunResult } from "../src/types.js";
import { htmlReport, markdownReport, summarize } from "../src/reporter.js";

const sampleResults: RunResult[] = [
  {
    condition: "actionbook",
    task: "read_static_page",
    run: 1,
    model: "claude-sonnet-4-6",
    timestamp: "2026-04-10T00:00:00.000Z",
    usage: {
      input_tokens: 33325,
      input_tokens_cached: 33000,
      input_tokens_uncached: 325,
      output_tokens: 178,
      reasoning_tokens: 0,
      total_cost_usd: 0.0141,
      wall_clock_seconds: 28.1,
      turn_count: 2,
      command_count: 1,
      error_count: 0,
      command_log: ["actionbook browser text --session s1 --tab t1 --json"],
    },
    grade: {
      task_success: true,
      details: "Example Domain extracted successfully.",
      judge_model: "claude-sonnet-4-6",
    },
    agent_output: "Example Domain",
  },
  {
    condition: "actionbook-parallel",
    task: "multi_site_research",
    run: 1,
    model: "claude-sonnet-4-6",
    timestamp: "2026-04-10T00:01:00.000Z",
    usage: {
      input_tokens: 114462,
      input_tokens_cached: 105072,
      input_tokens_uncached: 9390,
      output_tokens: 1444,
      reasoning_tokens: 0,
      total_cost_usd: 0.0884,
      wall_clock_seconds: 34.9,
      turn_count: 6,
      command_count: 5,
      error_count: 0,
      command_log: ["actionbook browser start --headless --profile wiki-p --set-session-id wiki"],
    },
    grade: {
      task_success: true,
      details: "Rust research completed.",
      judge_model: "claude-sonnet-4-6",
    },
    agent_output: "Graydon Hoare, 112k, A language empowering everyone...",
  },
];

describe("reporter summaries", () => {
  it("aggregates per-condition metrics", () => {
    const summaries = summarize(sampleResults);

    expect(summaries).toHaveLength(2);
    expect(summaries.find((row) => row.condition === "actionbook")?.avg_turns).toBe(2);
    expect(summaries.find((row) => row.condition === "actionbook-parallel")?.avg_cost_usd).toBe(0.0884);
  });
});

describe("htmlReport", () => {
  it("renders a standalone dashboard with charts and task tables", () => {
    const html = htmlReport(sampleResults);

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>AXI Browser Benchmark Report</title>");
    expect(html).toContain("Avg Cost per Task");
    expect(html).toContain("actionbook-parallel");
    expect(html).toContain("read_static_page");
    expect(html).toContain("multi_site_research");
    expect(html).toContain("Task Breakdown");
  });
});

describe("markdownReport", () => {
  it("still emits the markdown summary table", () => {
    const md = markdownReport(sampleResults);

    expect(md).toContain("# Browser Benchmark Results");
    expect(md).toContain("| actionbook |");
    expect(md).toContain("| actionbook-parallel |");
  });

  it("can load results from a custom directory", () => {
    const resultsDir = mkdtempSync(join(tmpdir(), "axi-bench-report-"));
    writeFileSync(
      join(resultsDir, "actionbook.jsonl"),
      `${JSON.stringify(sampleResults[0])}\n`,
    );

    const md = markdownReport(undefined, { inputDir: resultsDir });

    expect(md).toContain("| actionbook |");
    expect(md).not.toContain("| actionbook-parallel |");
  });
});
