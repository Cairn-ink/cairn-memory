import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryService } from "@cairn-ink/core/service";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { contextReadTestService } from "@cairn-ink/conformance/context-read";
import { openMemoryCore } from "../../../core/index.mjs";
import { rationaleModel } from "../../../core/testing/rationale-model.mjs";
import { rawRequest, splitRaw } from "../../../core/testing/raw-fixtures.mjs";
import { createSqliteAdapter } from "../src/adapter.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { createMigratedRawPolicy } from "../src/migrate/raw-privacy.mjs";
import { rawFactPolicy } from "../src/raw-facts.mjs";
import { allowsRawSession } from "../src/raw-lineage.mjs";
import { readRawRow } from "../src/raw-rows.mjs";
import { receiptIdentityKey } from "../src/receipt-identity.mjs";
import { openStorage } from "../src/schema/open.mjs";
import { copyReceipts, invalidInput } from "../src/storage-values.mjs";
import { scopedSuppression } from "../src/suppressions.mjs";
import { editFixture, fixture as legacyFixture, scratch as legacyScratch } from "./legacy/fixtures.mjs";
import { coreScope, createLegacyBackup, ok, personal, prepareInput, project, service } from "./migration-fixtures.mjs";
import { scratch, seedFact, sha256 } from "./storage-fixtures.mjs";

const scope = { owner: "fixture-owner", namespace: "project\0notes" };
const rootScope = { ...scope, namespace: "project\0root" };
const selection = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
const source = { kind: "mcp", client: null, sessionId: null };
const text = "Synthetic receipt evidence";
const capturedBody = "The receipt documents a capture";
const search = { query: "receipt", types: ["memory"], intent: "current", semantic: false };
const placeholder = {
  client: "codex", sessionId: "explicit-tool", messageId: "fixture-message",
  role: "user", occurredAtMs: null,
};

async function fixture(t, { legacyRawHashing = false, documentCards = false } = {}) {
  const { path, remove } = scratch();
  let storage;
  t.after(async () => {
    try { await storage?.close(); }
    finally { remove(); }
  });
  storage = await openStorage(path);
  const options = { capabilities: { contextRead: true, contextRawRead: true, documentCards } };
  const adapter = createSqliteAdapter({ ...storage, legacyRawHashing }, options);
  const baseReceiptWithheld = baseAdmission(storage, adapter.hashSessionKey, legacyRawHashing);
  return { adapter, api: contextReadTestService(adapter), baseReceiptWithheld };
}

// The merge base's receipt admission port, with the full Raw window policy.
function baseAdmission({ port, sessionHashKey }, hashSession, legacyRawHashing) {
  const migratedRaw = legacyRawHashing ? createMigratedRawPolicy(sessionHashKey, hashSession, false) : undefined;
  return (tx, scope, input) => port(tx, scope?.owner, {}, db => {
    const [receipt] = copyReceipts([input]);
    const { client, messageId, occurredAtMs, excerpt } = receipt;
    if (excerpt === undefined) invalidInput();
    const policy = scopedSuppression(db, scope, hashSession);
    if (policy.hasReceiptDenial(receipt, receiptIdentityKey(receipt))) return true;
    const raw = rawFactPolicy(scope, receipt, policy.facts, hashSession);
    const position = { id: messageId, occurredAtMs };
    if (!allowsRawSession(db, scope, client, raw.sessionKeyHash, policy.facts) || raw.refusesSource(position, true) ||
        migratedRaw?.blocksEvent(db, { scope, client, eventId: messageId }) ||
        migratedRaw?.blocks(db, scope, receipt, [position]) ||
        migratedRaw?.blocksSpan(db, scope, receipt, messageId)) return true;
    const session = migratedRaw?.storageSession(db, scope, receipt) ?? receipt;
    const archived = readRawRow(db, scope, session, messageId);
    return archived ? raw.refusesSource(archived.message, true) : false;
  });
}

function seedWindow(adapter, options = {}) {
  return seedFact(adapter, {
    ...scope, kind: "window", actionId: "fixture-window", origin: "forget", client: placeholder.client,
    window: { startMs: 10, endMs: 20 }, unknownTime: true, ...options,
  });
}

async function archive(adapter, receipt, {
  target = scope, occurredAtMs = receipt.occurredAtMs, content = text, recordRoot = true, storeTurn = true,
} = {}) {
  const { client, sessionId, messageId: id, role } = receipt;
  const key = { scope: target, client, sessionId, eventId: "fixture-event", payloadDigest: sha256(content) };
  const messages = [{ id, role, occurredAtMs, content }];
  await adapter.uow.run(target.owner, { pauseLock: true }, async tx => {
    if (recordRoot) await adapter.raw.recordLineage(tx, key, messages);
    if (storeTurn) assert.equal((await adapter.raw.archive(tx, key, messages)).archived, 1);
  });
}

async function retain(adapter, receipt) {
  const body = "Synthetic memory with a retained receipt";
  const { id, revision } = await adapter.uow.run(scope.owner, {}, tx =>
    adapter.memories.insert(tx, scope, {
      kind: "fact", text: body, textHash: "sha256:" + sha256(body.toLowerCase()),
      source, origin: "explicit", confidence: 1, embedding: null,
    }, [{ ...receipt, excerpt: text }], 1));
  return { scope, type: "memory", id, revision };
}

function assemblyService(storage) {
  return createMemoryService({
    storage, clock: assemblyClock(), config: {},
    model: { model: "fixture", contextWindow: 16_384, countTokens: () => 1,
      async call(stage) {
        assert.equal(stage, "extract");
        return { items: [{ content: capturedBody, kind: "fact", confidence: 0.9, sourceIndices: [0] }] };
      } },
    gate: { async assertOpen() {} }, tokens: { countTokens: () => 1 },
    embedder: { model: "fixture", dimensions: 1, async embed(inputs) { return inputs.map(() => Float32Array.of(1)); } },
    contextReadCounter: { count: fixtureCount }, contextReadFormat: formatAssembly,
  });
}

async function captureAddress(api, { client, sessionId, messageId, role }) {
  const event = { client, sessionId, eventId: "fixture-capture" };
  const messages = [{ id: messageId, role, occurredAtMs: 25, content: text }];
  assert.deepEqual(await api.enqueueCapture(scope, { ...event, messages }), { status: "accepted" });
  const finished = await api.runCapture(scope, event);
  assert.equal(finished.status, "done", JSON.stringify(finished));
  assert.equal(finished.result.memories.length, 1);
  const [{ id, revision }] = finished.result.memories;
  assert.deepEqual((await api.inspect(scope, { memoryId: id })).receipts, []);
  return { scope, type: "memory", id, revision };
}

function withholds(adapter, receipt, excerpt = text) {
  return adapter.uow.run(scope.owner, { readOnly: true }, tx =>
    adapter.suppressions.receiptWithheld(tx, scope, { ...receipt, excerpt }));
}

async function delivery(api, ref) {
  const inspected = await api.inspect(scope, { memoryId: ref.id });
  const { items: [{ provenance }] } = await api.fetchEvidence(selection, { refs: [ref], intent: "current" });
  return {
    inspectCount: inspected.memory.receiptCount,
    inspectExcerpts: inspected.receipts.map(receipt => receipt.excerpt),
    contextSources: provenance.sources.length,
    contextReceipts: provenance.receiptMetadata.length,
  };
}

const visible = { inspectCount: 1, inspectExcerpts: [text], contextSources: 1, contextReceipts: 1 };
const hidden = { inspectCount: 0, inspectExcerpts: [], contextSources: 0, contextReceipts: 0 };

async function paths({ adapter, api }, receipt, ref) {
  return {
    receiptWithheld: await withholds(adapter, receipt),
    ...await delivery(api, ref),
    save: (await api.save(scope, text, source, "fact", { receipt })).status,
    correct: (await api.correct(scope, ref.id, ref.revision, text, source, { receipt })).status,
  };
}

test("an unarchived placeholder remains visible under an unknown-time window", async t => {
  const opened = await fixture(t);
  const ref = await retain(opened.adapter, { ...placeholder, messageId: "fixture-read-message" });
  await seedWindow(opened.adapter);
  assert.deepEqual(await delivery(opened.api, ref), visible);
  assert.equal(await withholds(opened.adapter, placeholder), false);
  assert.equal((await opened.api.save(scope, text, source, "fact", { receipt: placeholder })).status, "saved");

  const replacement = "Revised synthetic receipt evidence";
  const receipt = { ...placeholder, messageId: "fixture-correction-message" };
  assert.equal((await opened.api.correct(scope, ref.id, ref.revision, replacement, source, { receipt })).status, "saved");
});

test("an unrelated archived turn in the placeholder session does not block explicit writes", async t => {
  const { adapter, api } = await fixture(t);
  await archive(adapter, { ...placeholder, messageId: "other-message", occurredAtMs: 25 },
    { content: "An unrelated archived turn" });
  const ref = await retain(adapter, placeholder);
  const result = {
    ...await delivery(api, ref),
    receiptWithheld: await withholds(adapter, placeholder),
    save: (await api.save(scope, text, source, "fact", { receipt: placeholder })).status,
    correct: (await api.correct(scope, ref.id, ref.revision, "An independent correction", source,
      { receipt: placeholder })).status,
  };
  assert.deepEqual(result, { receiptWithheld: false, save: "saved", correct: "saved", ...hidden });
});

test("a visible cited turn under a migrated Raw alias does not block explicit writes", async t => {
  const { adapter, api } = await fixture(t, { legacyRawHashing: true });
  const sessionId = "legacy-raw:" + adapter.hashSessionKey(scope, placeholder.client, placeholder.sessionId);
  await archive(adapter, { ...placeholder, sessionId, occurredAtMs: 25 });
  const ref = await retain(adapter, placeholder);
  const result = {
    ...await delivery(api, ref),
    receiptWithheld: await withholds(adapter, placeholder),
    save: (await api.save(scope, text, source, "fact", { receipt: placeholder })).status,
    correct: (await api.correct(scope, ref.id, ref.revision, "An independent correction", source,
      { receipt: placeholder })).status,
  };
  assert.deepEqual(result, { receiptWithheld: false, save: "saved", correct: "saved", ...hidden });
});

test("an archived timeless turn cited by a placeholder stays withheld", async t => {
  const opened = await fixture(t);
  const { adapter, api } = opened;
  await archive(adapter, placeholder);
  const ref = await retain(adapter, placeholder);
  assert.deepEqual(await delivery(api, ref), visible);
  await seedWindow(adapter);
  assert.deepEqual(await paths(opened, placeholder, ref), {
    receiptWithheld: true, ...hidden, save: "suppressed", correct: "suppressed",
  });
});

const lineageCases = [
  ["a timeless root in another session", scope, true],
  ["a timeless root in another namespace", rootScope, true],
  ["a timeless root without a direct archive row", scope, false],
];

for (const [name, target, direct] of lineageCases) {
  test(`placeholder admission with ${name}`, async t => {
    for (const operation of ["save", "correct"]) {
      await t.test(operation, async t => {
        const { adapter, api, baseReceiptWithheld } = await fixture(t);
        const context = assemblyService(adapter);
        if (direct) await archive(adapter, placeholder, { occurredAtMs: 25 });
        await archive(adapter, { ...placeholder, sessionId: "fixture-root" }, { target });
        const ref = await retain(adapter, placeholder);
        if (direct) assert.deepEqual(await delivery(api, ref), visible);

        await seedWindow(adapter, target);
        assert.deepEqual(await delivery(api, ref), hidden);
        // A window in the root namespace withholds projection. Admission also
        // needs an applicable window in the receipt's namespace, as on the base.
        if (target !== scope) {
          const receipt = { ...placeholder, excerpt: text };
          const base = await adapter.uow.run(scope.owner, { readOnly: true },
            tx => baseReceiptWithheld(tx, scope, receipt));
          assert.equal(base, false);
          await seedWindow(adapter);
        }

        const result = operation === "save"
          ? await api.save(scope, text, source, "fact", { receipt: placeholder })
          : await api.correct(scope, ref.id, ref.revision, text, source, { receipt: placeholder });
        const inspected = await api.inspect(scope, { memoryId: result.item?.id ?? ref.id });
        const read = await context.readContext(selection, { ...search, raw: target !== scope });
        assert.deepEqual({
          receiptWithheld: await withholds(adapter, placeholder),
          status: result.status,
          inspectReturnedText: JSON.stringify(inspected).includes(text),
          contextReturnedText: JSON.stringify(read).includes(text),
        }, { receiptWithheld: true, status: "suppressed", inspectReturnedText: false, contextReturnedText: false });
      });
    }
  });
}

const changedText = "Revised synthetic receipt evidence";

for (const [location, target] of [["another session", scope], ["another namespace", rootScope]]) {
  for (const [variant, archivedText, saveText, correctText] of [
    ["exact save and changed correction", text, text, changedText],
    ["spacing variants", "Synthetic   receipt evidence", "Synthetic receipt  evidence", text],
    ["case variants", text, "synthetic receipt evidence", "Synthetic Receipt Evidence"],
    ["verbatim with collapsible spaces", "Synthetic  receipt evidence", "Synthetic  receipt evidence", "Synthetic  receipt evidence"],
  ]) {
    test(`id-only admission for ${variant} in ${location}`, async t => {
      async function setup() {
        const { adapter, api } = await fixture(t);
        await archive(adapter, { ...placeholder, sessionId: "fixture-root" }, { target, content: archivedText });
        const ref = await retain(adapter, placeholder);
        await seedWindow(adapter);
        if (target !== scope) await seedWindow(adapter, target);
        return { api, ref };
      }

      const saveCase = await setup();
      const saved = await saveCase.api.save(scope, saveText, source, "fact", { receipt: placeholder });
      const { api, ref } = await setup();
      const corrected = await api.correct(scope, ref.id, ref.revision, correctText, source, { receipt: placeholder });
      assert.deepEqual({ save: saved.status, correct: corrected.status }, { save: "suppressed", correct: "suppressed" });
    });
  }
}

test("every cited candidate uses the merge-base admission policy", async t => {
  for (const [name, candidate, options, citedAddress] of [
    ["direct archive", {}, { recordRoot: false }, true],
    ["same-id archive in another session", { sessionId: "fixture-other" }, { recordRoot: false }, false],
    ["same-id archive in another namespace", {}, { target: rootScope, recordRoot: false }, false],
    ["same-id archive from another client", { client: "fixture-client" }, { recordRoot: false }, false],
    ["migrated archive alias", {}, { legacyRawHashing: true, recordRoot: false }, true],
    ["root only in another session", { sessionId: "fixture-root" }, { storeTurn: false }, false],
    ["root only in another namespace", { sessionId: "fixture-root" }, { target: rootScope, storeTurn: false }, false],
    ["root only from another client", { client: "fixture-client" }, { storeTurn: false }, false],
    ["retained receipt without Raw", {}, { receiptOnly: true }, false],
  ]) {
    await t.test(name, async t => {
      const { legacyRawHashing = false, receiptOnly = false, ...archiveOptions } = options;
      const { adapter, baseReceiptWithheld } = await fixture(t, { legacyRawHashing });
      const sessionId = legacyRawHashing
        ? "legacy-raw:" + adapter.hashSessionKey(scope, placeholder.client, placeholder.sessionId)
        : candidate.sessionId ?? placeholder.sessionId;
      if (receiptOnly) await retain(adapter, placeholder);
      else await archive(adapter, { ...placeholder, ...candidate, sessionId }, { ...archiveOptions, occurredAtMs: 15 });

      async function check(expected) {
        const receipt = { ...placeholder, excerpt: changedText };
        const base = await adapter.uow.run(scope.owner, { readOnly: true }, tx => baseReceiptWithheld(tx, scope, receipt));
        assert.equal(base, expected, "merge-base outcome");
        assert.equal(await withholds(adapter, placeholder, changedText), base, "candidate admission must equal the merge base");
      }

      await check(false);
      await seedWindow(adapter, rootScope);
      await check(false);
      await seedWindow(adapter, { actionId: "fixture-finite-window", unknownTime: undefined });
      await check(citedAddress);
      await seedWindow(adapter);
      await check(true);
    });
  }
});

for (const binding of ["primary source", "sentence source", "amendment", "purged amendment"]) {
  test(`a card ${binding} disables the placeholder exemption`, async t => {
    for (const operation of ["save", "correct"]) {
      await t.test(operation, async t => {
        const { adapter, api, baseReceiptWithheld } = await fixture(t, { documentCards: true });
        const receipt = { ...placeholder, messageId: 'card "message"' };
        const address = { client: "card-client", sessionId: "card-session", messageId: receipt.messageId };
        const cardText = "A synthetic card with independent text";
        const id = "fixture-card";
        await adapter.uow.run(scope.owner, { pauseLock: true }, async tx => {
          const primary = binding === "primary source";
          assert.equal((await adapter.documentCards.put(tx, rootScope, {
            id, scope: rootScope, origin: primary ? "router" : "manual", title: "Card label", body: cardText,
            contentHash: sha256(cardText), date: null, sourceMessage: primary ? address : null,
            sourceMemories: [], stale: [], sentences: binding === "sentence source" ? [{ start: 0, end: 10, source: address }] : [],
          })).status, "inserted");
          if (binding.endsWith("amendment")) {
            const amendmentId = "fixture-amendment";
            assert.equal((await adapter.documentCards.amend(tx, rootScope, id, {
              amendmentId, date: "2025-01-01", sourceMessage: address, sentence: "An updated note", quote: "An earlier note",
            })).status, "inserted");
            if (binding === "purged amendment") {
              await adapter.documentCards.hideAmendment(tx, rootScope, id, amendmentId, "forgotten", { purge: true });
            }
          }
        });
        const baseApi = contextReadTestService({ ...adapter, suppressions: {
          ...adapter.suppressions, receiptWithheld: baseReceiptWithheld,
        } });
        const ref = await retain(adapter, { ...placeholder, messageId: "independent-receipt" });
        const write = service => operation === "save"
          ? service.save(scope, text, source, "fact", { receipt })
          : service.correct(scope, ref.id, ref.revision, changedText, source, { receipt });
        await seedWindow(adapter);
        const expected = (await write(baseApi)).status;
        assert.equal(expected, "suppressed");
        assert.equal((await write(api)).status, expected);
      });
    }
  });
}

async function migrateDeletedClaudeTurn(t, messageId) {
  const directory = legacyScratch(t);
  const input = prepareInput(directory, await legacyFixture(directory, 29, { localPrivacy: true }));
  const client = "claude-code";
  const engine = openMemoryCore({ path: input.path, raw: true, rawSearch: false, model: {
    ...rationaleModel(), extract: () => ({ items: [] }),
  } });
  try {
    const [part] = splitRaw(text, { id: messageId, occurredAt: new Date(Date.now() - 1000).toISOString() });
    const captured = ok(await engine.captureRaw(rawRequest(part, {
      namespace: personal, client, sessionId: "deleted-conversation", eventId: "deleted-capture",
    })));
    ok(captured.interpretation);
    const { conversations } = ok(engine.listRawConversations({ namespace: personal, client }));
    const { id, revision } = conversations.find(row => row.id === captured.raw.conversationId);
    ok(await engine.deleteConversation({
      namespace: personal, conversationId: id, expectedRevision: revision, actionId: "delete-source",
    }));
  } finally {
    await engine.close();
  }
  await createLegacyBackup(input);
  await migrateLegacyStore(input);
  editFixture(input.destination, db => {
    assert.equal(db.prepare("SELECT count(*) AS n FROM cairn_raw_messages").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM cairn_raw_anchors").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM cairn_receipts").get().n, 0);
    assert.deepEqual(db.prepare("SELECT kind, body FROM cairn_migrated_raw_privacy WHERE kind = 'uuid'")
      .all().map(row => [row.kind, row.body]), [["uuid", "null"]]);
    assert.equal(db.prepare("SELECT count(*) AS n FROM cairn_migrated_raw_privacy WHERE kind IN ('span', 'reservation')")
      .get().n, 0);
  });
  return input.destination;
}

for (const client of ["claude-code", "codex"]) {
  for (const operation of ["save", "correct"]) {
    test(`migrated UUID-only fence preserves base admission for ${client} ${operation}`, async t => {
      const messageId = "52d3bad6-9453-40bd-893b-91ab59c533df";
      const storage = await openStorage(await migrateDeletedClaudeTurn(t, messageId));
      try {
        const adapter = createSqliteAdapter(storage);
        const api = service(adapter);
        const target = coreScope(project);
        const receipt = { ...placeholder, client, messageId };
        const before = await api.save(target, "Independent synthetic memory", source, "fact");
        assert.equal(before.status, "saved");
        await seedWindow(adapter, { ...target, client });
        const body = operation === "save" ? text : changedText;
        const base = baseAdmission(storage, adapter.hashSessionKey, true);
        assert.equal(await adapter.uow.run(target.owner, { readOnly: true },
          tx => base(tx, target, { ...receipt, excerpt: body })), true);
        const actual = await adapter.uow.run(target.owner, { readOnly: true },
          tx => adapter.suppressions.receiptWithheld(tx, target, { ...receipt, excerpt: body }));
        const result = operation === "save"
          ? await api.save(target, body, source, "fact", { receipt })
          : await api.correct(target, before.item.id, before.item.revision, body, source, { receipt });
        assert.deepEqual({ receiptWithheld: actual, status: result.status }, { receiptWithheld: true, status: "suppressed" });
      } finally {
        await storage.close();
      }
    });
  }
}

test("an unrelated id and a same-id turn under another owner do not remove the exemption", async t => {
  const { adapter, api } = await fixture(t);
  await archive(adapter, { ...placeholder, messageId: "other-message" });
  const correction = { ...placeholder, messageId: "fixture-correction-message" };
  const target = { ...scope, owner: "other-owner" };
  await archive(adapter, placeholder, { target });
  await archive(adapter, correction, { target });
  const ref = await retain(adapter, { ...placeholder, messageId: "fixture-read-message" });
  await seedWindow(adapter);
  assert.equal(await withholds(adapter, placeholder), false);
  assert.equal((await api.save(scope, text, source, "fact", { receipt: placeholder })).status, "saved");
  assert.equal((await api.correct(scope, ref.id, ref.revision, changedText, source, { receipt: correction })).status, "saved");
});

test("address-only Raw evidence is withheld by an unknown-time window in the root namespace", async t => {
  const { adapter } = await fixture(t);
  const api = assemblyService(adapter);
  const ref = await captureAddress(api, placeholder);
  await archive(adapter, { ...placeholder, sessionId: "fixture-root" }, { target: rootScope });
  const fetch = () => api.fetchEvidence(selection, { refs: [ref], intent: "current" });
  const read = () => api.readContext(selection, { ...search, raw: true });
  const before = await read();
  assert.ok((await fetch()).items[0].provenance.sources.length > 0);
  const item = before.assembly.items.find(item => item.body === capturedBody);
  assert.ok(item?.evidence?.some(evidence => evidence.body === text));

  await seedWindow(adapter, rootScope);
  const after = await read();
  assert.deepEqual((await fetch()).items[0].provenance.sources, []);
  const retained = after.assembly.items.find(item => item.body === capturedBody);
  assert.ok(retained);
  assert.deepEqual(retained.evidence ?? [], []);
  assert.equal(JSON.stringify(after).includes(text), false);
});

test("an ordinary null-time receipt stays withheld", async t => {
  const opened = await fixture(t);
  const receipt = { ...placeholder, sessionId: "unknown" };
  const ref = await retain(opened.adapter, receipt);
  assert.deepEqual(await delivery(opened.api, ref), visible);
  await seedWindow(opened.adapter);
  assert.deepEqual(await paths(opened, receipt, ref), { receiptWithheld: true, ...hidden, save: "suppressed", correct: "suppressed" });
});

test("a finite window still withholds a placeholder that cites an in-window turn", async t => {
  const opened = await fixture(t);
  await archive(opened.adapter, placeholder, { occurredAtMs: 15 });
  const ref = await retain(opened.adapter, placeholder);
  assert.deepEqual(await delivery(opened.api, ref), visible);
  await seedWindow(opened.adapter, { unknownTime: undefined });
  assert.deepEqual(await paths(opened, placeholder, ref), {
    receiptWithheld: true, ...hidden, save: "suppressed", correct: "suppressed",
  });
});

test("forget-origin source and passage withholds still apply to placeholders", async t => {
  const opened = await fixture(t);
  const { adapter, api } = opened;
  await seedWindow(adapter);
  const saved = await api.save(scope, text, source, "fact", { receipt: placeholder });
  assert.equal(saved.status, "saved");
  const ref = await retain(adapter, placeholder);
  assert.equal((await api.forget(scope, saved.item.id, source)).status, "forgotten");
  assert.deepEqual(await paths(opened, placeholder, ref), {
    receiptWithheld: true, ...hidden, save: "suppressed", correct: "suppressed",
  });

  const fresh = { ...placeholder, messageId: "fresh-message" };
  assert.equal(await withholds(adapter, fresh), false);
  const passageApi = contextReadTestService({
    ...adapter, memories: {
      ...adapter.memories,
      readWritePolicy() { assert.fail("The passage snapshot should suppress before the Memory write policy"); },
    },
  });
  assert.equal((await passageApi.save(scope, text, source, "fact", { receipt: fresh })).status, "suppressed");
});
