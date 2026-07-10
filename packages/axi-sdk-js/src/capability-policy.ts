import { createHash } from "node:crypto";

export type CapabilityEffect = "read" | "mutate" | "passthrough" | "none";
export type DerivedCapabilityEffect = Exclude<CapabilityEffect, "passthrough">;
export type CapabilityReach = "gitlab" | "harness-config" | "filesystem";
export type CapabilityScope = "read_api" | "api" | "read_repository";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
export type PolicyDecision = "allow" | "deny";

export interface CapabilityMatch {
  tokens: string[];
  rest?: "any" | "flags-only";
  [extension: `x-${string}`]: unknown;
}

export interface HttpMethodDerivation {
  kind: "http-method";
  methodFlags: string[];
  valueFlags?: string[];
  allowPositionalMethod: boolean;
  methods: HttpMethod[];
  default: HttpMethod;
  readMethods: Array<"GET" | "HEAD">;
  alwaysMutateEndpoints?: string[];
  [extension: `x-${string}`]: unknown;
}

export interface FlagPresenceDerivation {
  kind: "flag-presence";
  flags: string[];
  present: CapabilityEffect;
  absent: CapabilityEffect;
  [extension: `x-${string}`]: unknown;
}

export interface CapabilityRoute {
  match: CapabilityMatch;
  effect: CapabilityEffect;
  reaches: CapabilityReach[];
  scopes: CapabilityScope[];
  derivation?: HttpMethodDerivation | FlagPresenceDerivation;
  aliasOf?: string[];
  guard?: boolean;
  [extension: `x-${string}`]: unknown;
}

export interface CapabilityManifest {
  schemaVersion: 1;
  tool: {
    name: string;
    bin: string;
    [extension: `x-${string}`]: unknown;
  };
  routes: CapabilityRoute[];
  [extension: `x-${string}`]: unknown;
}

export interface PublisherIdentity {
  oidcIssuer: string;
  projectPath: string;
}

export interface CapabilityPins {
  manifestSha256: string;
  publisher: PublisherIdentity;
}

export interface PassthroughPathRule {
  method: HttpMethod;
  pattern: string;
  decision: "allow";
}

export interface CapabilityPolicy {
  schemaVersion: 1;
  engine: "builtin";
  pins: CapabilityPins;
  effects: Record<DerivedCapabilityEffect, PolicyDecision>;
  passthrough: {
    methods: Record<HttpMethod, PolicyDecision>;
    paths?: PassthroughPathRule[];
  };
  [extension: `x-${string}`]: unknown;
}

export interface PublisherIdentityDocument {
  schemaVersion: 1;
  publisher: PublisherIdentity;
  lineage?: unknown;
  [extension: `x-${string}`]: unknown;
}

export interface ResolvedCapabilityInvocation {
  routeKey: string;
  declaredEffect: CapabilityEffect;
  effect: CapabilityEffect;
  reaches: CapabilityReach[];
  scopes: CapabilityScope[];
  method?: HttpMethod;
  endpoint?: string;
  guard: boolean;
}

export interface CapabilityPolicyDecision extends ResolvedCapabilityInvocation {
  decision: PolicyDecision;
  reason?:
    | "GUARDED_ROUTE"
    | "EFFECT_DENIED"
    | "PASSTHROUGH_METHOD_DENIED"
    | "PASSTHROUGH_PATH_DENIED";
}

export interface VerifyCapabilityPinsInput {
  manifest: CapabilityManifest;
  policy: CapabilityPolicy;
  identity: PublisherIdentityDocument;
}

export interface VerifiedCapabilityPins {
  verified: true;
  manifestSha256: string;
  policySha256: string;
  publisher: PublisherIdentity;
}

export class CapabilityPolicyError extends Error {
  readonly code: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: string,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "CapabilityPolicyError";
    this.code = code;
    this.details = details;
  }
}

type JsonObject = Record<string, unknown>;

function fail(code: string, message: string, path?: string): never {
  throw new CapabilityPolicyError(code, message, path ? { path } : undefined);
}

function objectAt(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("MANIFEST_INVALID", `${path} must be an object.`, path);
  }
  return value as JsonObject;
}

function exactKeys(value: JsonObject, allowed: string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key) && !key.startsWith("x-")) {
      fail(
        "MANIFEST_INVALID",
        `${path}.${key} is not supported.`,
        `${path}.${key}`,
      );
    }
  }
}

function stringAt(value: unknown, path: string, pattern?: RegExp): string {
  if (typeof value !== "string" || (pattern && !pattern.test(value))) {
    fail("MANIFEST_INVALID", `${path} is not a valid string.`, path);
  }
  return value as string;
}

function enumAt<T extends string>(
  value: unknown,
  choices: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    fail("MANIFEST_INVALID", `${path} has an unsupported value.`, path);
  }
  return value as T;
}

function arrayAt(value: unknown, path: string, minItems = 0): unknown[] {
  if (!Array.isArray(value) || value.length < minItems) {
    fail("MANIFEST_INVALID", `${path} must be an array.`, path);
  }
  return value as unknown[];
}

function unique<T>(values: T[], path: string): T[] {
  if (new Set(values).size !== values.length) {
    fail("MANIFEST_INVALID", `${path} must not contain duplicates.`, path);
  }
  return values;
}

const EFFECTS = ["read", "mutate", "passthrough", "none"] as const;
const REACHES = ["gitlab", "harness-config", "filesystem"] as const;
const SCOPES = ["read_api", "api", "read_repository"] as const;
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;
const READ_METHODS = ["GET", "HEAD"] as const;
const TOKEN_PATTERN = /^(?:[a-z][a-z0-9-]*|-{1,2}[A-Za-z][A-Za-z0-9-]*)$/;
const FLAG_PATTERN = /^-{1,2}[A-Za-z][A-Za-z-]*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function unsupportedSchemaMessage(document: string, actual: unknown): string {
  return `${document} schemaVersion ${String(actual)} is not supported; supported version: 1. Install an SDK version that supports schemaVersion ${String(actual)}, or restore and re-pin a supported v1 document.`;
}

function enumArray<T extends string>(
  value: unknown,
  choices: readonly T[],
  path: string,
  options: { minItems?: number; unique?: boolean } = {},
): T[] {
  const values = arrayAt(value, path, options.minItems).map((entry, index) =>
    enumAt(entry, choices, `${path}[${index}]`),
  );
  return options.unique ? unique(values, path) : values;
}

function stringArray(
  value: unknown,
  path: string,
  options: { minItems?: number; unique?: boolean; pattern?: RegExp } = {},
): string[] {
  const values = arrayAt(value, path, options.minItems).map((entry, index) =>
    stringAt(entry, `${path}[${index}]`, options.pattern),
  );
  return options.unique ? unique(values, path) : values;
}

function validateDerivation(value: unknown, path: string): void {
  const derivation = objectAt(value, path);
  if (derivation.kind === "http-method") {
    exactKeys(
      derivation,
      [
        "kind",
        "methodFlags",
        "valueFlags",
        "allowPositionalMethod",
        "methods",
        "default",
        "readMethods",
        "alwaysMutateEndpoints",
      ],
      path,
    );
    stringArray(derivation.methodFlags, `${path}.methodFlags`, {
      minItems: 1,
      pattern: FLAG_PATTERN,
    });
    if (derivation.valueFlags !== undefined) {
      stringArray(derivation.valueFlags, `${path}.valueFlags`, {
        unique: true,
        pattern: FLAG_PATTERN,
      });
    }
    if (typeof derivation.allowPositionalMethod !== "boolean") {
      fail(
        "MANIFEST_INVALID",
        `${path}.allowPositionalMethod must be boolean.`,
        path,
      );
    }
    const methods = enumArray(
      derivation.methods,
      HTTP_METHODS,
      `${path}.methods`,
      {
        minItems: 1,
        unique: true,
      },
    );
    const defaultMethod = enumAt(
      derivation.default,
      HTTP_METHODS,
      `${path}.default`,
    );
    if (!methods.includes(defaultMethod)) {
      fail(
        "MANIFEST_INVALID",
        `${path}.default must be included in methods.`,
        path,
      );
    }
    const readMethods = enumArray(
      derivation.readMethods,
      READ_METHODS,
      `${path}.readMethods`,
      { unique: true },
    );
    if (readMethods.some((method) => !methods.includes(method))) {
      fail(
        "MANIFEST_INVALID",
        `${path}.readMethods must be included in methods.`,
        path,
      );
    }
    if (derivation.alwaysMutateEndpoints !== undefined) {
      const endpoints = stringArray(
        derivation.alwaysMutateEndpoints,
        `${path}.alwaysMutateEndpoints`,
        { unique: true },
      );
      if (endpoints.some((endpoint) => endpoint.length === 0)) {
        fail(
          "MANIFEST_INVALID",
          `${path}.alwaysMutateEndpoints cannot be empty.`,
          path,
        );
      }
    }
    return;
  }

  if (derivation.kind === "flag-presence") {
    exactKeys(derivation, ["kind", "flags", "present", "absent"], path);
    stringArray(derivation.flags, `${path}.flags`, {
      minItems: 1,
      pattern: FLAG_PATTERN,
    });
    enumAt(derivation.present, EFFECTS, `${path}.present`);
    enumAt(derivation.absent, EFFECTS, `${path}.absent`);
    return;
  }

  fail("MANIFEST_INVALID", `${path}.kind is not supported.`, `${path}.kind`);
}

function validateRoute(value: unknown, path: string): void {
  const route = objectAt(value, path);
  exactKeys(
    route,
    ["match", "effect", "reaches", "scopes", "derivation", "aliasOf", "guard"],
    path,
  );
  const match = objectAt(route.match, `${path}.match`);
  exactKeys(match, ["tokens", "rest"], `${path}.match`);
  stringArray(match.tokens, `${path}.match.tokens`, { pattern: TOKEN_PATTERN });
  if (match.rest !== undefined) {
    enumAt(match.rest, ["any", "flags-only"] as const, `${path}.match.rest`);
  }

  const effect = enumAt(route.effect, EFFECTS, `${path}.effect`);
  const reaches = enumArray(route.reaches, REACHES, `${path}.reaches`, {
    unique: true,
  });
  const scopes = enumArray(route.scopes, SCOPES, `${path}.scopes`, {
    unique: true,
  });
  if (route.derivation !== undefined) {
    validateDerivation(route.derivation, `${path}.derivation`);
  }
  if (effect === "passthrough" && route.derivation === undefined) {
    fail(
      "MANIFEST_INVALID",
      `${path}.derivation is required for passthrough.`,
      path,
    );
  }
  if (route.aliasOf !== undefined) {
    stringArray(route.aliasOf, `${path}.aliasOf`, { minItems: 1 });
  }
  if (route.guard !== undefined && typeof route.guard !== "boolean") {
    fail("MANIFEST_INVALID", `${path}.guard must be boolean.`, `${path}.guard`);
  }
  if (
    route.guard === true &&
    (effect !== "none" || reaches.length || scopes.length)
  ) {
    fail("MANIFEST_INVALID", `${path} guard routes must have no effect.`, path);
  }
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CapabilityPolicyError(
        "CANONICAL_JSON_INVALID",
        "Canonical JSON cannot contain a non-finite number.",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new CapabilityPolicyError(
    "CANONICAL_JSON_INVALID",
    `Canonical JSON cannot represent ${typeof value}.`,
  );
}

export function canonicalSha256(value: unknown): string {
  let bytes: string | Uint8Array;
  if (value instanceof Uint8Array) {
    bytes = value;
  } else if (typeof value === "string") {
    try {
      bytes = canonicalJson(JSON.parse(value));
    } catch (error) {
      if (error instanceof CapabilityPolicyError) {
        throw error;
      }
      bytes = value;
    }
  } else {
    bytes = canonicalJson(value);
  }
  return createHash("sha256").update(bytes).digest("hex");
}

export function parseCapabilityManifest(input: unknown): CapabilityManifest {
  const manifest = objectAt(input, "manifest");
  if (manifest.schemaVersion !== 1) {
    fail(
      "MANIFEST_SCHEMA_UNSUPPORTED",
      unsupportedSchemaMessage("Capability manifest", manifest.schemaVersion),
      "manifest.schemaVersion",
    );
  }
  exactKeys(manifest, ["schemaVersion", "tool", "routes"], "manifest");
  const tool = objectAt(manifest.tool, "manifest.tool");
  exactKeys(tool, ["name", "bin"], "manifest.tool");
  stringAt(tool.name, "manifest.tool.name", /^[a-z0-9][a-z0-9._@/-]*$/);
  stringAt(tool.bin, "manifest.tool.bin", /^[a-z0-9][a-z0-9._-]*$/);
  const routes = arrayAt(manifest.routes, "manifest.routes", 1);
  routes.forEach((route, index) =>
    validateRoute(route, `manifest.routes[${index}]`),
  );

  const routeKeys = routes.map((route) => {
    const match = (route as JsonObject).match as JsonObject;
    return `${(match.tokens as string[]).join("\0")}|${String(match.rest ?? "any")}`;
  });
  unique(routeKeys, "manifest.routes match patterns");

  return input as CapabilityManifest;
}

function policyFail(message: string, path: string): never {
  throw new CapabilityPolicyError("POLICY_INVALID", message, { path });
}

function policyObject(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    policyFail(`${path} must be an object.`, path);
  }
  return value as JsonObject;
}

function policyKeys(value: JsonObject, allowed: string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key) && !key.startsWith("x-")) {
      policyFail(`${path}.${key} is not supported.`, `${path}.${key}`);
    }
  }
  for (const key of allowed) {
    if (!(key in value)) {
      policyFail(`${path}.${key} is required.`, `${path}.${key}`);
    }
  }
}

function policyString(value: unknown, path: string, pattern?: RegExp): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    (pattern && !pattern.test(value))
  ) {
    policyFail(`${path} is not a valid string.`, path);
  }
  return value as string;
}

function policyDecision(value: unknown, path: string): PolicyDecision {
  if (value !== "allow" && value !== "deny") {
    policyFail(`${path} must be allow or deny.`, path);
  }
  return value as PolicyDecision;
}

function validatePathPattern(value: unknown, path: string): void {
  const pattern = policyString(value, path);
  const normalized = pattern.startsWith("/") ? pattern.slice(1) : pattern;
  if (
    normalized.length === 0 ||
    normalized.endsWith("/") ||
    normalized.split("/").some((segment) => {
      return (
        segment.length === 0 || (segment !== "*" && /[*\s]/u.test(segment))
      );
    })
  ) {
    policyFail(
      `${path} may contain only literal segments and * segments.`,
      path,
    );
  }
}

export function parseCapabilityPolicy(input: unknown): CapabilityPolicy {
  const policy = policyObject(input, "policy");
  if (policy.schemaVersion !== 1) {
    throw new CapabilityPolicyError(
      "POLICY_SCHEMA_UNSUPPORTED",
      unsupportedSchemaMessage("Capability policy", policy.schemaVersion),
      { path: "policy.schemaVersion" },
    );
  }
  policyKeys(
    policy,
    ["schemaVersion", "engine", "pins", "effects", "passthrough"],
    "policy",
  );
  if (policy.engine !== "builtin") {
    policyFail(
      "policy.engine must be builtin for schemaVersion 1.",
      "policy.engine",
    );
  }

  const pins = policyObject(policy.pins, "policy.pins");
  policyKeys(pins, ["manifestSha256", "publisher"], "policy.pins");
  policyString(
    pins.manifestSha256,
    "policy.pins.manifestSha256",
    SHA256_PATTERN,
  );
  const publisher = policyObject(pins.publisher, "policy.pins.publisher");
  policyKeys(publisher, ["oidcIssuer", "projectPath"], "policy.pins.publisher");
  policyString(publisher.oidcIssuer, "policy.pins.publisher.oidcIssuer");
  policyString(
    publisher.projectPath,
    "policy.pins.publisher.projectPath",
    /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/,
  );

  const effects = policyObject(policy.effects, "policy.effects");
  policyKeys(effects, ["none", "read", "mutate"], "policy.effects");
  for (const effect of ["none", "read", "mutate"] as const) {
    policyDecision(effects[effect], `policy.effects.${effect}`);
  }

  const passthrough = policyObject(policy.passthrough, "policy.passthrough");
  const passthroughAllowed = ["methods", "paths"];
  for (const key of Object.keys(passthrough)) {
    if (!passthroughAllowed.includes(key) && !key.startsWith("x-")) {
      policyFail(
        `policy.passthrough.${key} is not supported.`,
        `policy.passthrough.${key}`,
      );
    }
  }
  if (!("methods" in passthrough)) {
    policyFail(
      "policy.passthrough.methods is required.",
      "policy.passthrough.methods",
    );
  }
  const methods = policyObject(
    passthrough.methods,
    "policy.passthrough.methods",
  );
  policyKeys(methods, [...HTTP_METHODS], "policy.passthrough.methods");
  for (const method of HTTP_METHODS) {
    policyDecision(methods[method], `policy.passthrough.methods.${method}`);
  }
  if (passthrough.paths !== undefined) {
    if (!Array.isArray(passthrough.paths)) {
      policyFail(
        "policy.passthrough.paths must be an array.",
        "policy.passthrough.paths",
      );
    }
    passthrough.paths.forEach((value, index) => {
      const path = `policy.passthrough.paths[${index}]`;
      const rule = policyObject(value, path);
      policyKeys(rule, ["method", "pattern", "decision"], path);
      if (!HTTP_METHODS.includes(rule.method as HttpMethod)) {
        policyFail(`${path}.method is not supported.`, `${path}.method`);
      }
      validatePathPattern(rule.pattern, `${path}.pattern`);
      if (rule.decision !== "allow") {
        policyFail(
          `${path}.decision must be allow (path rules are restrict-only allowlist entries).`,
          `${path}.decision`,
        );
      }
    });
  }
  return input as CapabilityPolicy;
}

function capabilityRouteKey(match: CapabilityMatch): string {
  return `${match.tokens.join(" ")}|${match.rest ?? "any"}`;
}

function routeMatches(
  argv: readonly string[],
  match: CapabilityMatch,
): boolean {
  if (match.tokens.length > argv.length) {
    return false;
  }
  if (!match.tokens.every((token, index) => token === argv[index])) {
    return false;
  }
  if ((match.rest ?? "any") === "any") {
    return true;
  }
  const remainder = argv.slice(match.tokens.length);
  return remainder.every((token, index) => {
    if (token.startsWith("-")) return true;
    const previous = remainder[index - 1];
    return (
      previous !== undefined &&
      previous.startsWith("-") &&
      !previous.includes("=")
    );
  });
}

interface DerivedHttpRequest {
  method: HttpMethod;
  endpoint?: string;
}

function deriveHttpRequest(
  argv: readonly string[],
  derivation: HttpMethodDerivation,
): DerivedHttpRequest {
  const accepted = new Set<string>(derivation.methods);
  const positionals: string[] = [];
  let flagged: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (derivation.methodFlags.includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new CapabilityPolicyError(
          "HTTP_METHOD_REQUIRED",
          `${arg} requires an HTTP method.`,
        );
      }
      flagged = value.toUpperCase();
      if (!accepted.has(flagged)) {
        throw new CapabilityPolicyError(
          "HTTP_METHOD_UNSUPPORTED",
          `HTTP method ${value} is not declared by the manifest.`,
          { value },
        );
      }
      index += 1;
      continue;
    }

    const equalsMethodFlag = derivation.methodFlags.find((flag) =>
      arg.startsWith(`${flag}=`),
    );
    if (equalsMethodFlag !== undefined) {
      const value = arg.slice(equalsMethodFlag.length + 1);
      if (!value) {
        throw new CapabilityPolicyError(
          "HTTP_METHOD_REQUIRED",
          `${equalsMethodFlag} requires an HTTP method.`,
        );
      }
      flagged = value.toUpperCase();
      if (!accepted.has(flagged)) {
        throw new CapabilityPolicyError(
          "HTTP_METHOD_UNSUPPORTED",
          `HTTP method ${value} is not declared by the manifest.`,
          { value },
        );
      }
      continue;
    }

    if (derivation.valueFlags?.includes(arg)) {
      index += 1;
      continue;
    }
    if (derivation.valueFlags?.some((flag) => arg.startsWith(`${flag}=`))) {
      continue;
    }
    if (!arg.startsWith("-")) {
      positionals.push(arg);
    }
  }

  let method =
    flagged && accepted.has(flagged) ? (flagged as HttpMethod) : undefined;
  if (derivation.allowPositionalMethod) {
    const candidate = positionals[0]?.toUpperCase();
    if (candidate && accepted.has(candidate)) {
      method = candidate as HttpMethod;
      positionals.shift();
    } else if (
      candidate &&
      /^[A-Z]+$/.test(positionals[0] as string) &&
      positionals.length > 1
    ) {
      throw new CapabilityPolicyError(
        "HTTP_METHOD_UNSUPPORTED",
        `HTTP method ${positionals[0]} is not declared by the manifest.`,
        { value: positionals[0] },
      );
    }
  }

  const endpoint = positionals[0];
  if (endpoint === undefined) {
    throw new CapabilityPolicyError(
      "HTTP_ENDPOINT_REQUIRED",
      "Passthrough invocation requires an endpoint.",
    );
  }
  if (positionals.length > 1) {
    throw new CapabilityPolicyError(
      "HTTP_ENDPOINT_AMBIGUOUS",
      "Passthrough invocation must name exactly one endpoint.",
      { positionals: [...positionals] },
    );
  }
  const normalizedEndpoint = endpoint.replace(/^\/+/, "");
  if (
    derivation.alwaysMutateEndpoints?.some(
      (always) => always.replace(/^\/+/, "") === normalizedEndpoint,
    )
  ) {
    return { method: "POST", endpoint };
  }
  return { method: method ?? derivation.default, endpoint };
}

export function resolveCapabilityInvocation(
  manifest: CapabilityManifest,
  argv: readonly string[],
): ResolvedCapabilityInvocation {
  parseCapabilityManifest(manifest);
  if (!Array.isArray(argv) || argv.some((token) => typeof token !== "string")) {
    throw new CapabilityPolicyError(
      "ARGV_INVALID",
      "Capability invocation argv must be an array of strings.",
    );
  }

  const candidates = manifest.routes.filter((route) =>
    routeMatches(argv, route.match),
  );
  if (candidates.length === 0) {
    throw new CapabilityPolicyError(
      "ROUTE_UNKNOWN",
      "Invocation does not match a declared capability route.",
      { argv: [...argv] },
    );
  }
  const longest = Math.max(
    ...candidates.map((route) => route.match.tokens.length),
  );
  const matches = candidates.filter(
    (route) => route.match.tokens.length === longest,
  );
  if (matches.length !== 1) {
    throw new CapabilityPolicyError(
      "ROUTE_AMBIGUOUS",
      "Invocation matches more than one capability route.",
      { routeKeys: matches.map((route) => capabilityRouteKey(route.match)) },
    );
  }

  const route = matches[0] as CapabilityRoute;
  const remainder = argv.slice(route.match.tokens.length);
  let effect = route.effect;
  let method: HttpMethod | undefined;
  let endpoint: string | undefined;
  if (route.derivation?.kind === "flag-presence") {
    const present = remainder.some((arg) =>
      route.derivation?.kind === "flag-presence"
        ? route.derivation.flags.some(
            (flag) => arg === flag || arg.startsWith(`${flag}=`),
          )
        : false,
    );
    effect = present ? route.derivation.present : route.derivation.absent;
  } else if (route.derivation?.kind === "http-method") {
    ({ method, endpoint } = deriveHttpRequest(remainder, route.derivation));
    effect = route.derivation.readMethods.includes(method as "GET" | "HEAD")
      ? "read"
      : "mutate";
  }

  return {
    routeKey: capabilityRouteKey(route.match),
    declaredEffect: route.effect,
    effect,
    reaches: [...route.reaches],
    scopes: [...route.scopes],
    method,
    endpoint,
    guard: route.guard ?? false,
  };
}

function pathMatches(pattern: string, endpoint: string): boolean {
  const normalize = (value: string): string[] => {
    const withoutLeading = value.startsWith("/") ? value.slice(1) : value;
    return withoutLeading.split("/");
  };
  const expected = normalize(pattern);
  const actual = normalize(endpoint);
  return (
    expected.length === actual.length &&
    expected.every(
      (segment, index) => segment === "*" || segment === actual[index],
    )
  );
}

export function evaluateCapabilityPolicy(
  policy: CapabilityPolicy,
  resolution: ResolvedCapabilityInvocation,
): CapabilityPolicyDecision {
  parseCapabilityPolicy(policy);
  if (
    typeof resolution !== "object" ||
    resolution === null ||
    typeof resolution.routeKey !== "string" ||
    !EFFECTS.includes(resolution.declaredEffect) ||
    !EFFECTS.includes(resolution.effect) ||
    !Array.isArray(resolution.reaches) ||
    !Array.isArray(resolution.scopes) ||
    typeof resolution.guard !== "boolean"
  ) {
    throw new CapabilityPolicyError(
      "RESOLUTION_INVALID",
      "Capability resolution is malformed; policy evaluation denied.",
    );
  }

  if (resolution.guard) {
    return { ...resolution, decision: "deny", reason: "GUARDED_ROUTE" };
  }

  if (resolution.declaredEffect === "passthrough") {
    if (!resolution.method || !HTTP_METHODS.includes(resolution.method)) {
      throw new CapabilityPolicyError(
        "PASSTHROUGH_METHOD_UNKNOWN",
        "Passthrough route did not resolve to a declared HTTP method.",
      );
    }
    if (policy.passthrough.methods[resolution.method] !== "allow") {
      return {
        ...resolution,
        decision: "deny",
        reason: "PASSTHROUGH_METHOD_DENIED",
      };
    }
    const methodPathRules = policy.passthrough.paths?.filter(
      (rule) => rule.method === resolution.method,
    );
    if (
      methodPathRules !== undefined &&
      methodPathRules.length > 0 &&
      (resolution.endpoint === undefined ||
        !methodPathRules.some((rule) =>
          pathMatches(rule.pattern, resolution.endpoint as string),
        ))
    ) {
      return {
        ...resolution,
        decision: "deny",
        reason: "PASSTHROUGH_PATH_DENIED",
      };
    }
    return { ...resolution, decision: "allow" };
  }

  if (resolution.effect === "passthrough") {
    throw new CapabilityPolicyError(
      "EFFECT_UNRESOLVED",
      "Capability effect remained passthrough after derivation.",
    );
  }
  if (policy.effects[resolution.effect] !== "allow") {
    return { ...resolution, decision: "deny", reason: "EFFECT_DENIED" };
  }
  return { ...resolution, decision: "allow" };
}

function parsePublisherIdentityDocument(
  input: unknown,
): PublisherIdentityDocument {
  const identity = policyObject(input, "identity");
  if (identity.schemaVersion !== 1) {
    throw new CapabilityPolicyError(
      "IDENTITY_SCHEMA_UNSUPPORTED",
      unsupportedSchemaMessage("Publisher identity", identity.schemaVersion),
    );
  }
  for (const key of Object.keys(identity)) {
    if (
      !["schemaVersion", "publisher", "lineage"].includes(key) &&
      !key.startsWith("x-")
    ) {
      throw new CapabilityPolicyError(
        "IDENTITY_INVALID",
        `identity.${key} is not supported.`,
        { path: `identity.${key}` },
      );
    }
  }
  const publisher = policyObject(identity.publisher, "identity.publisher");
  policyKeys(publisher, ["oidcIssuer", "projectPath"], "identity.publisher");
  policyString(publisher.oidcIssuer, "identity.publisher.oidcIssuer");
  policyString(
    publisher.projectPath,
    "identity.publisher.projectPath",
    /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/,
  );
  if (identity.lineage !== undefined) {
    const lineage = policyObject(identity.lineage, "identity.lineage");
    for (const key of Object.keys(lineage)) {
      if (
        !["epoch", "firstTrustedPublishedVersion", "endorsements"].includes(
          key,
        ) &&
        !key.startsWith("x-")
      ) {
        throw new CapabilityPolicyError(
          "IDENTITY_INVALID",
          `identity.lineage.${key} is not supported.`,
          { path: `identity.lineage.${key}` },
        );
      }
    }
    if (!Number.isInteger(lineage.epoch) || (lineage.epoch as number) < 1) {
      throw new CapabilityPolicyError(
        "IDENTITY_INVALID",
        "identity.lineage.epoch must be a positive integer.",
      );
    }
    policyString(
      lineage.firstTrustedPublishedVersion,
      "identity.lineage.firstTrustedPublishedVersion",
    );
    if (!Array.isArray(lineage.endorsements)) {
      throw new CapabilityPolicyError(
        "IDENTITY_INVALID",
        "identity.lineage.endorsements must be an array.",
      );
    }
  }
  return input as PublisherIdentityDocument;
}

export function verifyCapabilityPins({
  manifest,
  policy,
  identity,
}: VerifyCapabilityPinsInput): VerifiedCapabilityPins {
  parseCapabilityManifest(manifest);
  parseCapabilityPolicy(policy);
  const validatedIdentity = parsePublisherIdentityDocument(identity);
  const manifestSha256 = canonicalSha256(manifest);
  if (manifestSha256 !== policy.pins.manifestSha256) {
    throw new CapabilityPolicyError(
      "MANIFEST_HASH_MISMATCH",
      "Installed capability manifest does not match the policy hash pin.",
      { expected: policy.pins.manifestSha256, actual: manifestSha256 },
    );
  }
  const actualPublisher = validatedIdentity.publisher;
  const expectedPublisher = policy.pins.publisher;
  if (
    actualPublisher.oidcIssuer !== expectedPublisher.oidcIssuer ||
    actualPublisher.projectPath !== expectedPublisher.projectPath
  ) {
    throw new CapabilityPolicyError(
      "PUBLISHER_IDENTITY_MISMATCH",
      "Installed publisher identity does not match the policy identity pin.",
      { expected: expectedPublisher, actual: actualPublisher },
    );
  }
  return {
    verified: true,
    manifestSha256,
    policySha256: canonicalSha256(policy),
    publisher: { ...actualPublisher },
  };
}
