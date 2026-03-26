/**
 * Aggregate results.jsonl into summary tables (markdown + CSV).
 *
 * Adapted from bench-github/src/reporter.ts — domain-agnostic logic.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RunResult, ConditionId, ConditionSummary } from "./types.js";

const BENCH_ROOT = resolve(import.meta.dirname, "..");
const RESULTS_DIR = join(BENCH_ROOT, "results");

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

function loadResults(): RunResult[] {
  const path = join(RESULTS_DIR, "results.jsonl");
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as RunResult);
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return map;
}

export function summarize(results?: RunResult[]): ConditionSummary[] {
  const all = results ?? loadResults();
  if (all.length === 0) return [];

  const byCondition = groupBy(all, (r) => r.condition);
  const summaries: ConditionSummary[] = [];

  for (const [condId, runs] of byCondition) {
    const successes = runs.filter((r) => r.grade.task_success).length;
    summaries.push({
      condition: condId as ConditionId,
      name: condId,
      total_tasks: runs.length,
      success_rate: successes / runs.length,
      avg_input_tokens: Math.round(mean(runs.map((r) => r.usage.input_tokens))),
      avg_cached_pct: mean(
        runs.map((r) =>
          r.usage.input_tokens > 0
            ? r.usage.input_tokens_cached / r.usage.input_tokens
            : 0,
        ),
      ),
      avg_output_tokens: Math.round(mean(runs.map((r) => r.usage.output_tokens))),
      avg_cost_usd: mean(runs.map((r) => r.usage.total_cost_usd)),
      total_cost_usd: sum(runs.map((r) => r.usage.total_cost_usd)),
      avg_duration_seconds: mean(runs.map((r) => r.usage.wall_clock_seconds)),
      avg_turns: parseFloat(mean(runs.map((r) => r.usage.turn_count)).toFixed(1)),
    });
  }

  return summaries;
}

export function markdownReport(results?: RunResult[]): string {
  const all = results ?? loadResults();
  if (all.length === 0) return "No results found.\n";

  const summaries = summarize(all);
  const lines: string[] = [];

  // Summary table
  lines.push("# Browser Benchmark Results\n");
  lines.push("## Summary\n");
  lines.push(
    "| Condition | Tasks | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success% |",
  );
  lines.push(
    "|-----------|-------|-----------------|--------|-------------------|----------|------------|-------------|-----------|----------|",
  );

  for (const s of summaries) {
    lines.push(
      `| ${s.condition} | ${s.total_tasks} | ${s.avg_input_tokens} | ${(s.avg_cached_pct * 100).toFixed(0)}% | ${s.avg_output_tokens} | $${s.avg_cost_usd.toFixed(4)} | $${s.total_cost_usd.toFixed(2)} | ${s.avg_duration_seconds.toFixed(1)}s | ${s.avg_turns} | ${(s.success_rate * 100).toFixed(0)}% |`,
    );
  }

  // Per-task breakdown
  lines.push("\n## Per-Task Breakdown\n");
  const byTask = groupBy(all, (r) => r.task);

  for (const [taskId, taskRuns] of byTask) {
    lines.push(`### ${taskId}\n`);
    lines.push("| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |");
    lines.push("|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|");

    const byCondInTask = groupBy(taskRuns, (r) => r.condition);
    for (const [cond, condRuns] of byCondInTask) {
      const suc = condRuns.filter((r) => r.grade.task_success).length;
      const avgCachePct = mean(
        condRuns.map((r) =>
          r.usage.input_tokens > 0
            ? r.usage.input_tokens_cached / r.usage.input_tokens
            : 0,
        ),
      );
      lines.push(
        `| ${cond} | ${Math.round(mean(condRuns.map((r) => r.usage.input_tokens)))} | ${(avgCachePct * 100).toFixed(0)}% | ${Math.round(mean(condRuns.map((r) => r.usage.output_tokens)))} | $${mean(condRuns.map((r) => r.usage.total_cost_usd)).toFixed(4)} | $${sum(condRuns.map((r) => r.usage.total_cost_usd)).toFixed(4)} | ${mean(condRuns.map((r) => r.usage.wall_clock_seconds)).toFixed(1)}s | ${mean(condRuns.map((r) => r.usage.turn_count)).toFixed(1)} | ${suc}/${condRuns.length} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

export function csvReport(results?: RunResult[]): string {
  const all = results ?? loadResults();
  if (all.length === 0) return "";

  const headers = [
    "condition", "task", "run", "model", "timestamp",
    "success", "input_tokens", "input_tokens_cached", "output_tokens",
    "reasoning_tokens", "total_cost_usd", "wall_clock_seconds",
    "turn_count", "command_count", "error_count",
  ];
  const lines = [headers.join(",")];

  for (const r of all) {
    lines.push(
      [
        r.condition, r.task, r.run, r.model, r.timestamp,
        r.grade.task_success, r.usage.input_tokens, r.usage.input_tokens_cached,
        r.usage.output_tokens, r.usage.reasoning_tokens, r.usage.total_cost_usd,
        r.usage.wall_clock_seconds, r.usage.turn_count, r.usage.command_count,
        r.usage.error_count,
      ].join(","),
    );
  }

  return lines.join("\n") + "\n";
}

export function writeReports(): void {
  const md = markdownReport();
  const csv = csvReport();
  writeFileSync(join(RESULTS_DIR, "report.md"), md);
  writeFileSync(join(RESULTS_DIR, "report.csv"), csv);
  console.log(md);
  console.log(`Reports written to results/report.md and results/report.csv`);
}
