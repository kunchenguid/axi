import { describe, it, expect, vi } from "vitest";
import { formatTrajectory, buildGradingPrompt, grade } from "../src/grader.js";
import * as child_process from "node:child_process";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(child_process.execFileSync);

describe("formatTrajectory", () => {
  it("extracts Bash commands from Claude assistant messages", () => {
    const jsonl = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Let me navigate to the page." },
          { type: "tool_use", name: "Bash", input: { command: "agent-browser navigate https://example.com" } },
        ],
      },
    });

    const result = formatTrajectory(jsonl);
    expect(result).toContain("AGENT: Let me navigate to the page.");
    expect(result).toContain("COMMAND: agent-browser navigate https://example.com");
  });

  it("extracts MCP tool calls", () => {
    const jsonl = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "navigate_page", input: { url: "https://example.com" } },
        ],
      },
    });

    const result = formatTrajectory(jsonl);
    expect(result).toContain('TOOL_CALL: navigate_page({"url":"https://example.com"})');
  });

  it("extracts tool results", () => {
    const jsonl = JSON.stringify({
      type: "user",
      message: {
        content: [
          { type: "tool_result", content: "Page loaded: Example Domain" },
        ],
      },
    });

    const result = formatTrajectory(jsonl);
    expect(result).toContain("OUTPUT: Page loaded: Example Domain");
  });

  it("extracts MCP tool results with array content", () => {
    const jsonl = JSON.stringify({
      type: "user",
      message: {
        content: [
          { type: "tool_result", content: [{ type: "text", text: "Snapshot: Example Domain heading" }] },
        ],
      },
    });

    const result = formatTrajectory(jsonl);
    expect(result).toContain("OUTPUT: Snapshot: Example Domain heading");
  });

  it("extracts result event with final answer", () => {
    const jsonl = JSON.stringify({
      type: "result",
      result: "The main heading is 'Example Domain'.",
    });

    const result = formatTrajectory(jsonl);
    expect(result).toContain("AGENT: The main heading is 'Example Domain'.");
  });

  it("returns placeholder for empty input", () => {
    expect(formatTrajectory("")).toBe("(empty trajectory)");
    expect(formatTrajectory("\n\n")).toBe("(empty trajectory)");
  });

  it("skips malformed JSON lines", () => {
    const jsonl = [
      "not json",
      JSON.stringify({
        type: "result",
        result: "Valid output.",
      }),
    ].join("\n");

    const result = formatTrajectory(jsonl);
    expect(result).toContain("AGENT: Valid output.");
    expect(result).not.toContain("not json");
  });
});

describe("buildGradingPrompt", () => {
  it("includes task prompt and trajectory", () => {
    const prompt = buildGradingPrompt(
      "Navigate to example.com",
      "COMMAND: agent-browser navigate https://example.com\nOUTPUT: Page loaded",
    );
    expect(prompt).toContain("TASK: Navigate to example.com");
    expect(prompt).toContain("COMMAND: agent-browser navigate");
    expect(prompt).toContain("Rules:");
  });

  it("includes grading hint when provided", () => {
    const prompt = buildGradingPrompt(
      "Report the heading",
      "AGENT: Example Domain",
      "The heading is 'Example Domain'.",
    );
    expect(prompt).toContain("KNOWN FACTS: The heading is 'Example Domain'.");
  });

  it("omits KNOWN FACTS section when no hint", () => {
    const prompt = buildGradingPrompt("Navigate somewhere", "AGENT: done");
    expect(prompt).not.toContain("KNOWN FACTS");
  });

  it("mentions browser automation in the system prompt", () => {
    const prompt = buildGradingPrompt("Navigate", "AGENT: done");
    expect(prompt).toContain("browser automation");
  });
});

describe("grade", () => {
  it("returns pass when judge says pass", () => {
    mockedExecFileSync.mockReturnValue(
      JSON.stringify({ pass: true, reason: "Agent navigated correctly and reported the heading." }),
    );

    const result = grade({}, "Navigate to example.com", '{"type":"result","result":"done"}');
    expect(result.task_success).toBe(true);
    expect(result.details).toContain("navigated correctly");
  });

  it("returns fail when judge says fail", () => {
    mockedExecFileSync.mockReturnValue(
      JSON.stringify({ pass: false, reason: "Agent hallucinated without browsing." }),
    );

    const result = grade({}, "Navigate to example.com", "");
    expect(result.task_success).toBe(false);
    expect(result.details).toContain("hallucinated");
  });

  it("handles judge process failure", () => {
    mockedExecFileSync.mockImplementation(() => {
      const err = new Error("process failed") as Error & { stdout: string; stderr: string };
      err.stdout = "";
      err.stderr = "timeout";
      throw err;
    });

    const result = grade({}, "Navigate", "");
    expect(result.task_success).toBe(false);
    expect(result.details).toContain("Judge process failed");
  });

  it("handles unparseable judge output", () => {
    mockedExecFileSync.mockReturnValue("I don't know what to say");

    const result = grade({}, "Navigate", "");
    expect(result.task_success).toBe(false);
    expect(result.details).toContain("Could not parse judge verdict");
  });

  it("extracts verdict wrapped in markdown code fences", () => {
    mockedExecFileSync.mockReturnValue(
      '```json\n{"pass": true, "reason": "Correctly navigated."}\n```',
    );

    const result = grade({}, "Navigate", "");
    expect(result.task_success).toBe(true);
    expect(result.details).toBe("Correctly navigated.");
  });

  it("passes grading_hint through to the prompt", () => {
    mockedExecFileSync.mockReturnValue(JSON.stringify({ pass: true, reason: "ok" }));

    grade(
      { grading_hint: "The heading is 'Example Domain'." },
      "Report the heading",
      "",
    );

    const lastCallArgs = mockedExecFileSync.mock.calls.at(-1)![1] as string[];
    const promptArg = lastCallArgs[1]; // -p is args[0], prompt is args[1]
    expect(promptArg).toContain("Report the heading");
    expect(promptArg).toContain("The heading is 'Example Domain'.");
  });
});
