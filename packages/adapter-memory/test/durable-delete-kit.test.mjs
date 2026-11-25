import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { DURABLE_DELETE_CASES, runCase } from "@cairn-ink/conformance";
import { rawFactory } from "./fixtures/raw.mjs";

const testCase = DURABLE_DELETE_CASES.find(({ id }) => id === "K-RAW-DEL-1");
assert.ok(testCase);

for (const sessionRefs of ["plain", "hashed"]) {
  for (const required of [false, true]) {
    const factory = rawFactory({ sessionRefs, required });
    test(`${factory.name} ${testCase.id} ${testCase.title}`, async () => {
      assert.equal(await runCase(factory, testCase), null);
    });
  }
}

/** @param {(raw: NonNullable<ReturnType<typeof createMemoryAdapter>["raw"]>) => void} mutate */
function mutant(mutate) {
  return rawFactory({
    create(options) {
      const adapter = createMemoryAdapter(options);
      assert.ok(adapter.raw);
      mutate(adapter.raw);
      return adapter;
    },
  });
}

test("K-RAW-DEL-1 rejects deletion without a fence", async () => {
  const factory = mutant(raw => {
    raw.deleteConversation = async (tx, scope, session) => {
      const { rawDeleted } = await raw.eraseSessions(tx, scope, [session]);
      return { rawDeleted };
    };
  });
  await assert.rejects(runCase(factory, testCase),
    /^Error: Raw archive must refuse a new message in the deleted conversation$/);
});

test("K-RAW-DEL-1 rejects a fence applied only to archive", async () => {
  const factory = mutant(raw => {
    const { archive } = raw;
    const deleted = new Set();
    const slot = ({ client, sessionId }) => JSON.stringify([client, sessionId]);
    raw.deleteConversation = async (tx, scope, session) => {
      const { rawDeleted } = await raw.eraseSessions(tx, scope, [session]);
      deleted.add(slot(session));
      return { rawDeleted };
    };
    raw.archive = async (tx, key, messages) => deleted.has(slot(key))
      ? { archived: 0 } : archive(tx, key, messages);
  });
  await assert.rejects(runCase(factory, testCase),
    /^Error: Raw import must refuse a new message in the deleted conversation \(got \{"archived":1,"existing":0,"withheld":0\}\)$/);
});

test("K-RAW-DEL-1 rejects a time cutoff at the deletion instead of a durable refusal", async () => {
  const factory = mutant(raw => {
    const { archive, importArchive } = raw;
    assert.ok(importArchive);
    /** @type {Map<string, number>} */
    const cutoffs = new Map();
    const slot = ({ client, sessionId }) => JSON.stringify([client, sessionId]);
    /** @param {{client: string, sessionId: string}} session @param {readonly {occurredAtMs: number | null}[]} messages */
    const beforeCutoff = (session, messages) => cutoffs.has(slot(session)) &&
      messages.every(({ occurredAtMs }) => occurredAtMs !== null && occurredAtMs <= (cutoffs.get(slot(session)) ?? 0));
    raw.deleteConversation = async (tx, scope, session) => {
      const { rawDeleted } = await raw.eraseSessions(tx, scope, [session]);
      cutoffs.set(slot(session), Date.now());
      return { rawDeleted };
    };
    raw.archive = async (tx, key, messages) => beforeCutoff(key, messages)
      ? { archived: 0 } : archive(tx, key, messages);
    raw.importArchive = async (tx, scope, session, messages, options) => beforeCutoff(session, messages)
      ? { archived: 0, existing: 0, withheld: messages.length } : importArchive(tx, scope, session, messages, options);
  });
  await assert.rejects(runCase(factory, testCase),
    /^Error: Raw archive must refuse a new message timestamped after the deletion$/);
});

test("K-RAW-DEL-1 rejects a fence applied to the entire client", async () => {
  const factory = mutant(raw => {
    const { archive, deleteConversation } = raw;
    const fencedClients = new Set();
    raw.deleteConversation = async (tx, scope, session) => {
      const result = await deleteConversation(tx, scope, session);
      fencedClients.add(session.client);
      return result;
    };
    raw.archive = async (tx, key, messages) => fencedClients.has(key.client)
      ? { archived: 0 } : archive(tx, key, messages);
  });
  await assert.rejects(runCase(factory, testCase),
    /^Error: Raw archive must still accept a new message in another conversation for the same client$/);
});

const scope = { owner: "owner", namespace: null };
const key = { scope, client: "client", sessionId: "conversation", eventId: "capture", payloadDigest: "a".repeat(64) };
const messages = [
  { id: "first", role: "user", content: "The trail crosses a bridge.", occurredAtMs: 10 },
  { id: "second", role: "user", content: "The path turns at the gate.", occurredAtMs: 20 },
];
const blankMessages = messages.map(message => ({ ...message, content: "" }));

async function leaseCapture(batch, { admit = true } = {}) {
  const { capture, raw, uow } = createMemoryAdapter({ capabilities: { rawArchive: true } });
  const write = work => uow.run(scope.owner, { pauseLock: true }, work);
  if (admit) assert.deepEqual(await write(tx => capture.admit(tx, key, batch)), { status: "admitted" });
  const claim = await write(tx => capture.claim(tx, key, batch, { leaseMs: 60_000 }));
  assert.equal(claim.status, "claimed");
  return {
    raw, write,
    load: () => uow.run(scope.owner, { readOnly: true }, tx => capture.load(tx, key)),
    recheck: positions => write(tx => capture.assertEligible(tx, key, positions)),
  };
}

test("capture recheck accepts an empty selection after durable deletion blanks the admitted outbox", async () => {
  const { raw, write, load, recheck } = await leaseCapture(messages);
  assert.deepEqual(await write(tx => raw.deleteConversation(tx, scope, key)), { rawDeleted: 0 });
  assert.deepEqual((await load()).messages, blankMessages);
  await recheck([]);
});

test("capture recheck refuses a selected position from an all-blank fenced outbox", async () => {
  const { raw, write, recheck } = await leaseCapture(blankMessages);
  // Fence without erasing so a message tombstone cannot short-circuit the lineage check.
  await write(tx => raw.fenceSession(tx, scope, key));
  await assert.rejects(recheck([0]), { code: "lineage_fenced" });
});

test("capture recheck refuses an empty selection from a partly blank fenced outbox", async () => {
  const { raw, write, recheck } = await leaseCapture([blankMessages[0], messages[1]]);
  await write(tx => raw.fenceSession(tx, scope, key));
  await assert.rejects(recheck([]), { code: "lineage_fenced" });
});

for (const [description, otherFence] of [
  ["no direct fence", null],
  ["a fence in another namespace", { ...key, scope: { ...scope, namespace: "other" } }],
  ["a fence for another client", { ...key, client: "other-client" }],
]) {
  test(`capture recheck refuses a blank outbox with blocked lineage and ${description}`, async () => {
    const { raw, write, recheck } = await leaseCapture(messages);
    const source = { ...key, sessionId: "source" };
    await write(async tx => {
      // A fenced source makes the unfenced conversation fail the normal lineage check.
      await raw.recordLineage(tx, source, messages);
      await raw.fenceSession(tx, scope, source);
      assert.deepEqual(await raw.eraseSessions(tx, scope, [key]), { rawDeleted: 0, ledgerBlanked: messages.length });
      if (otherFence) await raw.fenceSession(tx, otherFence.scope, otherFence);
    });
    await assert.rejects(recheck([]), { code: "lineage_fenced" });
  });
}

test("capture recheck refuses an empty selection from a fenced direct claim", async () => {
  const { raw, write, load, recheck } = await leaseCapture(messages, { admit: false });
  assert.equal(await load(), null);
  await write(tx => raw.fenceSession(tx, scope, key));
  await assert.rejects(recheck([]), { code: "lineage_fenced" });
});

test("capture recheck refuses an empty selection from a fenced outbox with zero slots", async () => {
  const { raw, write, recheck } = await leaseCapture([]);
  await write(tx => raw.fenceSession(tx, scope, key));
  await assert.rejects(recheck([]), { code: "lineage_fenced" });
});
