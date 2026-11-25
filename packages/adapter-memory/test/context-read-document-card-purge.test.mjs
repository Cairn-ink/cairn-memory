import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryService } from "@cairn-ink/core/service";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { createMemoryAdapter } from "../src/index.mjs";

test("Raw erasure tombstones a Context Read card and invalidates its namespace snapshots", async () => {
  const storage = createMemoryAdapter({
    capabilities: { contextRead: true, documentCards: true, rawArchive: true, inspect: true },
  });
  const { contextRead, documentCards, raw, uow } = storage;
  const service = createMemoryService({ profile: "keyless-local", storage, clock: assemblyClock(),
    contextReadCounter: { count: fixtureCount }, contextReadFormat: formatAssembly });
  const scope = { owner: "owner", namespace: "personal\0" };
  const other = { ...scope, namespace: "project\0other" };
  const readSet = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
  const source = { client: "fixture", sessionId: "archive", messageId: "turn" };
  const body = "The cedar sample is stored in the drawer.";
  const input = { query: "cedar", types: ["card"], intent: "current" };
  const write = work => uow.run(scope.owner, { pauseLock: true }, work);
  const read = work => uow.run(scope.owner, { readOnly: true }, work);
  const generations = () => read(tx => contextRead.snapshotState(tx,
    { ...readSet, namespaces: [scope.namespace, other.namespace], accessGenerations: [1, 1] }, input.types));
  const fetch = ref => service.fetchEvidence(readSet, { refs: [ref], intent: input.intent });
  const card = (target, id, text, sentences = []) => ({
    id, scope: target, origin: "manual", title: "", body: text, date: null, contentHash: id,
    sourceMessage: null, sourceMemories: [], sentences, stale: [],
  });

  await write(async tx => {
    assert.deepEqual(await raw.archive(tx, { scope, ...source, eventId: "capture", payloadDigest: "a".repeat(64) },
      [{ id: source.messageId, role: "user", content: body, occurredAtMs: 1 }]), { archived: 1 });
    assert.equal((await documentCards.put(tx, scope,
      card(scope, "sample", body, [{ start: 0, end: body.length, source }]))).status, "inserted");
    assert.equal((await documentCards.put(tx, scope, card(scope, "control", "The checklist is on the shelf."))).status,
      "inserted");
    assert.equal((await documentCards.put(tx, other, card(other, "other", "Another checklist."))).status, "inserted");
  });

  const [found] = (await service.findCandidates(readSet, input)).items;
  assert.equal(found.ref.id, "sample");
  const fetched = await fetch(found.ref);
  assert.equal(fetched.items[0].body, body);
  const before = await service.readContext(readSet, input);
  assert.deepEqual(before.assembly.items.map(({ ref, body: text }) => [ref.id, text]), [[found.ref.id, body]]);
  const [control] = (await service.findCandidates(readSet, { ...input, query: "checklist" })).items;
  const controlEvidence = await fetch(control.ref);
  assert.deepEqual((await service.fetchEvidence(readSet, { snapshot: controlEvidence.snapshot })).items,
    controlEvidence.items);
  const [targetBefore, otherBefore] = await generations();

  assert.deepEqual(await write(tx => raw.deleteConversation(tx, scope, source)), { rawDeleted: 1 });

  assert.equal(await read(tx => documentCards.get(tx, scope, found.ref.id)), null);
  assert.deepEqual((await service.findCandidates(readSet, input)).items, []);
  await assert.rejects(() => fetch(found.ref), { code: "evidence_unavailable" });
  assert.deepEqual((await service.readContext(readSet, input)).assembly.items, []);
  assert.deepEqual(await generations(), [{ ...targetBefore, card: targetBefore.card + 1 }, otherBefore]);
  await assert.rejects(() => service.fetchEvidence(readSet, { snapshot: fetched.snapshot }), { code: "snapshot_stale" });
  await assert.rejects(() => service.fetchEvidence(readSet, { snapshot: controlEvidence.snapshot }),
    { code: "snapshot_stale" });
  assert.deepEqual((await fetch(control.ref)).items, controlEvidence.items);
});
