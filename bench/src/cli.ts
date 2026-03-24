#!/usr/bin/env tsx
/**
 * CLI entry point for the benchmark harness.
 *
 * Commands:
 *   run       — Run a single benchmark (--condition, --task, --repeat, --model, --agent)
 *   matrix    — Run all condition × task combinations
 *   report    — Generate summary from results.jsonl
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { AgentBackend, ConditionDef, ConditionId, TaskDef } from "./types.js";
import { runOne } from "./runner.js";
import { writeReports, loadAndMerge } from "./reporter.js";

const BENCH_ROOT = resolve(import.meta.dirname, "..");
const CONFIG_DIR = join(BENCH_ROOT, "config");
const PUBLISHED_DIR = join(BENCH_ROOT, "published-results");

function loadConditions(): Map<string, ConditionDef> {
  const raw = readFileSync(join(CONFIG_DIR, "conditions.yaml"), "utf-8");
  const doc = parseYaml(raw) as { conditions: Record<string, Omit<ConditionDef, "id">> };
  const map = new Map<string, ConditionDef>();
  for (const [id, def] of Object.entries(doc.conditions)) {
    map.set(id, { ...def, id: id as ConditionId });
  }
  return map;
}

function loadTasks(): Map<string, TaskDef> {
  const raw = readFileSync(join(CONFIG_DIR, "tasks.yaml"), "utf-8");
  const doc = parseYaml(raw) as { tasks: Record<string, Omit<TaskDef, "id">> };
  const map = new Map<string, TaskDef>();
  for (const [id, def] of Object.entries(doc.tasks)) {
    map.set(id, { ...def, id });
  }
  return map;
}

/** Clear previous results for the given conditions, keeping results from other conditions. */
function clearResults(conditionIds: string[]): void {
  const resultsPath = join(BENCH_ROOT, "results", "results.jsonl");
  if (!existsSync(resultsPath)) {
    writeFileSync(resultsPath, "");
    return;
  }
  try {
    const kept = readFileSync(resultsPath, "utf-8")
      .split("\n")
      .filter((l) => {
        if (!l.trim()) return false;
        const r = JSON.parse(l);
        return !conditionIds.includes(r.condition);
      })
      .join("\n");
    writeFileSync(resultsPath, kept ? kept + "\n" : "");
  } catch {
    writeFileSync(resultsPath, "");
  }
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "true";
      args[key] = val;
      if (val !== "true") i++;
    }
  }
  return args;
}

async function cmdRun(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const conditionId = args.condition;
  const taskId = args.task;
  const repeat = parseInt(args.repeat ?? "1", 10);
  const agent = (args.agent ?? "codex") as AgentBackend;
  const defaultModel = agent === "claude" ? "claude-sonnet-4-6" : "gpt-5.4";
  const model = args.model ?? defaultModel;

  if (!conditionId || !taskId) {
    console.error("Usage: bench run --condition <id> --task <id> [--repeat N] [--model M] [--agent codex|claude]");
    process.exit(1);
  }

  const conditions = loadConditions();
  const tasks = loadTasks();

  const condition = conditions.get(conditionId);
  if (!condition) {
    console.error(`Unknown condition: ${conditionId}. Available: ${[...conditions.keys()].join(", ")}`);
    process.exit(1);
  }

  if (agent === "codex" && conditionId === "mcp-with-toolsearch") {
    console.error("Condition mcp-with-toolsearch is not supported with Codex (ToolSearch is Claude-specific). Use mcp-no-toolsearch instead.");
    process.exit(1);
  }
  if (agent === "codex" && conditionId?.startsWith("mcp-compressed-")) {
    console.error(`Condition ${conditionId} is not supported with Codex (requires stdio MCP via mcp-compressor). Use --agent claude instead.`);
    process.exit(1);
  }

  const task = tasks.get(taskId);
  if (!task) {
    console.error(`Unknown task: ${taskId}. Available: ${[...tasks.keys()].join(", ")}`);
    process.exit(1);
  }

  clearResults([conditionId]);

  for (let r = 1; r <= repeat; r++) {
    console.log(`\n=== Run ${r}/${repeat}: ${conditionId} × ${taskId} ===\n`);
    const result = runOne({ condition: conditionId as ConditionId, task: taskId, run: r, model, agent }, condition, task);
    console.log(`  Success: ${result.grade.task_success}`);
    console.log(`  Turns: ${result.usage.turn_count}, Commands: ${result.usage.command_count}`);
    console.log(`  Input tokens: ${result.usage.input_tokens} (cached: ${result.usage.input_tokens_cached})`);
    console.log(`  Cost: $${result.usage.total_cost_usd.toFixed(4)}`);
    console.log(`  Time: ${result.usage.wall_clock_seconds.toFixed(1)}s`);
  }
}

async function cmdMatrix(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const repeat = parseInt(args.repeat ?? "1", 10);
  const agent = (args.agent ?? "codex") as AgentBackend;
  const defaultModel = agent === "claude" ? "claude-sonnet-4-6" : "gpt-5.4";
  const model = args.model ?? defaultModel;
  const conditionFilter = args.condition;
  const taskFilter = args.task;
  const categoryFilter = args.category;

  const conditions = loadConditions();
  const tasks = loadTasks();

  let conditionIds = conditionFilter
    ? conditionFilter.split(",")
    : [...conditions.keys()];

  // ToolSearch and mcp-compressor conditions are Claude-specific; skip for Codex
  if (agent === "codex") {
    conditionIds = conditionIds.filter((id) => id !== "mcp-with-toolsearch" && !id.startsWith("mcp-compressed-"));
  }

  let taskIds = taskFilter
    ? taskFilter.split(",")
    : [...tasks.keys()];

  if (categoryFilter) {
    taskIds = taskIds.filter((id) => {
      const t = tasks.get(id);
      return t && t.category === categoryFilter;
    });
  }

  clearResults(conditionIds);

  const parallel = args.parallel === "true";
  const total = conditionIds.length * taskIds.length * repeat;

  const runCondition = (condId: string) => {
    const condition = conditions.get(condId);
    if (!condition) {
      console.error(`Skipping unknown condition: ${condId}`);
      return;
    }

    let condDone = 0;
    const condTotal = taskIds.length * repeat;

    for (const taskId of taskIds) {
      const task = tasks.get(taskId);
      if (!task) {
        console.error(`Skipping unknown task: ${taskId}`);
        continue;
      }

      for (let r = 1; r <= repeat; r++) {
        condDone++;
        console.log(`\n[${condId} ${condDone}/${condTotal}] ${taskId} (run ${r})`);
        const result = runOne(
          { condition: condId as ConditionId, task: taskId, run: r, model, agent },
          condition,
          task,
        );
        const status = result.grade.task_success ? "PASS" : "FAIL";
        console.log(`  ${status} | ${result.usage.turn_count} turns | $${result.usage.total_cost_usd.toFixed(4)} | ${result.usage.wall_clock_seconds.toFixed(1)}s`);
      }
    }
  };

  if (parallel && conditionIds.length > 1) {
    console.log(`Running ${conditionIds.length} conditions in parallel (${total} total runs)...`);
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const childArgs = [
      "--agent", agent,
      "--repeat", String(repeat),
      "--model", model,
      ...(taskFilter ? ["--task", taskFilter] : []),
      ...(categoryFilter ? ["--category", categoryFilter] : []),
    ];
    const promises = conditionIds.map(async (condId) => {
      console.log(`  Starting condition: ${condId}`);
      try {
        const result = await execFileAsync(
          "npx",
          ["tsx", "src/cli.ts", "matrix", "--condition", condId, ...childArgs],
          { cwd: BENCH_ROOT, maxBuffer: 50 * 1024 * 1024, timeout: 0, env: process.env },
        );
        console.log(result.stdout);
        if (result.stderr) console.error(result.stderr);
      } catch (err: any) {
        console.log(err.stdout ?? "");
        console.error(err.stderr ?? err.message);
      }
    });
    await Promise.all(promises);
  } else {
    for (const condId of conditionIds) {
      runCondition(condId);
    }
  }

  console.log(`\nMatrix complete: ${total} runs.`);
  writeReports();
}

function cmdReport(argv: string[]): void {
  const args = parseArgs(argv);
  const mergePaths = args.merge?.split(",") ?? [];

  // Always include working results if they exist
  const sources: string[] = [];
  const workingResults = join(BENCH_ROOT, "results", "results.jsonl");
  if (existsSync(workingResults)) sources.push(workingResults);

  // --merge: add extra JSONL files (e.g., published-results/results.jsonl)
  sources.push(...mergePaths);

  if (sources.length <= 1 && mergePaths.length === 0) {
    // Simple case: just the working results
    writeReports();
  } else {
    const merged = loadAndMerge(sources);
    writeReports(undefined, merged);
  }
}

function cmdPublish(argv: string[]): void {
  const args = parseArgs(argv);
  const workingResults = join(BENCH_ROOT, "results", "results.jsonl");
  const publishedResults = join(PUBLISHED_DIR, "results.jsonl");

  // Collect sources: published first (lower priority), then working (overrides)
  const sources: string[] = [];
  if (existsSync(publishedResults)) sources.push(publishedResults);
  if (existsSync(workingResults)) sources.push(workingResults);

  if (sources.length === 0) {
    console.error("No results to publish. Run benchmarks first.");
    process.exit(1);
  }

  const merged = loadAndMerge(sources);
  console.log(`Merging ${merged.length} results into published-results/`);

  mkdirSync(PUBLISHED_DIR, { recursive: true });
  writeFileSync(publishedResults, merged.map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeReports(PUBLISHED_DIR, merged);

  // Copy per-condition artifact directories from working results if they exist
  // Excludes workspace/ dirs (large repo clones that are reproducible)
  const conditions = loadConditions();
  for (const condId of conditions.keys()) {
    const src = join(BENCH_ROOT, "results", condId);
    const dst = join(PUBLISHED_DIR, condId);
    if (existsSync(src) && !existsSync(dst)) {
      execSync(`rsync -a --exclude=workspace --exclude=.mcp-config.json ${JSON.stringify(src + "/")} ${JSON.stringify(dst + "/")}`, { stdio: "pipe" });
      console.log(`  Copied artifacts: ${condId}/`);
    }
  }

  console.log(`\nPublished ${merged.length} results to published-results/`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "run":
      return cmdRun(rest);
    case "matrix":
      return cmdMatrix(rest);
    case "report":
      return cmdReport(rest);
    case "publish":
      return cmdPublish(rest);
    default:
      console.log(`axi-bench — benchmark harness for cli vs axi vs GitHub MCP

Commands:
  run       Run a single benchmark
              --condition <cli|axi|mcp-with-toolsearch|mcp-with-code-mode>
              --task <task_id>
              --repeat <N>  (default: 1)
              --model <M>   (default: gpt-5.4 for codex, claude-sonnet-4-6 for claude)
              --agent <codex|claude>  (default: codex)

  matrix    Run all condition × task combinations
              --repeat <N>  (default: 1)
              --model <M>   (default: gpt-5.4 for codex, claude-sonnet-4-6 for claude)
              --agent <codex|claude>  (default: codex)
              --condition <id,id,...>  (filter conditions)
              --task <id,id,...>       (filter tasks)
              --category <single_step|multi_step|error_recovery>
              --parallel          Run conditions in parallel

  report    Generate summary from results.jsonl
              --merge <path,path,...>  Merge additional JSONL files into report

  publish   Merge working results into published-results/
              Combines results/results.jsonl with published-results/results.jsonl,
              regenerates reports, and copies artifact directories.
`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
