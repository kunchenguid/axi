/**
 * Aggregate results.jsonl into summary tables (markdown + CSV).
 *
 * Adapted from bench-github/src/reporter.ts — domain-agnostic logic.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RunResult, ConditionId, ConditionSummary } from "./types.js";

const BENCH_ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_RESULTS_DIR = join(BENCH_ROOT, "results");

export type ReportPaths = {
  inputDir?: string;
  outputDir?: string;
};

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function loadResults(resultsDir = DEFAULT_RESULTS_DIR): RunResult[] {
  let files: string[];
  try {
    files = readdirSync(resultsDir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const results: RunResult[] = [];
  for (const file of files) {
    const raw = readFileSync(join(resultsDir, file), "utf-8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      results.push(JSON.parse(line) as RunResult);
    }
  }
  return results;
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

export function summarize(results?: RunResult[], paths?: ReportPaths): ConditionSummary[] {
  const all = results ?? loadResults(paths?.inputDir);
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

function buildTaskSummaryRows(taskRuns: RunResult[]): string {
  const byCondInTask = groupBy(taskRuns, (r) => r.condition);
  const rows: string[] = [];

  for (const [cond, condRuns] of byCondInTask) {
    const suc = condRuns.filter((r) => r.grade.task_success).length;
    const avgCachePct = mean(
      condRuns.map((r) =>
        r.usage.input_tokens > 0
          ? r.usage.input_tokens_cached / r.usage.input_tokens
          : 0,
      ),
    );
    rows.push(
      `<tr><td><code>${escapeHtml(cond)}</code></td><td>${Math.round(mean(condRuns.map((r) => r.usage.input_tokens)))}</td><td>${(avgCachePct * 100).toFixed(0)}%</td><td>${Math.round(mean(condRuns.map((r) => r.usage.output_tokens)))}</td><td>$${mean(condRuns.map((r) => r.usage.total_cost_usd)).toFixed(4)}</td><td>${mean(condRuns.map((r) => r.usage.wall_clock_seconds)).toFixed(1)}s</td><td>${mean(condRuns.map((r) => r.usage.turn_count)).toFixed(1)}</td><td>${suc}/${condRuns.length}</td></tr>`,
    );
  }

  return rows.join("\n");
}

export function markdownReport(results?: RunResult[], paths?: ReportPaths): string {
  const all = results ?? loadResults(paths?.inputDir);
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

  // Methodology
  lines.push("\n## Methodology\n");
  const models = [...new Set(all.map((r) => r.model))];
  const judgeModels = [...new Set(all.map((r) => r.grade.judge_model).filter(Boolean))];
  const runsPerTask = all.length > 0
    ? Math.round(all.length / (new Set(all.map((r) => `${r.condition}:${r.task}`)).size))
    : 0;
  lines.push(`- **Agent model**: ${models.join(", ") || "unknown"}`);
  lines.push(`- **Judge model**: ${judgeModels.join(", ") || "claude-opus-4-6"}`);
  lines.push(`- **Repeats per task**: ${runsPerTask}`);
  lines.push("- **Execution**: Sequential with randomized condition/task order");
  lines.push("- **Browser isolation**: Fresh browser per run (daemon restarted between runs)");
  lines.push("");
  lines.push("### Known Limitations\n");
  lines.push("- MCP conditions spawn Chrome per run (inherent to MCP architecture), adding ~2-5s cold-start overhead");
  lines.push("- MCP tool schemas consume ~28.5% of input tokens — cost comparisons reflect total API cost including schema overhead");
  lines.push("- `--disallowedTools` removes tools from use but not from the tool list visible to agents");
  lines.push("");

  // Failure analysis
  const failures = all.filter((r) => !r.grade.task_success);
  if (failures.length > 0) {
    lines.push("### Failure Analysis\n");
    const byReason = groupBy(
      failures,
      (r) => (r.grade.failure_reason as string) ?? "unknown",
    );
    lines.push("| Failure Type | Count |");
    lines.push("|-------------|-------|");
    for (const [reason, runs] of byReason) {
      lines.push(`| ${reason} | ${runs.length} |`);
    }
    lines.push("");
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

function renderChartRows(
  summaries: ConditionSummary[],
  metric: (summary: ConditionSummary) => number,
  formatter: (summary: ConditionSummary) => string,
): string {
  const ordered = [...summaries].sort((a, b) => metric(b) - metric(a));
  const maxValue = Math.max(...ordered.map(metric), 1);
  const bestValue = Math.min(...ordered.map(metric));

  return ordered
    .map((summary) => {
      const value = metric(summary);
      const width = `${Math.max((value / maxValue) * 100, 6)}%`;
      const highlight = value === bestValue;
      return [
        '<div class="chart-row">',
        `  <span class="chart-label">${escapeHtml(summary.condition)}</span>`,
        '  <div class="chart-bar-track">',
        `    <div class="chart-bar${highlight ? " bar-highlight" : ""}" style="width: ${width}"></div>`,
        "  </div>",
        `  <span class="chart-value${highlight ? " value-highlight" : ""}">${escapeHtml(formatter(summary))}</span>`,
        "</div>",
      ].join("\n");
    })
    .join("\n");
}

export function htmlReport(results?: RunResult[], paths?: ReportPaths): string {
  const all = results ?? loadResults(paths?.inputDir);
  if (all.length === 0) {
    return [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '  <meta charset="UTF-8" />',
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      "  <title>AXI Browser Benchmark Report</title>",
      "  <style>body{font-family:ui-sans-serif,system-ui,sans-serif;padding:32px;color:#111827;background:#f8fafc}main{max-width:900px;margin:0 auto}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}</style>",
      "</head>",
      "<body>",
      "  <main>",
      "    <h1>AXI Browser Benchmark Report</h1>",
      "    <p>No results found.</p>",
      "  </main>",
      "</body>",
      "</html>",
    ].join("\n");
  }

  const summaries = summarize(all);
  const successRate = all.filter((run) => run.grade.task_success).length / all.length;
  const conditionCount = new Set(all.map((run) => run.condition)).size;
  const taskCount = new Set(all.map((run) => run.task)).size;
  const totalCost = sum(all.map((run) => run.usage.total_cost_usd));
  const byTask = groupBy(all, (run) => run.task);
  const latestRuns = [...all]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 12);

  const taskSections = [...byTask.entries()]
    .map(([taskId, taskRuns]) => {
      const prompt = taskRuns[0]?.agent_output ?? "";
      return [
        '<section class="card task-card">',
        `  <div class="section-head"><h3>${escapeHtml(taskId)}</h3><span class="pill">${taskRuns.length} run${taskRuns.length === 1 ? "" : "s"}</span></div>`,
        '  <div class="table-wrap">',
        "    <table>",
        "      <thead><tr><th>Condition</th><th>Avg Input</th><th>Cache%</th><th>Avg Output</th><th>Avg Cost</th><th>Avg Duration</th><th>Avg Turns</th><th>Success</th></tr></thead>",
        `      <tbody>${buildTaskSummaryRows(taskRuns)}</tbody>`,
        "    </table>",
        "  </div>",
        `  <details><summary>Latest agent output</summary><pre>${escapeHtml(prompt)}</pre></details>`,
        "</section>",
      ].join("\n");
    })
    .join("\n");

  const recentRunRows = latestRuns
    .map((run) => {
      const basePath = `./${encodeURIComponent(run.condition)}/${encodeURIComponent(run.task)}/run${run.run}`;
      return [
        "<tr>",
        `  <td><code>${escapeHtml(run.condition)}</code></td>`,
        `  <td><code>${escapeHtml(run.task)}</code></td>`,
        `  <td>run${run.run}</td>`,
        `  <td>${run.grade.task_success ? '<span class="status-pass">PASS</span>' : '<span class="status-fail">FAIL</span>'}</td>`,
        `  <td>$${run.usage.total_cost_usd.toFixed(4)}</td>`,
        `  <td>${run.usage.wall_clock_seconds.toFixed(1)}s</td>`,
        `  <td>${run.usage.turn_count}</td>`,
        `  <td><a href="${basePath}/grade.json">grade</a> · <a href="${basePath}/agent_output.txt">trace</a></td>`,
        "</tr>",
      ].join("\n");
    })
    .join("\n");

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="UTF-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    "  <title>AXI Browser Benchmark Report</title>",
    "  <style>",
    "    :root{color-scheme:light;background:#f6f7fb;color:#111827;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}",
    "    *{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#f8fafc 0%,#eef2ff 100%);color:#111827}",
    "    a{color:#0f766e;text-decoration:none}a:hover{text-decoration:underline}",
    "    code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}",
    "    .container{max-width:1180px;margin:0 auto;padding:40px 24px 64px}",
    "    .hero{display:grid;gap:16px;margin-bottom:28px}",
    "    .eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#475569;font-weight:700}",
    "    h1{margin:0;font-size:40px;line-height:1.05;letter-spacing:-.04em}",
    "    .lede{max-width:780px;font-size:18px;line-height:1.6;color:#334155}",
    "    .meta{display:flex;flex-wrap:wrap;gap:10px 16px;color:#475569;font-size:14px}",
    "    .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:28px 0}",
    "    .card{background:rgba(255,255,255,.82);backdrop-filter:blur(10px);border:1px solid rgba(148,163,184,.25);border-radius:18px;box-shadow:0 12px 32px rgba(15,23,42,.08)}",
    "    .stat{padding:18px 18px 16px}.stat-label{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:700}.stat-value{margin-top:8px;font-size:32px;line-height:1;font-weight:700}.stat-sub{margin-top:6px;color:#475569;font-size:13px}",
    "    .grid-2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-bottom:16px}",
    "    .panel{padding:20px}.panel h2{margin:0 0 14px;font-size:18px}",
    "    .chart-rows{display:flex;flex-direction:column;gap:10px}.chart-row{display:flex;align-items:center;gap:10px}.chart-label{width:13rem;flex-shrink:0;text-align:right;font-size:12px;color:#64748b}.chart-bar-track{flex:1;height:18px;background:#e2e8f0;border-radius:999px;overflow:hidden}.chart-bar{height:100%;background:#94a3b8}.chart-bar.bar-highlight{background:linear-gradient(90deg,#0f766e,#14b8a6)}.chart-value{width:4.25rem;flex-shrink:0;font-size:12px;color:#475569}.chart-value.value-highlight{color:#0f766e;font-weight:700}",
    "    .section{margin-top:18px}.section h2{margin:0 0 14px;font-size:22px}.section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}",
    "    .pill{display:inline-flex;align-items:center;border-radius:999px;padding:4px 10px;background:#e2e8f0;color:#334155;font-size:12px;font-weight:600}",
    "    .table-wrap{overflow:auto}.table-wrap table{width:100%;border-collapse:collapse}.table-wrap th,.table-wrap td{padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:left;font-size:14px;vertical-align:top}.table-wrap th{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#64748b}",
    "    .task-list{display:grid;gap:16px}.task-card{padding:18px}.task-card summary{cursor:pointer;color:#0f766e;font-weight:600}.task-card pre{white-space:pre-wrap;background:#0f172a;color:#e2e8f0;padding:14px;border-radius:12px;overflow:auto;font-size:12px;line-height:1.5}",
    "    .status-pass{color:#047857;font-weight:700}.status-fail{color:#b91c1c;font-weight:700}",
    "    .footer-note{margin-top:18px;color:#64748b;font-size:13px}",
    "    @media (max-width: 760px){h1{font-size:32px}.chart-label{width:8rem;text-align:left}}",
    "  </style>",
    "</head>",
    "<body>",
    '  <main class="container">',
    '    <section class="hero">',
    '      <div class="eyebrow">AXI Browser Benchmark</div>',
    "      <h1>Browser Benchmark Results</h1>",
    "      <p class=\"lede\">A benchmark dashboard for the current report directory. It summarizes cost, duration, turn count, and per-task outcomes, with direct links to each run's grade and trace files.</p>",
    `      <div class="meta"><span>Generated from ${all.length} run${all.length === 1 ? "" : "s"}</span><span>${conditionCount} condition${conditionCount === 1 ? "" : "s"}</span><span>${taskCount} task${taskCount === 1 ? "" : "s"}</span><span>Latest timestamp ${escapeHtml(latestRuns[0]?.timestamp ?? "")}</span></div>`,
    "    </section>",
    '    <section class="stats">',
    `      <article class="card stat"><div class="stat-label">Success Rate</div><div class="stat-value">${(successRate * 100).toFixed(0)}%</div><div class="stat-sub">${all.filter((run) => run.grade.task_success).length}/${all.length} successful runs</div></article>`,
    `      <article class="card stat"><div class="stat-label">Avg Cost</div><div class="stat-value">$${mean(all.map((run) => run.usage.total_cost_usd)).toFixed(4)}</div><div class="stat-sub">Total cost $${totalCost.toFixed(4)}</div></article>`,
    `      <article class="card stat"><div class="stat-label">Avg Duration</div><div class="stat-value">${mean(all.map((run) => run.usage.wall_clock_seconds)).toFixed(1)}s</div><div class="stat-sub">Average end-to-end wall clock</div></article>`,
    `      <article class="card stat"><div class="stat-label">Avg Turns</div><div class="stat-value">${mean(all.map((run) => run.usage.turn_count)).toFixed(1)}</div><div class="stat-sub">Agent turns per run</div></article>`,
    "    </section>",
    '    <section class="grid-2">',
    '      <article class="card panel">',
    "        <h2>Avg Cost per Task</h2>",
    `        <div class="chart-rows">${renderChartRows(summaries, (summary) => summary.avg_cost_usd, (summary) => `$${summary.avg_cost_usd.toFixed(4)}`)}</div>`,
    "      </article>",
    '      <article class="card panel">',
    "        <h2>Avg Duration per Task</h2>",
    `        <div class="chart-rows">${renderChartRows(summaries, (summary) => summary.avg_duration_seconds, (summary) => `${summary.avg_duration_seconds.toFixed(1)}s`)}</div>`,
    "      </article>",
    "    </section>",
    '    <section class="section">',
    "      <h2>Summary</h2>",
    '      <div class="card panel table-wrap">',
    "        <table>",
    "          <thead><tr><th>Condition</th><th>Runs</th><th>Avg Input</th><th>Cache%</th><th>Avg Output</th><th>Avg Cost</th><th>Total Cost</th><th>Avg Duration</th><th>Avg Turns</th><th>Success</th></tr></thead>",
    `          <tbody>${summaries.map((summary) => `<tr><td><code>${escapeHtml(summary.condition)}</code></td><td>${summary.total_tasks}</td><td>${summary.avg_input_tokens}</td><td>${(summary.avg_cached_pct * 100).toFixed(0)}%</td><td>${summary.avg_output_tokens}</td><td>$${summary.avg_cost_usd.toFixed(4)}</td><td>$${summary.total_cost_usd.toFixed(4)}</td><td>${summary.avg_duration_seconds.toFixed(1)}s</td><td>${summary.avg_turns}</td><td>${(summary.success_rate * 100).toFixed(0)}%</td></tr>`).join("\n")}</tbody>`,
    "        </table>",
    "      </div>",
    "    </section>",
    '    <section class="section">',
    "      <h2>Task Breakdown</h2>",
    `      <div class="task-list">${taskSections}</div>`,
    "    </section>",
    '    <section class="section">',
    "      <h2>Recent Runs</h2>",
    '      <div class="card panel table-wrap">',
    "        <table>",
    "          <thead><tr><th>Condition</th><th>Task</th><th>Run</th><th>Status</th><th>Cost</th><th>Duration</th><th>Turns</th><th>Artifacts</th></tr></thead>",
    `          <tbody>${recentRunRows}</tbody>`,
    "        </table>",
    "      </div>",
    '      <p class="footer-note">Artifact links are relative to the directory containing this report, so they work when you open the file locally.</p>',
    "    </section>",
    "  </main>",
    "</body>",
    "</html>",
  ].join("\n");
}

export function csvReport(results?: RunResult[], paths?: ReportPaths): string {
  const all = results ?? loadResults(paths?.inputDir);
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

export function writeReports(paths?: ReportPaths): void {
  const inputDir = paths?.inputDir ?? DEFAULT_RESULTS_DIR;
  const outputDir = paths?.outputDir ?? inputDir;
  const md = markdownReport(undefined, { inputDir });
  const html = htmlReport(undefined, { inputDir });
  const csv = csvReport(undefined, { inputDir });
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "report.md"), md);
  writeFileSync(join(outputDir, "report.html"), html);
  writeFileSync(join(outputDir, "report.csv"), csv);
  console.log(md);
  console.log(`Reports written to ${outputDir}/report.md, ${outputDir}/report.html, and ${outputDir}/report.csv`);
}
