import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CapabilityPolicyError,
  canonicalSha256,
  evaluateCapabilityPolicy,
  parseCapabilityManifest,
  parseCapabilityPolicy,
  resolveCapabilityInvocation,
  verifyCapabilityPins,
} from "../src/capability-policy.js";

const manifest = {
  schemaVersion: 1,
  tool: { name: "gl-axi", bin: "gl-axi" },
  routes: [
    {
      match: { tokens: ["issue", "list"] },
      effect: "read",
      reaches: ["gitlab"],
      scopes: ["read_api"],
    },
  ],
};

const policy = {
  schemaVersion: 1,
  engine: "builtin",
  pins: {
    manifestSha256: "0".repeat(64),
    publisher: {
      oidcIssuer: "https://gitlab.com",
      projectPath: "axi-tooling/gl-axi",
    },
  },
  effects: { none: "allow", read: "allow", mutate: "deny" },
  passthrough: {
    methods: {
      GET: "allow",
      POST: "deny",
      PUT: "deny",
      PATCH: "deny",
      DELETE: "deny",
      HEAD: "allow",
    },
    paths: [{ method: "GET", pattern: "projects/*", decision: "allow" }],
  },
};

const routingManifest = parseCapabilityManifest({
  schemaVersion: 1,
  tool: { name: "gl-axi", bin: "gl-axi" },
  routes: [
    {
      match: { tokens: [], rest: "flags-only" },
      effect: "read",
      reaches: ["gitlab"],
      scopes: ["read_api"],
    },
    {
      match: { tokens: ["--help"] },
      effect: "none",
      reaches: [],
      scopes: [],
    },
    {
      match: { tokens: ["issue"], rest: "flags-only" },
      effect: "read",
      reaches: ["gitlab"],
      scopes: ["read_api"],
    },
    {
      match: { tokens: ["issue", "list"] },
      effect: "read",
      reaches: ["gitlab"],
      scopes: ["read_api"],
    },
    {
      match: { tokens: ["issue", "close"] },
      effect: "mutate",
      reaches: ["gitlab"],
      scopes: ["api"],
    },
    {
      match: { tokens: ["repo", "delete"] },
      effect: "none",
      reaches: [],
      scopes: [],
      guard: true,
    },
    {
      match: { tokens: ["setup", "hooks"] },
      effect: "mutate",
      reaches: ["harness-config"],
      scopes: [],
      derivation: {
        kind: "flag-presence",
        flags: ["--apply", "--uninstall"],
        present: "mutate",
        absent: "read",
      },
    },
    {
      match: { tokens: ["api"] },
      effect: "passthrough",
      reaches: ["gitlab"],
      scopes: ["api"],
      derivation: {
        kind: "http-method",
        methodFlags: ["-X", "--method"],
        valueFlags: ["-R", "--repo", "-F", "--field", "-f", "--raw-field"],
        allowPositionalMethod: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
        default: "GET",
        readMethods: ["GET", "HEAD"],
        alwaysMutateEndpoints: ["graphql"],
      },
    },
  ],
});

describe("capability document validation", () => {
  it("accepts a complete schemaVersion 1 manifest", () => {
    expect(parseCapabilityManifest(manifest)).toEqual(manifest);
  });

  it.each([
    ["unknown schema version", { ...manifest, schemaVersion: 2 }],
    ["unknown document field", { ...manifest, surprise: true }],
    [
      "unknown nested field",
      {
        ...manifest,
        routes: [{ ...manifest.routes[0], surprise: true }],
      },
    ],
    [
      "passthrough without method derivation",
      {
        ...manifest,
        routes: [{ ...manifest.routes[0], effect: "passthrough" }],
      },
    ],
    [
      "guard claiming an effect",
      {
        ...manifest,
        routes: [{ ...manifest.routes[0], guard: true }],
      },
    ],
  ])("rejects a malformed manifest: %s", (_name, value) => {
    expect(() => parseCapabilityManifest(value)).toThrow(CapabilityPolicyError);
  });

  it("allows informational x- fields without using them as schema fields", () => {
    const extended = {
      ...manifest,
      "x-review": { ticket: 42 },
      routes: [
        { ...manifest.routes[0], "x-test": { argv: ["issue", "list"] } },
      ],
    };

    expect(parseCapabilityManifest(extended)).toEqual(extended);
  });

  it("gives concrete remediation for an unsupported manifest schema", () => {
    expect(() =>
      parseCapabilityManifest({ ...manifest, schemaVersion: 7 }),
    ).toThrowError(
      expect.objectContaining({
        code: "MANIFEST_SCHEMA_UNSUPPORTED",
        message: expect.stringMatching(
          /schemaVersion 7.*supported version: 1.*install an SDK.*restore and re-pin.*v1/i,
        ),
      }),
    );
  });
});

describe("capability policy validation", () => {
  it("accepts a complete builtin schemaVersion 1 policy", () => {
    expect(parseCapabilityPolicy(policy)).toEqual(policy);
  });

  it.each([
    ["unknown engine", { ...policy, engine: "opa" }],
    ["unknown field", { ...policy, surprise: true }],
    [
      "incomplete method map",
      {
        ...policy,
        passthrough: { methods: { GET: "allow" } },
      },
    ],
    [
      "deny path rule",
      {
        ...policy,
        passthrough: {
          ...policy.passthrough,
          paths: [{ method: "POST", pattern: "projects/*", decision: "deny" }],
        },
      },
    ],
    [
      "multi-segment wildcard",
      {
        ...policy,
        passthrough: {
          ...policy.passthrough,
          paths: [{ method: "GET", pattern: "projects/**", decision: "allow" }],
        },
      },
    ],
  ])("rejects malformed policy: %s", (_name, value) => {
    expect(() => parseCapabilityPolicy(value)).toThrow(CapabilityPolicyError);
  });

  it("gives concrete remediation for an unsupported policy schema", () => {
    expect(() =>
      parseCapabilityPolicy({ ...policy, schemaVersion: 9 }),
    ).toThrowError(
      expect.objectContaining({
        code: "POLICY_SCHEMA_UNSUPPORTED",
        message: expect.stringMatching(
          /schemaVersion 9.*supported version: 1.*install an SDK.*restore and re-pin.*v1/i,
        ),
      }),
    );
  });
});

describe("canonicalSha256", () => {
  it("hashes equivalent JSON documents identically", () => {
    const expected = createHash("sha256").update('{"a":2,"b":1}').digest("hex");

    expect(canonicalSha256({ b: 1, a: 2 })).toBe(expected);
    expect(canonicalSha256('{\n  "a": 2, "b": 1\n}')).toBe(expected);
  });
});

describe("resolveCapabilityInvocation", () => {
  it.each([
    [[], "|flags-only", "read"],
    [["-R", "group/project"], "|flags-only", "read"],
    [["--help"], "--help|any", "none"],
    [["issue", "--limit", "1"], "issue|flags-only", "read"],
    [["issue", "list"], "issue list|any", "read"],
    [["issue", "close", "42"], "issue close|any", "mutate"],
    [["setup", "hooks"], "setup hooks|any", "read"],
    [["setup", "hooks", "--apply"], "setup hooks|any", "mutate"],
  ] as const)("resolves %j declaratively", (argv, routeKey, effect) => {
    expect(
      resolveCapabilityInvocation(routingManifest, [...argv]),
    ).toMatchObject({
      routeKey,
      effect,
    });
  });

  it.each([
    [["api", "projects"], "GET", "projects", "read"],
    [["api", "HEAD", "projects"], "HEAD", "projects", "read"],
    [["api", "projects", "--method=POST"], "POST", "projects", "mutate"],
    [["api", "-R", "group/project", "graphql"], "POST", "graphql", "mutate"],
    [["api", "graphql", "-X", "GET"], "POST", "graphql", "mutate"],
  ] as const)("derives API request %j", (argv, method, endpoint, effect) => {
    expect(
      resolveCapabilityInvocation(routingManifest, [...argv]),
    ).toMatchObject({
      routeKey: "api|any",
      declaredEffect: "passthrough",
      method,
      endpoint,
      effect,
    });
  });

  it.each([
    [["unknown"]],
    [["issue", "unknown"]],
    [["api", "projects", "--method=TRACE"]],
    [["api", "projects", "-X"]],
    [["api"]],
  ])("fails closed for unknown or malformed argv %j", (argv) => {
    expect(() => resolveCapabilityInvocation(routingManifest, argv)).toThrow(
      CapabilityPolicyError,
    );
  });
});

describe("evaluateCapabilityPolicy", () => {
  it("applies effect policy to first-class routes", () => {
    const read = resolveCapabilityInvocation(routingManifest, [
      "issue",
      "list",
    ]);
    const mutate = resolveCapabilityInvocation(routingManifest, [
      "issue",
      "close",
      "42",
    ]);

    expect(
      evaluateCapabilityPolicy(parseCapabilityPolicy(policy), read).decision,
    ).toBe("allow");
    expect(
      evaluateCapabilityPolicy(parseCapabilityPolicy(policy), mutate),
    ).toMatchObject({
      decision: "deny",
      reason: "EFFECT_DENIED",
    });
  });

  it("always denies guard routes", () => {
    const guarded = resolveCapabilityInvocation(routingManifest, [
      "repo",
      "delete",
      "x",
    ]);
    expect(
      evaluateCapabilityPolicy(parseCapabilityPolicy(policy), guarded),
    ).toMatchObject({
      decision: "deny",
      reason: "GUARDED_ROUTE",
    });
  });

  it("applies the passthrough method map independently of mutation policy", () => {
    const postAllowed = parseCapabilityPolicy({
      ...policy,
      effects: { ...policy.effects, mutate: "deny" },
      passthrough: {
        ...policy.passthrough,
        methods: { ...policy.passthrough.methods, POST: "allow" },
      },
    });
    const request = resolveCapabilityInvocation(routingManifest, [
      "api",
      "projects/1",
      "--method=POST",
    ]);

    expect(evaluateCapabilityPolicy(postAllowed, request).decision).toBe(
      "allow",
    );
  });

  it("path globs only narrow an allowed method", () => {
    const allowed = resolveCapabilityInvocation(routingManifest, [
      "api",
      "projects/1",
    ]);
    const denied = resolveCapabilityInvocation(routingManifest, [
      "api",
      "projects/1/access_tokens",
    ]);

    expect(
      evaluateCapabilityPolicy(parseCapabilityPolicy(policy), allowed).decision,
    ).toBe("allow");
    expect(
      evaluateCapabilityPolicy(parseCapabilityPolicy(policy), denied),
    ).toMatchObject({
      decision: "deny",
      reason: "PASSTHROUGH_PATH_DENIED",
    });
  });

  it("a mistyped path allowlist rule denies instead of granting", () => {
    const typoPolicy = parseCapabilityPolicy({
      ...policy,
      passthrough: {
        ...policy.passthrough,
        paths: [{ method: "GET", pattern: "project/*", decision: "allow" }],
      },
    });
    const request = resolveCapabilityInvocation(routingManifest, [
      "api",
      "projects/1",
    ]);

    expect(evaluateCapabilityPolicy(typoPolicy, request)).toMatchObject({
      decision: "deny",
      reason: "PASSTHROUGH_PATH_DENIED",
    });
  });

  it("path allowlist rules cannot widen a denied method", () => {
    const request = resolveCapabilityInvocation(routingManifest, [
      "api",
      "projects/1",
      "--method=POST",
    ]);

    expect(
      evaluateCapabilityPolicy(parseCapabilityPolicy(policy), request),
    ).toMatchObject({
      decision: "deny",
      reason: "PASSTHROUGH_METHOD_DENIED",
    });
  });
});

describe("verifyCapabilityPins", () => {
  const identity = {
    schemaVersion: 1,
    publisher: {
      oidcIssuer: "https://gitlab.com",
      projectPath: "axi-tooling/gl-axi",
    },
    lineage: {
      epoch: 1,
      firstTrustedPublishedVersion: "0.1.1",
      endorsements: [],
    },
  };

  it("verifies canonical manifest hash and publisher identity pins", () => {
    const pinned = parseCapabilityPolicy({
      ...policy,
      pins: {
        ...policy.pins,
        manifestSha256: canonicalSha256(routingManifest),
      },
    });

    expect(
      verifyCapabilityPins({
        manifest: routingManifest,
        policy: pinned,
        identity,
      }),
    ).toEqual({
      verified: true,
      manifestSha256: canonicalSha256(routingManifest),
      policySha256: canonicalSha256(pinned),
      publisher: identity.publisher,
    });
  });

  it("fails closed on a manifest hash mismatch", () => {
    expect(() =>
      verifyCapabilityPins({
        manifest: routingManifest,
        policy: parseCapabilityPolicy(policy),
        identity,
      }),
    ).toThrowError(expect.objectContaining({ code: "MANIFEST_HASH_MISMATCH" }));
  });

  it("fails closed on a publisher identity mismatch", () => {
    const pinned = parseCapabilityPolicy({
      ...policy,
      pins: {
        manifestSha256: canonicalSha256(routingManifest),
        publisher: { ...policy.pins.publisher, projectPath: "other/project" },
      },
    });

    expect(() =>
      verifyCapabilityPins({
        manifest: routingManifest,
        policy: pinned,
        identity,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "PUBLISHER_IDENTITY_MISMATCH" }),
    );
  });

  it("gives concrete remediation for an unsupported identity schema", () => {
    const pinned = parseCapabilityPolicy({
      ...policy,
      pins: {
        ...policy.pins,
        manifestSha256: canonicalSha256(routingManifest),
      },
    });

    expect(() =>
      verifyCapabilityPins({
        manifest: routingManifest,
        policy: pinned,
        identity: { ...identity, schemaVersion: 4 } as typeof identity,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "IDENTITY_SCHEMA_UNSUPPORTED",
        message: expect.stringMatching(
          /schemaVersion 4.*supported version: 1.*install an SDK.*restore and re-pin.*v1/i,
        ),
      }),
    );
  });
});
