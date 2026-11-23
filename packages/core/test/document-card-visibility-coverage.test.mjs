import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDocumentCard, documentCardSourceWithheld, documentCardStaleness, documentCardVisible,
} from "@cairn-ink/core/routing";

const scope = { owner: "owner", namespace: null };
const sourceMessage = { client: "client", sessionId: "source", messageId: "message" };
const canonicalSessionKey = "canonical";
const content = "0123😀6789";
const row = {
  type: "raw", scope, sessionKeyHash: "a".repeat(64), messageKey: "message",
  startUtf16: 0, endUtf16: content.length,
};
const input = { sourceLengthUtf16: content.length, sourceExcluded: false, facts: [] };
const gapped = [{ ...row, endUtf16: 4 }, { ...row, startUtf16: 6 }];
const complete = [{ ...row, endUtf16: 4 }, { ...row, startUtf16: 4 }];
const gapFact = {
  fact: {
    ...scope, kind: "rawSpan", origin: "forget", actionId: "action",
    sessionKeyHash: row.sessionKeyHash, messageKey: row.messageKey,
    startUtf16: 4, endUtf16: 6, contentDigest: "b".repeat(64),
  },
};
const { card: built } = await buildDocumentCard(
  { id: sourceMessage.messageId, role: "user", content },
  { scope, client: sourceMessage.client, canonicalSessionKey },
);
assert.ok(built);
const card = { ...built, scope, sourceMessage, canonicalSessionKey, sourceMemories: [] };
const read = { card, requestedScope: scope, memoryStates: new Map() };

test("a forgotten span in a projection gap blocks delivery of the entire card", async () => {
  const sourceWithheld = documentCardSourceWithheld({ ...input, rawRows: gapped, facts: [gapFact] });
  const verdict = await documentCardVisible({ ...read, sourceWithheld });
  assert.deepEqual({ sourceWithheld, delivered: verdict.visible }, { sourceWithheld: true, delivered: false });
  assert.equal(verdict.reason, "source_withheld");
});

for (const [name, rawRows] of [
  ["an interior gap", gapped],
  ["a leading gap", [{ ...row, startUtf16: 1 }]],
  ["a trailing gap", [{ ...row, endUtf16: content.length - 1 }]],
  ["an overlong projection", [{ ...row, endUtf16: content.length + 1 }]],
  ["overlapping projections", [{ ...row, endUtf16: 6 }, { ...row, startUtf16: 4 }]],
  ["out-of-order projections", [...complete].reverse()],
  ["an empty projection list", []],
]) {
  test(`${name} withholds the source`, () => {
    assert.equal(documentCardSourceWithheld({ ...input, rawRows }), true);
  });
}

test("a missing source extent withholds the source even with a full-looking projection", () => {
  assert.equal(documentCardSourceWithheld({ rawRows: [row], facts: [], sourceExcluded: false }), true);
});

test("an invalid source extent withholds the source", () => {
  for (const sourceLengthUtf16 of [null, 0, -1, 10.5, "10", Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(documentCardSourceWithheld({ ...input, rawRows: [row], sourceLengthUtf16 }), true);
  }
});

for (const [name, fields] of [
  ["owner", { scope: { ...scope, owner: "other" } }],
  ["namespace", { scope: { ...scope, namespace: "other" } }],
  ["session hash", { sessionKeyHash: "c".repeat(64) }],
  ["message key", { messageKey: "other" }],
]) {
  test(`a different ${name} cannot complete coverage of the source`, () => {
    const rawRows = [complete[0], { ...complete[1], ...fields }];
    assert.equal(documentCardSourceWithheld({ ...input, rawRows }), true);
  });
}

test("complete coverage clears the source unless a Raw fact matches", async () => {
  const sourceWithheld = documentCardSourceWithheld({ ...input, rawRows: complete });
  const verdict = await documentCardVisible({ ...read, sourceWithheld });
  assert.deepEqual({ sourceWithheld, delivered: verdict.visible }, { sourceWithheld: false, delivered: true });
  assert.equal(documentCardSourceWithheld({ ...input, rawRows: [row] }), false);
  const unrelatedFact = { fact: { ...gapFact.fact, messageKey: "other" } };
  assert.equal(documentCardSourceWithheld({ ...input, rawRows: complete, facts: [unrelatedFact] }), false);
  assert.equal(documentCardSourceWithheld({ ...input, rawRows: complete, facts: [gapFact] }), true);
});

for (const status of ["historical", "superseded", "unknown", "visible"]) {
  test(`a ${status} source at the recorded revision ${status === "visible" ? "is fresh" : "is stale"}`, () => {
    const card = { sourceMemories: [{ id: "memory", revision: 2 }], stale: [] };
    const memoryStates = new Map([["memory", { status, revision: 2 }]]);
    assert.equal(documentCardStaleness({ card, memoryStates }), status !== "visible");
  });
}
