#!/usr/bin/env tsx

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { writeReports } from "../src/reporter.js";

type Options = {
  conditions: string[];
  sourceDir: string;
  outputDir: string;
};

const BENCH_ROOT = resolve(import.meta.dirname, "..");

function parseArgs(argv: string[]): Options {
  let conditions: string[] = [];
  let sourceDir = join(BENCH_ROOT, "results");
  let outputDir = join(BENCH_ROOT, "published-results");

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--conditions" && next) {
      conditions = next.split(",").map((value) => value.trim()).filter(Boolean);
      index += 1;
    } else if (arg === "--source-dir" && next) {
      sourceDir = resolve(process.cwd(), next);
      index += 1;
    } else if (arg === "--output-dir" && next) {
      outputDir = resolve(process.cwd(), next);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (conditions.length === 0) {
    throw new Error("Missing --conditions <id,id,...>");
  }

  return { conditions, sourceDir, outputDir };
}

async function replacePath(src: string, dst: string): Promise<void> {
  await rm(dst, { recursive: true, force: true });
  await cp(src, dst, { recursive: true });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  await mkdir(options.outputDir, { recursive: true });

  for (const condition of options.conditions) {
    const jsonlSrc = join(options.sourceDir, `${condition}.jsonl`);
    const jsonlDst = join(options.outputDir, `${condition}.jsonl`);
    const dirSrc = join(options.sourceDir, condition);
    const dirDst = join(options.outputDir, condition);

    if (!existsSync(jsonlSrc)) {
      throw new Error(`Missing source results file: ${jsonlSrc}`);
    }

    if (!existsSync(dirSrc)) {
      throw new Error(`Missing source artifact directory: ${dirSrc}`);
    }

    await replacePath(jsonlSrc, jsonlDst);
    await replacePath(dirSrc, dirDst);
  }

  writeReports({
    inputDir: options.outputDir,
    outputDir: options.outputDir,
  });

  const reportPath = join(options.outputDir, "report.md");
  const studyPath = join(options.outputDir, "STUDY.md");
  const reportMd = await readFile(reportPath, "utf-8");
  await writeFile(studyPath, reportMd);

  console.log(
    `Published ${options.conditions.join(", ")} into ${options.outputDir}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
