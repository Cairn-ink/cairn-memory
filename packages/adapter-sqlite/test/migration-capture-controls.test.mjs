import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryService } from "@cairn-ink/core/service";
import { openMemoryCore } from "../../../core/index.mjs";
import { defaultRawOptions } from "../../../core/local-defaults.mjs";
import { rawRequest, splitRaw } from "../../../core/testing/raw-fixtures.mjs";
import { rationaleModel } from "../../../core/testing/rationale-model.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { editFixture, fixture, scratch } from "./legacy/fixtures.mjs";
import { coreScope, createLegacyBackup, ok, personal, prepareInput, project, sha256 } from "./migration-fixtures.mjs";

const client = "codex";
const legacyOptions = localAuthority => ({
  rawSearch: false, model: rationaleModel(),
  rawConversations: { ...defaultRawOptions(), ...(localAuthority ? { localAuthority } : {}) },
});

function captureService(storage) {
  return createMemoryService({
    storage, config: {}, gate: { assertOpen() {} }, tokens: { countTokens: () => 1 },
    clock: { nowMs: Date.now, monotonicMs: () => performance.now(), sha256Hex: async value => sha256(value),
      hmacHex: () => { throw new Error("Unexpected fingerprint key"); } },
    model: { model: "synthetic", contextWindow: 16_384, countTokens: () => 1,
      async call(stage) {
        assert.equal(stage, "extract");
        return { items: [{ content: "The synthetic capture completed.", kind: "fact",
          confidence: 0.8, sourceIndices: [0] }] };
      },
    },
    embedder: { model: "synthetic", dimensions: 2, embed: async input => input.map(() => new Float32Array([1, 0])) },
  });
}

const cases = [
  { name: "installed grant and accepted notice" },
  { name: "namespace pause", paused: true, denied: "capture_disabled" },
  { name: "namespace disable", disabled: true, denied: "capture_disabled" },
  { name: "missing notice", noNotice: true, raw: "notice_required" },
  { name: "raw off overrides missing notice", noNotice: true, rawOff: true, raw: "tool_off" },
  { name: "managed disabled grant", automaticOff: true, denied: "capture_disabled" },
  { name: "managed missing grant", missing: true, denied: "capture_disabled" },
  { name: "unmanaged missing grant", missing: true, unmanaged: true },
  { name: "unmanaged disabled grant", automaticOff: true, noNotice: true, unmanaged: true },
  { name: "stale managed binding", stale: true, denied: "revision_conflict" },
];

for (const scenario of cases) test(`migrated capture matches legacy for ${scenario.name}`, async t => {
  const directory = scratch(t);
  const input = prepareInput(directory, await fixture(directory, 29, { localPrivacy: true }));
  const control = openMemoryCore({ path: input.path, ...legacyOptions() });
  const bindings = [];
  try {
    for (const namespace of [personal, project]) {
      const first = namespace === personal;
      const initial = ok(control.getLocalCaptureControl({ namespace, client }));
      const grant = scenario.missing && first ? initial : ok(control.setLocalCaptureControl({
        namespace, client, expectedStoreId: initial.storeId, expectedRevision: initial.revision, targetId: "test-target",
        automaticCaptureEnabled: !first || !scenario.automaticOff,
        rawNoticeVersion: first && scenario.noNotice ? null : "local-plain-v1",
      }));
      const state = ok(control.getCaptureControl({ namespace }));
      const settings = first && (scenario.paused || scenario.disabled) ? ok(control.setCapturePaused({
        namespace, expectedGeneration: state.generation, paused: true,
      })) : state;
      bindings.push({ namespace, client, storeId: grant.storeId, targetId: grant.targetId ?? "test-target",
        expectedControlRevision: grant.revision + Number(first && Boolean(scenario.stale)),
        expectedConsentGeneration: grant.consentGeneration, expectedNamespaceGeneration: settings.generation });
    }
    const raw = ok(control.getRawCaptureControl({ ownerId: personal.ownerId, client }));
    const current = scenario.rawOff ? ok(await control.setRawCaptureControl({
      ownerId: personal.ownerId, client, enabled: false, expectedRevision: raw.revision,
    })) : raw;
    for (const binding of bindings) binding.expectedRawRevision = current.revision;
  } finally {
    await control.close();
  }
  if (scenario.disabled) editFixture(input.path, db => db.prepare(
    "UPDATE episode_controls SET paused=0, enabled=0 WHERE scope='personal'").run());

  const legacyOutcomes = [];
  for (const binding of bindings) {
    const legacy = openMemoryCore({ path: input.path, ...legacyOptions(scenario.unmanaged ? undefined : {
      ...binding, version: "local-capture-authority-v1",
    }) });
    try {
      const id = `legacy-${binding.namespace.scope}`;
      const reply = await legacy.captureRaw(rawRequest(splitRaw("Legacy synthetic capture evidence", { id })[0],
        { namespace: binding.namespace, client, sessionId: id, eventId: id }));
      if (!reply.ok) legacyOutcomes.push({ denied: reply.error.code });
      else {
        const outcome = ok(reply);
        assert.ok(ok(outcome.interpretation).admission.memories.length);
        legacyOutcomes.push({ raw: outcome.raw.parts[0].reason, memory: true });
      }
    } finally {
      await legacy.close();
    }
  }
  assert.deepEqual(legacyOutcomes, [
    scenario.denied ? { denied: scenario.denied } : { raw: scenario.raw ?? null, memory: true },
    { raw: scenario.rawOff ? "tool_off" : null, memory: true },
  ]);

  await createLegacyBackup(input);
  assert.deepEqual((await migrateLegacyStore(input)).pausedOwners, []);
  for (const [index, binding] of bindings.entries()) {
    const scope = coreScope(binding.namespace);
    const adapter = await openSqliteAdapter(input.destination, scenario.unmanaged ? undefined : {
      localAuthority: { ...binding, scope },
    });
    try {
      const api = captureService(adapter);
      assert.equal((await api.pauseState(scope.owner)).paused, false);
      const id = `migrated-${binding.namespace.scope}`;
      const selection = { client, sessionId: id, eventId: id };
      const messages = [{ id, role: "user", content: "Migrated synthetic capture evidence", occurredAtMs: Date.now() }];
      const key = { ...selection, scope, payloadDigest: sha256(id) };
      const expected = legacyOutcomes[index];
      if (expected.denied) {
        await assert.rejects(api.enqueueCapture(scope, { ...selection, messages }), { code: expected.denied });
        await assert.rejects(adapter.uow.run(scope.owner, { pauseLock: true }, tx =>
          adapter.capture.claim(tx, key, messages, { leaseMs: 1000 })), { code: expected.denied });
      } else {
        assert.deepEqual(await api.enqueueCapture(scope, { ...selection, messages }), { status: "accepted" });
        const done = await api.runCapture(scope, selection);
        assert.equal(done.status, "done", JSON.stringify(done));
        assert.ok(done.result.memories.length);
        const read = body => adapter.uow.run(scope.owner, { readOnly: true }, body);
        const found = await read(tx => adapter.raw.listRaw(tx, { owner: scope.owner, namespaces: [scope.namespace] },
          { cursor: null, limit: 50 }));
        assert.equal(found.items.some(row => row.messageId === id), expected.raw === null);
        assert.equal(await read(tx => adapter.raw.archiveAllowed(tx, key)), expected.raw === null);
        if (expected.raw) assert.deepEqual(await adapter.uow.run(scope.owner, {}, tx => adapter.raw.archive(tx, key, messages)),
          { archived: 0, reason: expected.raw });
      }
    } finally {
      await adapter.close();
    }
  }
});
