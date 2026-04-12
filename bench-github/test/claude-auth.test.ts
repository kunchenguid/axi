import { describe, expect, it } from "vitest";

import { resolveClaudeAuth, stripExternalClaudeAuthEnv } from "../src/claude-auth.js";

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
