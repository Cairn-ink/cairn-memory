import assert from "node:assert/strict";
import test from "node:test";
import { allDigests, coreFingerprintLabels, factIncarnationBody, userFingerprintKey } from "@cairn-ink/core";
import { service } from "./migration-fixtures.mjs";
import { fixture, sha256, testAccess } from "./storage-fixtures.mjs";

const scope = { owner: "synthetic-owner", namespace: null };
const session = { client: "synthetic-client", sessionId: "synthetic-session" };
const key = { ...session, scope, eventId: "synthetic-event", payloadDigest: sha256("synthetic-event") };
const view = { owner: scope.owner, namespaces: [scope.namespace] };
const source = { kind: "mcp", client: null, sessionId: null };
const message = (id, content) => ({ id, role: "user", content, occurredAtMs: 1 });
const write = (adapter, body) => adapter.uow.run(scope.owner, { pauseLock: true }, body);
const read = (adapter, body) => adapter.uow.run(scope.owner, { readOnly: true }, body);

for (const [role, content] of [["user", ""], ["assistant", "Synthetic role conflict"]]) {
  test(`forget erases a memory with a surviving ${content ? "role-conflicting" : "empty"} Raw row`, async t => {
    const opened = await fixture();
    t.after(opened.close);
    const { adapter } = opened;
    const text = "Synthetic memory whose receipt cannot supply a span";
    const bad = { ...message("conflict", content), role };
    const good = message("valid", "Synthetic valid sibling source");
    const receipt = item => ({ ...session, messageId: item.id, role: "user", occurredAtMs: 1 });
    const memory = await write(adapter, async tx => {
      assert.deepEqual(await adapter.raw.archive(tx, key, [bad, good]), { archived: 2 });
      return adapter.memories.insert(tx, scope, {
        text, textHash: "sha256:" + sha256(text), source, origin: "explicit", embedding: null, kind: "fact", confidence: 1,
      }, [receipt(bad), receipt(good)], 1);
    });
    assert.equal(await read(adapter, async tx => (await adapter.memories.get(tx, scope, memory.id)).text), text);
    await assert.rejects(read(adapter, tx => adapter.spanLineage.resolveSpans(tx, scope, memory.id)),
      { code: "raw_lineage_unavailable" });
    await assert.rejects(write(adapter, tx => adapter.spanLineage.readSpans(tx, scope, memory.id)),
      { code: "raw_lineage_unavailable" });
    const fingerprint = await userFingerprintKey("synthetic test fingerprint seed", scope.owner, coreFingerprintLabels);
    const api = service({ ...adapter, keys: { userKey: async () => fingerprint } });
    assert.equal((await api.forget(scope, memory.id, source)).status, "forgotten");
    assert.equal(await read(adapter, tx => adapter.memories.get(tx, scope, memory.id)), null);
    assert.deepEqual(await testAccess(opened, scope, {}, db =>
      db.prepare("SELECT json_extract(body, '$.messageKey') AS message FROM cairn_suppression_facts WHERE json_extract(body, '$.kind') = 'rawSpan'")
        .all().map(row => row.message)), [good.id]);
  });
}

test("keyless purge deletes exact Raw and spans while retaining a containing message", async t => {
  const opened = await fixture();
  t.after(opened.close);
  const { adapter } = opened;
  assert.equal(await adapter.keys.userKey(scope.owner), null);
  const exact = message("exact", "Garden quartz");
  const containing = message("contains", "The garden quartz shines brightly.");
  const spanned = message("spanned", "Synthetic span evidence");
  const text = { ...scope, kind: "text", mode: "full", origin: "forget", actionId: "text-purge",
    text: { digests: await allDigests(exact.content, null), shingles: null, keyId: null } };
  const span = { ...scope, kind: "rawSpan", origin: "forget", actionId: "span-purge",
    sessionKeyHash: adapter.hashSessionKey(scope, session.client, session.sessionId), messageKey: spanned.id,
    startUtf16: 1, endUtf16: 4, contentDigest: sha256(spanned.content.slice(1, 4)) };
  await write(adapter, async tx => {
    const messages = [exact, containing, spanned];
    assert.deepEqual(await adapter.raw.archive(tx, key, messages), { archived: 3 });
    assert.deepEqual(await adapter.capture.admit(tx, key, messages), { status: "admitted" });
    const facts = [];
    for (const fact of [text, span]) {
      const incarnation = sha256(factIncarnationBody(fact));
      facts.push({ ...await adapter.suppressions.writeFact(tx, fact, incarnation), fact, incarnation });
    }
    assert.deepEqual(await adapter.raw.purgeWithheld(tx, scope, facts), { rawDeleted: 2, ledgerBlanked: 2 });
    assert.deepEqual((await adapter.capture.load(tx, key)).messages.map(item => item.content), ["", containing.content, ""]);
  });
  assert.deepEqual(await read(adapter, async tx =>
    (await adapter.raw.listRaw(tx, view, { cursor: null, limit: 10 })).items.map(item => item.content)), [containing.content]);
});
