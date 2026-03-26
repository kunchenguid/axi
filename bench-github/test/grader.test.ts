import { describe, it, expect, vi } from "vitest";
import { formatTrajectory, buildGradingPrompt, grade } from "../src/grader.js";
import * as child_process from "node:child_process";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(child_process.execFileSync);

describe("formatTrajectory", () => {
  it("extracts commands with output and exit codes", () => {
    const jsonl = [
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "command_execution",
          command: "gh issue list --repo facebook/react",
          output: "#123 Some issue\n#124 Another issue",
          exit_code: 0,
        },
      }),
    ].join("\n");

    const result = formatTrajectory(jsonl);
    expect(result).toContain("COMMAND: gh issue list --repo facebook/react");
    expect(result).toContain("OUTPUT: #123 Some issue");
    expect(result).toContain("EXIT_CODE: 0");
  });

  it("extracts agent messages from item.completed", () => {
    const jsonl = JSON.stringify({
      type: "item.completed",
      item: { type: "message", text: "The most recent issue is #123." },
    });

    const result = formatTrajectory(jsonl);
    expect(result).toContain("AGENT: The most recent issue is #123.");
  });

  it("extracts agent messages from top-level message events", () => {
    const jsonl = JSON.stringify({
      type: "message",
      content: "Here are the results.",
    });

    const result = formatTrajectory(jsonl);
    expect(result).toContain("AGENT: Here are the results.");
  });

  it("returns placeholder for empty input", () => {
    expect(formatTrajectory("")).toBe("(empty trajectory)");
    expect(formatTrajectory("\n\n")).toBe("(empty trajectory)");
  });

  it("skips malformed JSON lines", () => {
    const jsonl = [
      "not json",
      JSON.stringify({
        type: "item.completed",
        item: { type: "message", text: "Valid line." },
      }),
    ].join("\n");

    const result = formatTrajectory(jsonl);
    expect(result).toContain("AGENT: Valid line.");
    expect(result).not.toContain("not json");
  });
});

describe("buildGradingPrompt", () => {
  it("includes task prompt and trajectory", () => {
    const prompt = buildGradingPrompt("List issues", "COMMAND: gh issue list\nEXIT_CODE: 0");
    expect(prompt).toContain("TASK: List issues");
    expect(prompt).toContain("COMMAND: gh issue list");
    expect(prompt).toContain("Rules:");
  });

  it("includes grading hint when provided", () => {
    const prompt = buildGradingPrompt("View PR #31000", "AGENT: merged", "PR was authored by hoxyq.");
    expect(prompt).toContain("KNOWN FACTS: PR was authored by hoxyq.");
  });

  it("omits KNOWN FACTS section when no hint", () => {
    const prompt = buildGradingPrompt("List issues", "AGENT: done");
    expect(prompt).not.toContain("KNOWN FACTS");
  });
});

describe("grade", () => {
  it("returns pass when judge says pass", () => {
    mockedExecFileSync.mockReturnValue(
      JSON.stringify({ pass: true, reason: "Agent ran correct commands and reported accurately." }),
    );

    const result = grade({}, "List issues", '{"type":"message","text":"done"}');
    expect(result.task_success).toBe(true);
    expect(result.details).toContain("reported accurately");
  });

  it("returns fail when judge says fail", () => {
    mockedExecFileSync.mockReturnValue(
      JSON.stringify({ pass: false, reason: "Agent hallucinated without running commands." }),
    );

    const result = grade({}, "List issues", "");
    expect(result.task_success).toBe(false);
    expect(result.details).toContain("hallucinated");
  });

  it("extracts verdict from JSONL-wrapped response", () => {
    const jsonlResponse = JSON.stringify({
      type: "item.completed",
      item: {
        type: "message",
        text: '{"pass": true, "reason": "Correct answer."}',
      },
    });

    mockedExecFileSync.mockReturnValue(jsonlResponse);

    const result = grade({}, "View PR", "");
    expect(result.task_success).toBe(true);
    expect(result.details).toBe("Correct answer.");
  });

  it("handles judge process failure", () => {
    mockedExecFileSync.mockImplementation(() => {
      const err = new Error("process failed") as Error & { stdout: string; stderr: string };
      err.stdout = "";
      err.stderr = "timeout";
      throw err;
    });

    const result = grade({}, "List issues", "");
    expect(result.task_success).toBe(false);
    expect(result.details).toContain("Judge process failed");
  });

  it("handles unparseable judge output", () => {
    mockedExecFileSync.mockReturnValue("I don't know what to say");

    const result = grade({}, "List issues", "");
    expect(result.task_success).toBe(false);
    expect(result.details).toContain("Could not parse judge verdict");
  });

  it("extracts verdict when reason contains curly braces", () => {
    mockedExecFileSync.mockReturnValue(
      JSON.stringify({ pass: true, reason: "Issue title is {Brussels~Kontakt} which is correct." }),
    );

    const result = grade({}, "List issues", "");
    expect(result.task_success).toBe(true);
    expect(result.details).toContain("{Brussels~Kontakt}");
  });

  it("passes grading_hint through to the prompt", () => {
    mockedExecFileSync.mockReturnValue(JSON.stringify({ pass: true, reason: "ok" }));

    grade(
      { grading_hint: "PR was authored by hoxyq." },
      "View PR #31000",
      "",
    );

    const lastCallArgs = mockedExecFileSync.mock.calls.at(-1)![1] as string[];
    const promptArg = lastCallArgs.at(-1)!;
    expect(promptArg).toContain("View PR #31000");
    expect(promptArg).toContain("PR was authored by hoxyq.");
  });
});
