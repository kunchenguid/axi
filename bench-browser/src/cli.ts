#!/usr/bin/env tsx
/**
 * CLI entry point for the browser benchmark harness.
 *
 * Commands:
 *   run       — Run a single benchmark (--condition, --task, --repeat, --model)
 *   matrix    — Run all condition x task combinations
 *   report    — Generate summary from results.jsonl
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ConditionDef, ConditionId, TaskDef } from "./types.js";
import { runOne } from "./runner.js";
import { writeReports } from "./reporter.js";
import { startDaemon, stopDaemon } from "./lifecycle.js";

const execFileAsync = promisify(execFile);

const BENCH_ROOT = resolve(import.meta.dirname, "..");
const CONFIG_DIR = join(BENCH_ROOT, "config");
const DEFAULT_MODEL = "claude-sonnet-4-6";

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
  const model = args.model ?? DEFAULT_MODEL;

  if (!conditionId || !taskId) {
    console.error("Usage: bench run --condition <id> --task <id> [--repeat N] [--model M]");
    process.exit(1);
  }

  const conditions = loadConditions();
  const tasks = loadTasks();

  const condition = conditions.get(conditionId);
  if (!condition) {
    console.error(`Unknown condition: ${conditionId}. Available: ${[...conditions.keys()].join(", ")}`);
    process.exit(1);
  }

  const task = tasks.get(taskId);
  if (!task) {
    console.error(`Unknown task: ${taskId}. Available: ${[...tasks.keys()].join(", ")}`);
    process.exit(1);
  }

  clearResults([conditionId]);

  // Start daemon for this condition
  startDaemon(condition);

  try {
    for (let r = 1; r <= repeat; r++) {
      console.log(`\n=== Run ${r}/${repeat}: ${conditionId} x ${taskId} ===\n`);
      const result = runOne({ condition: conditionId as ConditionId, task: taskId, run: r, model }, condition, task);
      console.log(`  Success: ${result.grade.task_success}`);
      console.log(`  Turns: ${result.usage.turn_count}, Commands: ${result.usage.command_count}`);
      console.log(`  Input tokens: ${result.usage.input_tokens} (cached: ${result.usage.input_tokens_cached})`);
      console.log(`  Cost: $${result.usage.total_cost_usd.toFixed(4)}`);
      console.log(`  Time: ${result.usage.wall_clock_seconds.toFixed(1)}s`);
    }
  } finally {
    stopDaemon(condition);
  }
}

async function cmdMatrix(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const repeat = parseInt(args.repeat ?? "1", 10);
  const model = args.model ?? DEFAULT_MODEL;
  const conditionFilter = args.condition;
  const taskFilter = args.task;
  const categoryFilter = args.category;

  const conditions = loadConditions();
  const tasks = loadTasks();

  const conditionIds = conditionFilter
    ? conditionFilter.split(",")
    : [...conditions.keys()];

  let taskIds = taskFilter
    ? taskFilter.split(",")
    : [...tasks.keys()];

  if (categoryFilter) {
    taskIds = taskIds.filter((id) => {
      const t = tasks.get(id);
      return t && t.category === categoryFilter;
    });
  }

  const skipClear = args["skip-clear"] === "true";
  const parallel = args.parallel === "true";

  // Clear results once in the parent process (children use --skip-clear)
  if (!skipClear) {
    clearResults(conditionIds);
  }

  const total = conditionIds.length * taskIds.length * repeat;

  if (parallel && conditionIds.length > 1) {
    // Parallel mode: parent clears results, then spawns one child per condition.
    // Each child runs with --skip-clear so they only append, avoiding race conditions.
    console.log(`Running ${conditionIds.length} conditions in parallel (${total} total runs)...`);
    const childArgs = [
      "--repeat", String(repeat),
      "--model", model,
      "--skip-clear",
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
      } catch (err: unknown) {
        const execErr = err as { stdout?: string; stderr?: string; message?: string };
        console.log(execErr.stdout ?? "");
        console.error(execErr.stderr ?? execErr.message ?? "");
      }
    });
    await Promise.all(promises);
  } else {
    // Sequential mode: run each condition in turn with daemon lifecycle
    for (const condId of conditionIds) {
      const condition = conditions.get(condId);
      if (!condition) {
        console.error(`Skipping unknown condition: ${condId}`);
        continue;
      }

      // Start daemon for this condition
      startDaemon(condition);

      try {
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
              { condition: condId as ConditionId, task: taskId, run: r, model },
              condition,
              task,
            );
            const status = result.grade.task_success ? "PASS" : "FAIL";
            console.log(`  ${status} | ${result.usage.turn_count} turns | $${result.usage.total_cost_usd.toFixed(4)} | ${result.usage.wall_clock_seconds.toFixed(1)}s`);
          }
        }
      } finally {
        stopDaemon(condition);
      }
    }
  }

  console.log(`\nMatrix complete: ${total} runs.`);
  writeReports();
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "run":
      return cmdRun(rest);
    case "matrix":
      return cmdMatrix(rest);
    case "report":
      writeReports();
      return;
    default:
      console.log(`axi-bench-browser — benchmark harness for browser automation tools

Commands:
  run       Run a single benchmark
              --condition <agent-browser|pinchtab|chrome-devtools-mcp|chrome-devtools-mcp-search|chrome-devtools-mcp-code|chrome-devtools-mcp-compressed>
              --task <task_id>
              --repeat <N>  (default: 1)
              --model <M>   (default: claude-sonnet-4-6)

  matrix    Run all condition x task combinations
              --repeat <N>  (default: 1)
              --model <M>   (default: claude-sonnet-4-6)
              --condition <id,id,...>  (filter conditions)
              --task <id,id,...>       (filter tasks)
              --category <single_step|multi_step|investigation|error_recovery>
              --parallel          Run conditions in parallel

  report    Generate summary from results.jsonl
`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
