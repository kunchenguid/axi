import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

import { renderAgentsMd } from "../src/runner.js";
import type { ConditionDef, RunSpec } from "../src/types.js";
import { generateToolFile } from "../lib/browser-code/codegen.js";

const BENCH_ROOT = resolve(import.meta.dirname, "..");

function loadCondition(id: string): ConditionDef {
  const raw = readFileSync(
    join(BENCH_ROOT, "config", "conditions.yaml"),
    "utf-8",
  );
  const doc = parseYaml(raw) as {
    conditions: Record<string, Omit<ConditionDef, "id">>;
  };
  return { ...doc.conditions[id], id: id as ConditionDef["id"] };
}

describe("browser-code generator", () => {
  it("allows omitting input when all tool parameters are optional", () => {
    const code = generateToolFile({
      name: "take_snapshot",
      description: "Take a text snapshot of the current page.",
      inputSchema: {
        type: "object",
        properties: {
          verbose: { type: "boolean", description: "Include extra detail." },
          filePath: { type: "string", description: "Optional output path." },
        },
        required: [],
      },
    });

    expect(code).toContain(
      "export async function takeSnapshot(input: TakeSnapshotInput = {}): Promise<string> {",
    );
  });

  it("keeps required tool inputs mandatory", () => {
    const code = generateToolFile({
      name: "evaluate_script",
      description: "Evaluate code in the page.",
      inputSchema: {
        type: "object",
        properties: {
          function: { type: "string", description: "Function body." },
          args: {
            type: "array",
            items: { type: "string" },
            description: "Arguments.",
          },
        },
        required: ["function"],
      },
    });

    expect(code).toContain(
      "export async function evaluateScript(input: EvaluateScriptInput): Promise<string> {",
    );
    expect(code).toContain("script?: string;");
    expect(code).toContain("input = { ...input, function: input.script };");
  });
});

describe("chrome-devtools-mcp-code prompt", () => {
  it("shows the no-arg optional wrapper call pattern and evaluateScript field name", () => {
    const spec: RunSpec = {
      condition: "chrome-devtools-mcp-code",
      task: "read_static_page",
      run: 1,
      model: "claude-sonnet-4-6",
    };

    const agentsMd = renderAgentsMd(
      spec,
      loadCondition("chrome-devtools-mcp-code"),
    );

    expect(agentsMd).toContain("const snap = await takeSnapshot({});");
    expect(agentsMd).toContain("`evaluateScript` expects a `function` string");
  });
});

describe("actionbook prompt", () => {
  it("documents the harness-provided environment and background start pattern", () => {
    const spec: RunSpec = {
      condition: "actionbook",
      task: "read_static_page",
      run: 1,
      model: "claude-sonnet-4-6",
    };

    const agentsMd = renderAgentsMd(
      spec,
      loadCondition("actionbook"),
    );

    expect(agentsMd).toContain("The harness already sets these environment variables");
    expect(agentsMd).toContain("ACTIONBOOK_HOME");
    expect(agentsMd).toContain("actionbook browser start --headless --set-session-id s1 --json >\"$ACTIONBOOK_HOME/start.json\" 2>&1 &");
    expect(agentsMd).toContain("sleep 3");
    expect(agentsMd).toContain("actionbook browser list-sessions --json");
    expect(agentsMd).toContain("prefer plain output when you only");
    expect(agentsMd).toContain("data.value");
    expect(agentsMd).toContain("data.changed.url_changed");
    expect(agentsMd).toContain("Do not immediately follow that with");
    expect(agentsMd).toContain("There is no `actionbook browser key` subcommand");
  });

  it("documents the parallel start pattern for the parallel Actionbook condition", () => {
    const spec: RunSpec = {
      condition: "actionbook-parallel",
      task: "multi_site_research",
      run: 1,
      model: "claude-sonnet-4-6",
    };

    const agentsMd = renderAgentsMd(
      spec,
      loadCondition("actionbook-parallel"),
    );

    expect(agentsMd).toContain("run multiple");
    expect(agentsMd).toContain("Actionbook sessions in parallel");
    expect(agentsMd).toContain("--profile wiki-p --set-session-id wiki");
    expect(agentsMd).toContain("--open-url \"https://en.wikipedia.org/wiki/Rust_(programming_language)\"");
    expect(agentsMd).toContain('actionbook browser text "#mw-content-text" --session wiki --tab t1 >"$ACTIONBOOK_HOME/wiki-text.txt" 2>&1 &');
    expect(agentsMd).toContain("document.querySelector('#repo-stars-counter-star')?.textContent?.trim()");
    expect(agentsMd).toContain("data.value");
    expect(agentsMd).toContain("data.nodes");
    expect(agentsMd).toContain("do not follow it with");
    expect(agentsMd).toContain("Submit searches and");
    expect(agentsMd).toContain("inspect the saved files locally");
    expect(agentsMd).toContain("wait");
    expect(agentsMd).toContain("Do not fall");
    expect(agentsMd).toContain("generic GitHub selectors like `.Counter`");
  });
});
