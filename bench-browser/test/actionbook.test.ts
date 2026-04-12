import { describe, expect, it } from "vitest";

import {
  ACTIONBOOK_WARMUP_SESSION_ID,
  buildActionbookWarmupScript,
  isActionbookConditionId,
} from "../src/actionbook.js";

describe("buildActionbookWarmupScript", () => {
  it("uses a backgrounded start and warmup session logs under ACTIONBOOK_HOME", () => {
    const script = buildActionbookWarmupScript();

    expect(script).toContain(
      `actionbook browser start --headless --set-session-id ${ACTIONBOOK_WARMUP_SESSION_ID} --json >"$ACTIONBOOK_HOME/warmup-start.json" 2>&1 &`,
    );
    expect(script).toContain("sleep 3");
    expect(script).toContain(
      'actionbook browser list-sessions --json >"$ACTIONBOOK_HOME/warmup-list.json" 2>&1 || true',
    );
    expect(script).toContain(
      `actionbook browser close --session ${ACTIONBOOK_WARMUP_SESSION_ID} --json >"$ACTIONBOOK_HOME/warmup-close.json" 2>&1 || true`,
    );
  });
});

describe("isActionbookConditionId", () => {
  it("matches both Actionbook benchmark conditions", () => {
    expect(isActionbookConditionId("actionbook")).toBe(true);
    expect(isActionbookConditionId("actionbook-parallel")).toBe(true);
    expect(isActionbookConditionId("agent-browser")).toBe(false);
  });
});
