import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeEndpoint } from "../lib/config.mjs";

async function schema(name) {
  const url = new URL(`../../../schemas/${name}.schema.json`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

test("capture schema is a strict conversation-text allowlist", async () => {
  const capture = await schema("capture-request");
  assert.equal(capture.additionalProperties, false);
  assert.deepEqual(capture.required, ["client", "event_id", "session_id", "messages"]);
  assert.equal(capture.properties.messages.maxItems, 24);
  assert.equal(capture.properties.messages.items.additionalProperties, false);
  assert.deepEqual(
    Object.keys(capture.properties.messages.items.properties).sort(),
    ["content", "id", "role"],
  );
});

test("telemetry schema cannot accept content or identity metadata", async () => {
  const telemetry = await schema("telemetry-request");
  assert.equal(telemetry.additionalProperties, false);
  assert.deepEqual(Object.keys(telemetry.properties).sort(), [
    "client",
    "event",
    "install_id",
    "platform",
    "version",
  ]);
});

test("recall requires provenance on every memory", async () => {
  const recall = await schema("recall-response");
  const memory = recall.$defs.memory;
  assert.equal(memory.additionalProperties, false);
  assert.ok(memory.required.includes("origin"));
  assert.ok(memory.required.includes("confidence"));
  assert.ok(memory.required.includes("receipts"));
  assert.equal(memory.properties.receipts.minItems, 1);
});

test("remote endpoints require HTTPS before credentials can be sent", () => {
  assert.equal(normalizeEndpoint("https://memory.example.com/"), "https://memory.example.com");
  assert.throws(() => normalizeEndpoint("http://memory.example.com"), /insecure_endpoint/);
  assert.throws(() => normalizeEndpoint("https://user:pass@example.com"), /invalid_endpoint/);
  assert.throws(() => normalizeEndpoint("https://example.com?token=secret"), /invalid_endpoint/);
});

test("plain HTTP is restricted to explicit loopback development hosts", () => {
  assert.equal(normalizeEndpoint("http://localhost:8787/"), "http://localhost:8787");
  assert.equal(normalizeEndpoint("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
  assert.equal(normalizeEndpoint("http://[::1]:8787"), "http://[::1]:8787");
  assert.throws(() => normalizeEndpoint("http://0.0.0.0:8787"), /insecure_endpoint/);
});

// Exercise the published schemas used by the installed plugin, not today's
// hosted service's divergent refusals. Fixtures have no operational data.
import { conforms, utcInstant, parseSessionStartRequest, parseSessionStartResponse as parseResponse,
  parsePauseState, classifyHostedReply } from "../lib/hosted-contract.mjs";
import { HOSTED_SCHEMAS } from "../lib/hosted-schemas.mjs";
import { sessionContext, group, instant } from "./hosted-fixtures.mjs";

const parseSessionStartResponse = (value, request, limits = {}) =>
  parseResponse(value, request, { countTokens: () => 100, ...limits });


for (const name of Object.keys(HOSTED_SCHEMAS)) {
  test(`${name}: bundled schema equals published source`, async () => {
    assert.deepEqual(HOSTED_SCHEMAS[name], await schema(name));
  });
}
const validResets = [undefined, instant, "2028-02-29T23:59:59Z",
  "2026-10-01T00:00:00.123456+00:00"];
const invalidResets = [null, 0, "", "tomorrow", "2026-02-30T00:00:00Z",
  "2026-02-29T00:00:00Z", "2026-10-01", "2026-10-01T24:00:00Z",
  "2026-10-01T00:00:60Z", "2026-10-01T00:00:00+08:00", "Infinity",
  "2026-13-01T00:00:00Z", "2026-10-00T00:00:00Z"];
for (const endpoint of ["recall", "capture"]) {
  const name = `${endpoint}-response`;
  const path = `/api/memory/${endpoint}`;
  const success = endpoint === "recall" ? { memories: [] } : { duplicate: false, memoryCount: 0 };
  test(`${endpoint}: success is separate from quota refusal`, () => {
    assert.equal(conforms(name, success), true);
    assert.notEqual(classifyHostedReply(path, 200, success).status, "quota_reached");
    assert.equal(classifyHostedReply(path, 429, success).status, "error");
    assert.equal(classifyHostedReply(path, 200, { error: "quota_reached" }).status, "error");
  });
  for (const resetAt of validResets) {
    test(`${endpoint}: valid refusal reset ${resetAt ?? "unknown"}`, () => {
      const refusal = { error: "quota_reached", ...(resetAt === undefined ? {} : { resetAt }) };
      assert.equal(conforms(name, refusal), true);
      assert.deepEqual(classifyHostedReply(path, 429, refusal), {
        status: "quota_reached", resetAt: resetAt ?? null,
      });
    });
  }
  for (const resetAt of invalidResets) {
    test(`${endpoint}: rejects invalid reset ${JSON.stringify(resetAt)}`, () => {
      const value = { error: "quota_reached", resetAt };
      assert.equal(conforms(name, value), false);
      assert.equal(classifyHostedReply(path, 429, value).status, "error");
    });
  }
  for (const extra of [{ memories: [] }, { duplicate: false }, { processing: true },
    { memoryCount: 0 }, { code: "daily_quota_memory_recall" }, { secret: "synthetic" }]) {
    test(`${endpoint}: rejects refusal with ${Object.keys(extra)[0]}`, () => {
      assert.equal(conforms(name, { error: "quota_reached", ...extra }), false);
    });
  }
  test(`${endpoint}: success rejects unknown field`, () => {
    assert.equal(conforms(name, { ...success, extra: 1 }), false);
  });
}
for (const processing of [undefined, false, true]) {
  test(`capture processing ${processing}`, () => {
    const value = { duplicate: true, memoryCount: 0,
      ...(processing === undefined ? {} : { processing }) };
    assert.equal(conforms("capture-response", value), true);
    assert.equal(classifyHostedReply("/api/memory/capture", 200, value).status,
      processing ? "processing" : "duplicate");
  });
}
for (const client of ["claude-code", "codex", "other"]) {
  test(`capture discriminator ${client}`, () => {
    assert.equal(conforms("capture-request", { client, event_id: "synthetic-event",
      session_id: "session", messages: [{ id: "message", role: "user", content: "Synthetic" }] }),
    client !== "other");
  });
}
test("UTC calendar handling rejects century overflow and accepts leap year", () => {
  assert.equal(utcInstant("1900-02-29T00:00:00Z"), false);
  assert.equal(utcInstant("2000-02-29T00:00:00Z"), true);
});
test("session-start request defaults and exact project switch", () => {
  assert.deepEqual(parseSessionStartRequest({ version: 1 }), {
    version: 1, max_tokens: 1500, max_chars: 6000,
  });
  assert.equal(conforms("session-start-request", {
    version: 1, project_id: "p".repeat(16), max_tokens: 2000, max_chars: 8000,
  }), true);
});
for (const value of [{}, { version: 2 }, { version: 1, switches: {} },
  { version: 1, project_id: "short" }, { version: 1, max_tokens: 0 },
  { version: 1, max_chars: 8001 }, { version: 1, max_tokens: 1.5 },
  { version: 1, max_chars: null }]) {
  test(`session-start rejects request ${JSON.stringify(value)}`, () => {
    assert.throws(() => parseSessionStartRequest(value), /invalid_memory_input/);
  });
}
test("session-start preserves groups and receipts, including disabled/truncated groups", () => {
  const value = sessionContext();
  assert.equal(parseSessionStartResponse(value), value);
  value.groups.commitments = group([], false);
  value.groups.background = { ...group(), complete: false,
    budget_exhausted: true, status: "budget_exhausted" };
  assert.equal(parseSessionStartResponse(value), value);
});
const sessionMutations = {
  "missing group": (v) => delete v.groups.commitments,
  "missing receipt": (v) => v.groups.procedural.items[0].receipts = [],
  "recall memory fields": (v) => v.groups.procedural.items[0].memory.scope = "personal",
  "false returned count": (v) => v.groups.background.returned = 0,
  "disabled with items": (v) => v.groups.commitments.enabled = false,
  "false complete": (v) => v.groups.nextSteps.complete = false,
  "exhaustion mismatch": (v) => v.groups.background.budget_exhausted = true,
  "switch disagreement": (v) => v.groups.background = group([], false),
  "historical memory": (v) => v.groups.background.items[0].memory.state = "historical",
  "awaiting memory": (v) => v.groups.procedural.items[0].memory.reviewState = "awaiting",
  "wrong kind": (v) => v.groups.background.items[0].memory.kind = "decision",
  "namespace mismatch": (v) => v.namespace.scope = "project",
  "extra receipt": (v) => v.groups.commitments.items[0].receipts[0].secret = "synthetic",
  "extra root": (v) => v.extra = true,
};
for (const [name, mutate] of Object.entries(sessionMutations)) {
  test(`session-start rejects ${name}`, () => {
    const value = sessionContext(); mutate(value);
    assert.throws(() => parseSessionStartResponse(value), /invalid_reply/);
  });
}
test("session-start combined budgets include metadata and receipts", () => {
  const value = sessionContext();
  assert.throws(() => parseSessionStartResponse(value, { version: 1, max_chars: 1 }), /invalid_reply/);
  assert.throws(() => parseSessionStartResponse(value, { version: 1 }, {
    countTokens: () => 2001,
  }), /invalid_reply/);
  assert.throws(() => parseSessionStartResponse(value, { version: 1 }, {
    countTokens: () => NaN,
  }), /invalid_reply/);
  assert.equal(parseSessionStartResponse(value, { version: 1 }, { countTokens: () => 100 }), value);
  assert.throws(() => parseSessionStartResponse(value, { version: 1 }, {
    ownerId: "foreign-owner",
  }), /invalid_reply/);
  value.groups.procedural.items = Array(6).fill(value.groups.procedural.items[0]);
  value.groups.procedural.returned = 6;
  value.groups.background.items = Array(6).fill(value.groups.background.items[0]);
  value.groups.background.returned = 6;
  assert.throws(() => parseSessionStartResponse(value, { version: 1, max_chars: 8000 }), /invalid_reply/);
});
test("session-start project namespace is exact; property order is immaterial", () => {
  const value = sessionContext(); const project_id = "p".repeat(16);
  value.namespace = { ownerId: "synthetic-owner", scope: "project", projectId: project_id };
  value.groups = Object.fromEntries(Object.entries(value.groups).reverse());
  assert.equal(parseSessionStartResponse(value, { version: 1, project_id }), value);
  assert.throws(() => parseSessionStartResponse(value, {
    version: 1, project_id: "q".repeat(16),
  }), /invalid_reply/);
});
for (const generation of [0, 1, 9007199254740991, -1, 0.5, 9007199254740992, "1", null]) {
  test(`pause generation ${generation}`, () => {
    const state = { paused: true, generation, enforced: true };
    if (Number.isSafeInteger(generation) && generation >= 0) {
      assert.equal(parsePauseState(state), state);
    } else assert.throws(() => parsePauseState(state), /invalid_reply/);
  });
}
test("pause state has exactly paused, generation and enforced", () => {
  for (const value of [{ paused: false, generation: 0 },
    { paused: 1, generation: 0, enforced: true },
    { paused: false, generation: 0, enforced: true, extra: false }]) {
    assert.throws(() => parsePauseState(value), /invalid_reply/);
  }
  assert.deepEqual(parsePauseState({ paused: false, generation: 0, enforced: false }), {
    paused: false, generation: 0, enforced: false,
  });
});


test("session-start rejects unknown fields at every nested object boundary", () => {
  const original = sessionContext();
  function paths(value, at = []) {
    if (Array.isArray(value)) return value.flatMap((item, index) => paths(item, [...at, index]));
    if (value && typeof value === "object") return [at,
      ...Object.entries(value).flatMap(([key, item]) => paths(item, [...at, key]))];
    return [];
  }
  for (const path of paths(original)) {
    const value = structuredClone(original);
    let target = value;
    for (const key of path) target = target[key];
    target.unknown = "synthetic";
    assert.equal(conforms("session-start-response", value), false, path.join("."));
  }
});
test("schema interpreter keyword inventory is closed", () => {
  const known = new Set(["$schema", "$id", "$defs", "$ref", "title", "description", "default",
    "type", "oneOf", "anyOf", "const", "enum", "required", "properties", "additionalProperties",
    "minItems", "maxItems", "items", "minLength", "maxLength", "pattern", "format", "minimum",
    "maximum"]);
  function inspect(value) {
    for (const [key, sub] of Object.entries(value)) {
      assert.equal(known.has(key), true, key);
      if (["properties", "$defs"].includes(key)) Object.values(sub).forEach(inspect);
      if (["oneOf", "anyOf"].includes(key)) sub.forEach(inspect);
      if (key === "items") inspect(sub);
    }
  }
  Object.values(HOSTED_SCHEMAS).forEach(inspect);
});
test("legacy recall timestamps retain RFC 3339 offset acceptance", () => {
  const source = HOSTED_SCHEMAS["recall-response"].$defs.memory.properties;
  assert.equal(source.createdAt.pattern, undefined);
});


test("session-start requires a trusted token counter before acknowledging context", () => {
  assert.throws(() => parseResponse(sessionContext()), /invalid_reply/);
});
test("session-start preserves procedural tags and rejects unbound next-step evidence", () => {
  const value = sessionContext();
  value.groups.procedural.items[0].procedural = {
    tagRevision: 1, procedural: true, origin: "explicit", anchors: [{
      receiptId: "receipt", digest: "a".repeat(64), start: 0, end: 10,
    }],
  };
  assert.equal(parseSessionStartResponse(value), value);
  value.groups.nextSteps.items[0].nextStep.anchors[0].sourceId = "missing";
  assert.throws(() => parseSessionStartResponse(value), /invalid_reply/);
});
