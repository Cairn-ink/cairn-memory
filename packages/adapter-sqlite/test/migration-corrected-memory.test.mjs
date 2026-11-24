import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { factHidesRow } from "@cairn-ink/core";
import { openMemoryCore } from "../../../core/index.mjs";
import { defaultRawOptions } from "../../../core/local-defaults.mjs";
import { rawRequest, splitRaw } from "../../../core/testing/raw-fixtures.mjs";
import { rationaleModel } from "../../../core/testing/rationale-model.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { readFacts } from "../src/suppressions.mjs";
import { editFixture, fixture, scratch } from "./legacy/fixtures.mjs";
import {
  admit, coreScope, createLegacyBackup, fileDigest, legacyVisible, migratedVisible, ok, personal, prepareInput,
} from "./migration-fixtures.mjs";
import { legacyRawVisible } from "./raw-migration-fixtures.mjs";

const scope = coreScope(personal);
const readSet = { owner: scope.owner, namespaces: [scope.namespace] };
const retired = [
  "Silverturnip predecessor body",
  "Bronzeturnip predecessor body",
  "Coppertarragon forgotten correction",
];
const selection = { types: ["memory"], intent: "current" };
const liveText = "Ivorytarragon live correction";
const from = (eventId, excerpt) => ({ client: "manual", sessionId: eventId, eventId, role: "user", excerpt });

async function openManagedLegacy(path) {
  const client = "claude-code";
  const options = { path, rawSearch: false, model: {
    ...rationaleModel(),
    extract: () => ({ items: [{ content: retired[0], kind: "fact", confidence: 0.9, sourceIndices: [0] }] }),
  } };
  const control = openMemoryCore({ ...options, rawConversations: defaultRawOptions() });
  let localAuthority;
  try {
    const current = ok(control.getLocalCaptureControl({ namespace: personal, client }));
    const granted = ok(control.setLocalCaptureControl({ namespace: personal, client,
      expectedStoreId: current.storeId, expectedRevision: current.revision, targetId: "test-target",
      automaticCaptureEnabled: true, rawNoticeVersion: "local-plain-v1" }));
    localAuthority = { version: "local-capture-authority-v1", targetId: granted.targetId, storeId: granted.storeId,
      namespace: personal, client, expectedControlRevision: granted.revision,
      expectedConsentGeneration: granted.consentGeneration,
      expectedNamespaceGeneration: ok(control.getCaptureControl({ namespace: personal })).generation,
      expectedRawRevision: ok(control.getRawCaptureControl({ ownerId: personal.ownerId, client })).revision };
  } finally {
    await control.close();
  }
  return openMemoryCore({ ...options, rawConversations: { ...defaultRawOptions(), localAuthority } });
}

for (const layout of [48, 53]) {
  test(`layout ${layout} migrates writer-origin correction facts and keeps forgotten revisions out of reads`, async t => {
    const directory = scratch(t);
    const legacy = await fixture(directory, layout, { localPrivacy: true });
    const engine = await openManagedLegacy(legacy.path);
    let forgotten, live, predecessor;
    try {
      const request = rawRequest(splitRaw(retired[0], { id: "original-turn", occurredAt: new Date().toISOString() })[0],
        { namespace: personal, sessionId: "original-session", eventId: "original-event" });
      const arrival = ok(await engine.captureRaw(request));
      const [original] = ok(arrival.interpretation).admission.memories;
      assert.equal(ok(engine.get({ namespace: personal, memoryId: original.id })).memory.content, retired[0]);
      assert.deepEqual((await legacyRawVisible(legacy.path, [personal])).map(row => row.content), [retired[0]]);
      const other = admit(engine, retired[1], personal, [from("second-original", retired[1])]);
      predecessor = other;
      const correct = (memory, content, id) => ok(engine.correct({
        namespace: personal, memoryId: memory.id, expectedRevision: memory.revision, kind: "fact",
        content, receipt: from(id, content),
      })).memory;
      forgotten = correct(original, retired[2], "first-correction");
      live = correct(other, liveText, "second-correction");
      assert.equal(ok(engine.get({ namespace: personal, memoryId: forgotten.id })).memory.content, retired[2]);
      assert.equal(ok(engine.forget({ namespace: personal, memoryId: forgotten.id, expectedRevision: forgotten.revision })).forgotten, true);
      assert.equal(engine.get({ namespace: personal, memoryId: forgotten.id }).error?.code, "memory_not_found");
      assert.equal(ok(engine.get({ namespace: personal, memoryId: live.id })).memory.content, liveText);
    } finally {
      await engine.close();
    }

    assert.deepEqual(await legacyRawVisible(legacy.path, [personal]), []);
    const expected = await legacyVisible(legacy.path, [personal]);
    assert.deepEqual(expected.map(row => [row.id, row.text]), [[live.id, liveText]]);
    const selector = editFixture(legacy.path, db => db.prepare(`SELECT source_version FROM content_suppressions
      WHERE stable_key = ? AND kind = 'memory' AND reason = 'correction_supersession'`).get(live.id));
    assert.deepEqual(JSON.parse(selector.source_version), ["memory-revision-through-v1", predecessor.revision]);
    const input = prepareInput(directory, legacy);
    await createLegacyBackup(input);
    const digest = fileDigest(input.path);
    assert.equal((await migrateLegacyStore(input)).sourceLayout, layout);
    assert.equal(fileDigest(input.path), digest);

    const adapter = await openSqliteAdapter(input.destination, { capabilities: { contextRead: true, contextRawRead: true } });
    try {
      assert.deepEqual(await migratedVisible(adapter, [personal]), expected);
      await adapter.contextRead.prepareLexical(readSet, selection, {});
      await adapter.uow.run(scope.owner, { readOnly: true }, async tx => {
        const oldRef = { type: "memory", namespace: scope.namespace, id: forgotten.id };
        const currentRef = { ...oldRef, id: live.id };
        assert.equal(await adapter.memories.get(tx, scope, forgotten.id), null);
        assert.equal(await adapter.memories.readRevision(tx, scope, forgotten.id), null);
        assert.equal((await adapter.memories.get(tx, scope, live.id)).text, liveText);
        assert.deepEqual((await adapter.recent.recent(tx, readSet, { cursor: null, limit: 10 })).items.map(row => row.id), [live.id]);
        for (const intent of ["read", "recall", "export"]) {
          assert.deepEqual(await adapter.hydrate.hydrate(tx, readSet, [oldRef], intent), []);
          assert.equal((await adapter.hydrate.hydrate(tx, readSet, [currentRef], intent))[0].memory.text, liveText);
        }
        assert.deepEqual((await adapter.fence.assertVisible(tx, readSet, [oldRef, currentRef], "read")).map(ref => ref.id), [live.id]);
        await assert.rejects(adapter.spanLineage.resolveSpans(tx, scope, forgotten.id), { code: "raw_lineage_unavailable" });
        assert.deepEqual(await adapter.spanLineage.resolveSpans(tx, scope, live.id), []);
        const inspectOptions = { limit: 10, includeQualification: true };
        assert.equal((await adapter.inspect.item(tx, scope, forgotten.id, inspectOptions)).item, null);
        const { item: inspected } = await adapter.inspect.item(tx, scope, live.id, inspectOptions);
        assert.equal(inspected.memory.text, liveText);
        for (const text of retired) assert.equal(JSON.stringify(inspected).includes(text), false);
        const listed = await adapter.inspect.list(tx, scope, { states: ["active", "historical"], limit: 10 });
        assert.deepEqual(listed.rows.map(row => row.id), [live.id]);

        const evidence = await adapter.contextRead.evidence(tx, readSet, [
          { type: "memory", scope, id: forgotten.id, revision: forgotten.revision },
          { type: "memory", scope, id: live.id, revision: live.revision },
        ], "current");
        assert.deepEqual(evidence.map(row => row?.text ?? null), [null, liveText]);

        for (const text of retired) {
          const query = text.split(" ")[0];
          assert.deepEqual((await adapter.lexical.lexical(tx, readSet, query, 10)).rows, []);
          assert.deepEqual((await adapter.contextRead.lexical(tx, readSet, selection, query, 10, {})).rows, []);
          assert.deepEqual((await adapter.raw.raw(tx, readSet, query, "search", { limit: 10 })).segments, []);
          assert.deepEqual((await adapter.contextRead.raw.search(tx, readSet, query, { limit: 10 })).turns, []);
        }
        assert.deepEqual((await adapter.raw.listRaw(tx, readSet, { limit: 10, cursor: null })).items, []);

        const query = liveText.split(" ")[0];
        const { rows } = await adapter.contextRead.lexical(tx, readSet, selection, query, 10, {});
        assert.deepEqual(rows.map(row => [row.ref.id, row.ref.revision]), [[live.id, live.revision]]);
        assert.deepEqual(await adapter.suppressions.factsFor(tx, scope, { memoryId: live.id }), []);
      });
    } finally {
      await adapter.close();
    }

    const correction = editFixture(input.destination, db => readFacts(db, scope))
      .find(({ fact }) => fact.kind === "identity" && fact.memoryId === live.id);
    assert.equal(correction.fact.throughRevision, predecessor.revision);
    const candidate = { type: "memory", scope, memoryId: live.id, digests: [] };
    assert.equal(factHidesRow(correction, { ...candidate, revision: predecessor.revision }), true);
    assert.equal(factHidesRow(correction, { ...candidate, revision: live.revision }), false);
    const contents = readFileSync(input.destination);
    for (const text of retired) assert.equal(contents.includes(text), false, text);
    assert.equal(contents.includes(liveText), true);
  });
}
