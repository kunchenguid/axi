import { describe, it, expect } from "vitest";
import { resolveClaudeAuth, stripExternalClaudeAuthEnv } from "../src/claude-auth.js";
import { buildConditionEnv, renderAgentsMd } from "../src/runner.js";
import type { ConditionDef, RunSpec } from "../src/types.js";

describe("renderAgentsMd", () => {
  it("renders a per-run dev-browser command placeholder", () => {
    const spec: RunSpec = {
      condition: "dev-browser",
      task: "navigate_404",
      run: 2,
      model: "claude-sonnet-4-6",
    };
    const condition: ConditionDef = {
      id: "dev-browser",
      name: "Dev Browser",
      tool: "dev-browser",
      agents_md: "Run `__AXI_BENCH_DEV_BROWSER_CMD__ run step.js`.",
      daemon: "explicit",
      daemon_start: "dev-browser status",
      daemon_stop: "dev-browser stop",
    };

    expect(renderAgentsMd(spec, condition)).toContain(
      "dev-browser --headless --browser axi-bench-dev-browser-navigate_404-run2 run step.js",
    );
  });
});

describe("buildConditionEnv", () => {
  it("injects isolated Actionbook environment variables per run", () => {
    const condition: ConditionDef = {
      id: "actionbook-parallel",
      name: "Actionbook Parallel",
      tool: "actionbook",
      agents_md: "Use actionbook",
      daemon: "none",
      command_policy: {
        require_any_prefix: ["actionbook"],
      },
    };

    const env = buildConditionEnv(
      condition,
      "/tmp/axi/results/actionbook-parallel/multi_site_research/run1",
    );

    expect(env.ACTIONBOOK_BROWSER_MODE).toBe("local");
    expect(env.ACTIONBOOK_BROWSER_HEADLESS).toBe("true");
    expect(env.ACTIONBOOK_HOME).toMatch(/^\/tmp\/axi-ab-[a-f0-9]{12}$/);
    expect(env.ACTIONBOOK_HOME!.length).toBeLessThan(40);
  });

  it("returns no extra environment variables for non-Actionbook conditions", () => {
    const condition: ConditionDef = {
      id: "dev-browser",
      name: "Dev Browser",
      tool: "dev-browser",
      agents_md: "Use dev-browser",
      daemon: "explicit",
      daemon_start: "dev-browser status",
      daemon_stop: "dev-browser stop",
    };

    expect(buildConditionEnv(condition, "/tmp/axi/results/dev-browser/task/run1")).toEqual({});
  });
});

describe("resolveClaudeAuth", () => {
  it("prefers subscription auth in auto mode when local login exists", () => {
    const result = resolveClaudeAuth(
      "auto",
      { ANTHROPIC_API_KEY: "bad-key", PATH: "/usr/bin" },
      () => ({ loggedIn: true, authMethod: "oauth" }),
    );

    expect(result.mode).toBe("subscription");
    expect(result.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("falls back to env auth in auto mode when no local login exists", () => {
    const result = resolveClaudeAuth(
      "auto",
      { ANTHROPIC_API_KEY: "bad-key", PATH: "/usr/bin" },
      () => ({ loggedIn: false, authMethod: "none" }),
    );

    expect(result.mode).toBe("env");
    expect(result.env.ANTHROPIC_API_KEY).toBe("bad-key");
  });

  it("rejects subscription mode when no local login exists", () => {
    expect(() =>
      resolveClaudeAuth(
        "subscription",
        { ANTHROPIC_API_KEY: "bad-key", PATH: "/usr/bin" },
        () => ({ loggedIn: false, authMethod: "none" }),
      ),
    ).toThrow(/claude auth login/i);
  });

  it("strips external auth environment variables for subscription mode", () => {
    expect(
      stripExternalClaudeAuthEnv({
        ANTHROPIC_API_KEY: "bad-key",
        CLAUDE_CODE_USE_BEDROCK: "1",
        PATH: "/usr/bin",
      }),
    ).toEqual({ PATH: "/usr/bin" });
  });
});
