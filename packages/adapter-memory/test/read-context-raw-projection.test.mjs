import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryService } from "@cairn-ink/core/service";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { contextReadTestService } from "@cairn-ink/conformance/context-read";
import { createMemoryAdapter } from "../src/index.mjs";

const scope = { owner: "owner", namespace: "project\0raw-projection" };
const readSet = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
const query = { query: "albatross", types: ["memory"], intent: "current", semantic: false };
const at = Date.UTC(2025, 0, 2, 3, 4);
const client = "writer";
const body = "albatross albatross";

function fixture() {
  const storage = createMemoryAdapter({ capabilities: {
    contextRead: true, contextRawRead: true, rawArchive: true, inspect: true, fingerprintKey: true,
  } });
  const service = createMemoryService({ profile: "keyless-local", storage, clock: assemblyClock(),
    contextReadCounter: { count: fixtureCount }, contextReadFormat: formatAssembly });
  const write = action => storage.uow.run(scope.owner, { pauseLock: true }, action);
  const archive = (sessionId, messages) => write(tx => storage.raw.importArchive(tx, scope, { client, sessionId }, messages));
  return { storage, write, archive, read: options => service.readContext(readSet, { ...query, ...options }) };
}

const turn = (id, content, occurredAtMs) => ({ id, content, occurredAtMs, role: "user" });
const rawRef = (sessionId, messageId) => ({ ns: 0, type: "raw", conversationId: JSON.stringify([client, sessionId]), messageId });
const minute = ms => new Date(ms).toISOString().slice(0, 16) + "Z";

async function linkedMemory({ storage, write, archive }, messages) {
  const sessionId = "linked";
  const key = { scope, client, sessionId, eventId: "batch", payloadDigest: "a".repeat(64) };
  assert.equal((await archive(sessionId, messages)).archived, messages.length);
  const admitted = messages.map(message => ({ ...message, occurredAtMs: at + 86_400_000 }));
  assert.equal((await write(tx => storage.capture.admit(tx, key, admitted))).status, "admitted");
  const claim = await write(tx => storage.capture.claim(tx, key, admitted, { leaseMs: 10_000 }));
  assert.equal(claim.status, "claimed");
  await write(tx => storage.capture.beginDispatch(tx, claim.token));
  const { memories } = await write(async tx => {
    await storage.capture.assertEligible(tx, key, admitted.map((_, index) => index));
    return storage.capture.finish(tx, claim.token, [{
      content: body, kind: "fact", confidence: 1, embedding: null,
      textHash: "sha256:" + createHash("sha256").update(body).digest("hex"),
      receipts: admitted.map(({ id, role, occurredAtMs }) => ({ client, sessionId, messageId: id, role, occurredAtMs })),
    }]);
  });
  assert.equal(memories.length, 1);
  return memories[0];
}

test("seven dated evidence rows keep minute order, item date and body dedup while using fewer tokens", async t => {
  const f = fixture();
  const messages = [
    turn("late-second", body, at + 59_000),
    turn("early-second", "albatross sky", at + 2_000),
    ...Array.from({ length: 5 }, (_, i) => turn("later-" + i, "an albatross crosses the bay", at + (60 + i) * 1000)),
  ];
  const memory = await linkedMemory(f, messages);
  const dated = await f.read();
  const v2 = await f.read({ representation: "representation-v2" });
  const [item] = dated.assembly.items;
  const [v2Item] = v2.assembly.items;
  assert.equal(dated.assembly.items.length, 1);
  assert.equal(v2.assembly.items.length, 1);

  // Rebuild the base dated rows from the delivered v2 rows, which still carry
  // the original timestamp and offsets. Keep the original JSON property order.
  const baseEvidence = v2Item.evidence.map(({ ref, role, occurredAt, start, end, ...payload }) => ({
    ref, role, occurredAt, date: minute(Date.parse(occurredAt)), start, end, ...payload,
  }));
  const before = fixtureCount(formatAssembly({ ...dated.assembly, items: [{ ...item, evidence: baseEvidence }] }));
  const after = fixtureCount(formatAssembly(dated.assembly));
  t.diagnostic(`7 evidence rows, delivered pack tokens ${before} -> ${after}`);
  assert.equal(after, dated.diagnostics.budget.used);
  assert.ok(after < before);

  assert.equal(item.ref.id, memory.id);
  assert.equal(item.date, minute(at));
  assert.equal(Object.hasOwn(v2Item, "date"), false);
  const expected = messages.map(({ id, content, occurredAtMs, role }) => ({
    ref: rawRef("linked", id), role, occurredAt: new Date(occurredAtMs).toISOString(),
    start: 0, end: content.length, ...(content === body ? { sameAsBody: true } : { body: content }),
  }));
  assert.equal(JSON.stringify(v2Item.evidence), JSON.stringify(expected));
  const lean = expected.map(({ ref, role, occurredAt, start, end, ...payload }) => ({
    ref, role, date: minute(Date.parse(occurredAt)), ...payload,
  }));
  assert.equal(JSON.stringify(item.evidence), JSON.stringify(lean));
});

test("standalone Raw items project dated and undated rows with the expected wire keys", async () => {
  const f = fixture();
  const content = "An albatross circles.";
  const known = turn("known", content, at + 23_000);
  const unknown = turn("unknown", content, null);
  assert.equal((await f.archive("observations", [known, unknown])).archived, 2);
  const dated = await f.read({ representation: "representation-v2-dated" });
  const v2 = await f.read({ representation: "representation-v2" });
  assert.equal(dated.assembly.items.length, 2);
  assert.equal(v2.assembly.items.length, 2);
  assert.equal(JSON.stringify(dated.assembly.items), JSON.stringify([
    { layer: "Raw", ref: rawRef("observations", known.id), role: "user", date: minute(at), body: content },
    { layer: "Raw", ref: rawRef("observations", unknown.id), role: "user", body: content },
  ]));
  for (const message of [known, unknown]) {
    const item = v2.assembly.items.find(item => item.ref.messageId === message.id);
    assert.equal(JSON.stringify(item), JSON.stringify({
      layer: "Raw", ref: rawRef("observations", message.id), role: "user",
      ...(message.occurredAtMs !== null && { occurredAt: new Date(message.occurredAtMs).toISOString() }),
      start: 0, end: content.length, body: content,
    }));
  }
});

test("forget withdraws linked Raw evidence from both representations", async () => {
  const f = fixture();
  const hidden = turn("withdrawn", "albatross hidden inlet", at);
  const visible = turn("visible", "albatross open ocean", at);
  const memory = await linkedMemory(f, [hidden]);
  assert.equal((await f.archive("unlinked", [visible])).archived, 1);
  const before = await f.read();
  assert.equal(before.assembly.items.find(item => item.ref.id === memory.id).evidence[0].body, hidden.content);

  const forgotten = await contextReadTestService(f.storage).forget(scope, memory.id, { kind: "mcp", client: null, sessionId: null });
  assert.equal(forgotten.status, "forgotten");
  for (const representation of ["representation-v2-dated", "representation-v2"]) {
    const result = await f.read({ representation });
    assert.deepEqual(result.assembly.items.map(item => item.ref.messageId), [visible.id]);
    assert.equal(JSON.stringify(result).includes(hidden.content), false);
    assert.equal(JSON.stringify(result).includes(hidden.id), false);
  }
});

test("Raw selection prices the delivered projection", async () => {
  const f = fixture();
  // Both bodies have the same lexical score. The length difference exceeds the
  // minute date cost but is smaller than the date plus full timestamp cost.
  const short = turn("short", "albatross sky", at);
  const long = turn("longer", "albatross " + "x".repeat(42), null);
  assert.equal((await f.archive("observations", [short, long])).archived, 2);
  const result = await f.read({ budget: { maxItems: 1 } });
  assert.deepEqual(result.assembly.items.map(item => item.ref.messageId), [short.id]);
});
