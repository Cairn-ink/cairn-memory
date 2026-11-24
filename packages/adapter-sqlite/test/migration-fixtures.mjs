import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createMemoryService } from "@cairn-ink/core/service";
import { openMemoryCore } from "../../../core/index.mjs";
import { interpretation } from "../../../core/testing/episode-capture-helpers.mjs";
import { rationaleModel } from "../../../core/testing/rationale-model.mjs";
import { localPlainPort, rawRequest, splitRaw } from "../../../core/testing/raw-fixtures.mjs";
import { createLegacyBackup } from "../src/legacy/backup.mjs";
import { editFixture, fixture, quiescence } from "./legacy/fixtures.mjs";

export const personal = { ownerId: "synthetic-owner", scope: "personal", projectId: null };
export const project = { ...personal, scope: "project", projectId: "synthetic-project" };
export const pausedScope = { ...personal, ownerId: "paused-owner" };
export const scopes = [personal, project, pausedScope];
export const coreScope = ({ ownerId, scope, projectId }) => ({ owner: ownerId, namespace: scope + "\0" + (projectId ?? "") });
export const sha256 = value => createHash("sha256").update(value).digest("hex");
export const fileDigest = path => sha256(readFileSync(path));
export const ok = result => {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
};

export function prepareInput(directory, { path, storeId }) {
  return {
    path, expectedStoreId: storeId, quiescence,
    destination: join(directory, "migrated.sqlite"), backupDirectory: join(directory, "backup"),
  };
}

const from = tag => ({ client: "manual", sessionId: "synthetic-" + tag,
  eventId: tag, role: "user", excerpt: "Evidence for " + tag });

export function admit(engine, text, namespace = personal, receipts = [from(text.split(" ")[0])]) {
  return ok(engine.admit({ namespace, memory: { content: text, kind: "fact" }, receipts })).memory;
}

export async function seededStore(directory) {
  const legacy = await fixture(directory, 29, { localPrivacy: true });
  const { path } = legacy;
  const engine = openMemoryCore({ path, model: rationaleModel(), rawSearch: false,
    rawConversations: { mode: "raw-v1", capBytes: 100_000, port: localPlainPort(),
      readPolicy: () => ({ generation: "synthetic-policy", reason: null }) } });
  const sentinels = [];
  let hashOnly;
  const before = (text, memory, namespace = personal) => {
    const snapshot = ok(engine.get({ namespace, memoryId: memory.id }));
    assert.equal(snapshot.memory.content, text);
    sentinels.push({ text, id: memory.id, namespace });
    return snapshot;
  };
  try {
    const direct = "forgetdirect synthetic memory";
    const deleted = admit(engine, direct);
    before(direct, deleted);
    ok(engine.forget({ namespace: personal, memoryId: deleted.id, expectedRevision: deleted.revision }));

    const fingerprintOnly = "hashonly synthetic memory";
    hashOnly = admit(engine, fingerprintOnly);
    before(fingerprintOnly, hashOnly);
    ok(engine.forget({ namespace: personal, memoryId: hashOnly.id, expectedRevision: hashOnly.revision }));
    sentinels.at(-1).hashOnly = true;

    const edited = "editpredecessor synthetic memory";
    const correction = admit(engine, edited);
    before(edited, correction);
    ok(engine.correct({ namespace: personal, memoryId: correction.id, expectedRevision: correction.revision,
      content: "Corrected synthetic memory", kind: "fact", receipt: from("corrected") }));
    sentinels.at(-1).retainedId = true;

    const history = "historyvisible synthetic memory";
    const old = admit(engine, history);
    ok(engine.supersede({ namespace: personal, memoryId: old.id, expectedRevision: old.revision,
      replacement: { content: "Replacement for visible history", kind: "fact" }, receipts: [from("history-successor")] }));
    assert.equal(ok(engine.get({ namespace: personal, memoryId: old.id })).memory.state, "historical");

    const retired = "historyforgotten synthetic memory";
    const retiredMemory = admit(engine, retired);
    const retirement = ok(engine.supersede({ namespace: personal, memoryId: retiredMemory.id, expectedRevision: retiredMemory.revision,
      replacement: { content: "Replacement for forgotten history", kind: "fact" }, receipts: [from("forgotten-successor")] }));
    const historical = before(retired, retiredMemory).memory;
    assert.equal(historical.state, "historical");
    assert.ok(retirement.memory.id);
    ok(engine.forget({ namespace: personal, memoryId: historical.id, expectedRevision: historical.revision }));

    const raw = "rawcascade synthetic memory";
    const request = rawRequest(splitRaw(raw)[0], { namespace: project, sessionId: "raw-cascade" });
    const captured = ok(await engine.captureRaw(request));
    const memory = ok(captured.interpretation).admission.memories[0];
    before(raw, memory, project);
    const conversationId = captured.raw.conversationId;
    const { conversation } = ok(await engine.getConversation({ namespace: project, conversationId }));
    const deletion = ok(await engine.deleteConversation({ namespace: project, conversationId,
      expectedRevision: conversation.revision, actionId: "synthetic-raw-delete" }));
    assert.equal(deletion.forgottenMemories, 1);

    // Same coordinates, distinct legacy receipts, both preserved.
    const receipt = from("same-address");
    admit(engine, "Visible project memory with two receipts", project, [receipt, { ...receipt, excerpt: "Second excerpt" }]);
    admit(engine, "Visible memory in paused owner", pausedScope);
    ok(engine.setCapturePaused({ namespace: pausedScope, expectedGeneration: "initial", paused: true }));
    for (const { text, id, namespace, retainedId } of sentinels) {
      const view = engine.get({ namespace, memoryId: id });
      if (retainedId) assert.notEqual(ok(view).memory.content, text);
      else assert.equal(view.error?.code, "memory_not_found");
      assert.equal(ok(engine.isSuppressed({ namespace, content: text })).suppressed, true);
    }
  } finally {
    await engine.close();
  }
  const episode = openMemoryCore({ path, model: { ...rationaleModel(), interpretEpisode: interpretation },
    captureQualification: "source-bound-v2", captureEvidence: "staged-v1",
    sessionEpisodes: { mode: "episode-v1", draftEveryBatches: 2 } });
  try {
    const text = "episodecascade synthetic memory";
    const capture = ok(await episode.capture({ namespace: project, client: "codex",
      sessionId: "episode-session", eventId: "episode-event",
      episodeContext: { clientLabel: "Synthetic", generation: "initial", origin: "ordinary" },
      messages: [{ id: "episode-message", role: "user", content: text, occurredAt: null }] }));
    const [memory] = capture.admission.memories;
    assert.equal(ok(episode.get({ namespace: project, memoryId: memory.id })).memory.content, text);
    const current = ok(episode.getEpisode({ namespace: project, episodeId: capture.episode.id })).episode;
    ok(episode.forgetEpisode({ namespace: project, episodeId: current.id, expectedRevision: current.revision }));
    assert.equal(episode.get({ namespace: project, memoryId: memory.id }).error?.code, "memory_not_found");
    assert.equal(ok(episode.isSuppressed({ namespace: project, content: text })).suppressed, true);
    sentinels.push({ text, id: memory.id, namespace: project });
  } finally {
    await episode.close();
  }
  const text = "reviewrejected synthetic decision";
  const review = openMemoryCore({ path, decisionReview: "required-v1", model: {
    ...rationaleModel(),
    extract: () => ({ items: [{ content: text, kind: "decision", confidence: 0.8, sourceIndices: [0] }] }),
  } });
  try {
    ok(await review.capture({ namespace: project, client: "codex", sessionId: "review-session", eventId: "review-event",
      messages: [{ id: "review-message", role: "user", content: text }] }));
    const [memory] = ok(review.list({ namespace: project, reviewState: "awaiting" })).memories;
    assert.equal(ok(review.get({ namespace: project, memoryId: memory.id, includeAwaiting: true })).memory.content, text);
    ok(review.reject({ namespace: project, memoryId: memory.id, expectedRevision: memory.revision, actionId: "reject-decision" }));
    assert.equal(review.get({ namespace: project, memoryId: memory.id, includeAwaiting: true }).error?.code, "memory_not_found");
    assert.equal(ok(review.isSuppressed({ namespace: project, content: text })).suppressed, true);
    sentinels.push({ text, id: memory.id, namespace: project });
  } finally {
    await review.close();
  }
  // Model a source with no retained identity. The real engine supplies the denial.
  editFixture(path, db => db.prepare("DELETE FROM memories WHERE id = ?").run(hashOnly.id));
  const input = prepareInput(directory, legacy);
  return { input, sentinels };
}

export async function legacyVisible(path, namespaces = scopes) {
  const engine = openMemoryCore({ path });
  const visible = [];
  try {
    for (const namespace of namespaces) {
      let cursor;
      do {
        const page = ok(engine.list({ namespace, limit: 2, ...(cursor ? { cursor } : {}) }));
        for (const item of page.memories) {
          const { memory, receipts } = ok(engine.get({ namespace, memoryId: item.id, receiptLimit: 100 }));
          visible.push({
            scope: coreScope(namespace), id: memory.id, text: memory.content, kind: memory.kind,
            origin: memory.origin === "agent-inferred" ? "inferred" : memory.origin, confidence: memory.confidence,
            revision: memory.revision, historical: memory.state === "historical",
            updatedAtUs: (BigInt(Date.parse(memory.updatedAt)) * 1000n).toString(),
            createdAtMs: Date.parse(memory.createdAt),
            receipts: receipts.map(r => ({ client: r.client, sessionId: r.sessionId, messageId: r.eventId, role: r.role, occurredAtMs: null })),
          });
        }
        cursor = page.nextCursor;
      } while (cursor);
    }
  } finally {
    await engine.close();
  }
  return visible.sort(order);
}

const order = (a, b) => a.id.localeCompare(b.id);

export async function migratedVisible(adapter, namespaces = scopes) {
  const visible = [];
  for (const namespace of namespaces) {
    const scope = coreScope(namespace);
    const readSet = { owner: scope.owner, namespaces: [scope.namespace] };
    await adapter.uow.run(scope.owner, { readOnly: true }, async tx => {
      let cursor = null;
      do {
        const page = await adapter.memories.exportPage(tx, scope, { cursor, limit: 2 });
        const refs = page.items.map(row => ({ type: "memory", namespace: scope.namespace, id: row.id }));
        const rows = await adapter.hydrate.hydrate(tx, readSet, refs, "export");
        assert.equal(rows.length, page.items.length);
        for (const { memory, receipts } of rows) {
          const { id, text, kind, origin, confidence, revision, historical, createdAtMs, updatedAtUs } = memory;
          visible.push({ scope, id, text, kind, origin, confidence, revision, historical, createdAtMs,
            updatedAtUs: updatedAtUs.toString(), receipts });
        }
        cursor = page.nextCursor;
      } while (cursor);
    });
  }
  return visible.sort(order);
}

export function service(storage) {
  const unexpected = () => { throw new Error("Unexpected model or key call"); };
  const countTokens = () => 1;
  return createMemoryService({ storage, config: { rowShingles: false },
    clock: { nowMs: Date.now, monotonicMs: () => performance.now(), sha256Hex: async text => sha256(text), hmacHex: unexpected },
    gate: { assertOpen() {} }, tokens: { countTokens },
    model: { model: "synthetic", contextWindow: 4096, call: unexpected, countTokens },
    embedder: { model: "synthetic", dimensions: 2, embed: async texts => texts.map(() => new Float32Array([1, 0])) },
  });
}

export { createLegacyBackup };
