import assert from "node:assert/strict";
import { test } from "node:test";
import { runCase } from "@cairn-ink/conformance";
import { CONTEXT_ASSEMBLY_CASES } from "../../conformance/src/context-assembly-cases.mjs";
import { CONTEXT_READ_CASES } from "../../conformance/src/context-read-cases.mjs";
import { createSqliteAdapter } from "../src/adapter.mjs";
import { openStorage } from "../src/schema/open.mjs";
import { scopeKey } from "../src/storage-values.mjs";
import { scratch } from "./storage-fixtures.mjs";

function withReceiptFixtures(adapter, port) {
  const { memories } = adapter;
  // The kit supplies in-memory fixture IDs and times. SQLite generates those
  // fields and requires a visible archived source at the pinned safety revision.
  async function withReceipts(tx, scope, receipts, write) {
    const fixture = receipts.filter(receipt => receipt.id && receipt.excerpt);
    for (const { client, sessionId, messageId, role, occurredAtMs, excerpt } of fixture) {
      await adapter.raw.importArchive(tx, scope, { client, sessionId }, [{ id: messageId, role, occurredAtMs, content: excerpt }]);
    }
    const { id, result } = await write();
    if (fixture.length) await port(tx, scope.owner, { write: true }, db => {
      const set = db.prepare(`UPDATE OR IGNORE cairn_inspect_receipts SET id = ?, created_at_us = ?
        WHERE owner_id = ? AND namespace_key = ? AND memory_id = ? AND ordinal = (
          SELECT ordinal FROM cairn_receipts WHERE owner_id = ? AND namespace_key = ? AND memory_id = ? AND source_key = ?
        )`);
      const coordinates = [...scopeKey(scope), id];
      for (const receipt of fixture) {
        set.run(receipt.id, BigInt(receipt.createdAtMs) * 1000n, ...coordinates, ...coordinates,
          JSON.stringify([receipt.client, receipt.sessionId, receipt.messageId]));
      }
    });
    return result;
  }
  return {
    ...adapter,
    uow: { run: (owner, options, work) => adapter.uow.run(owner,
      options.readOnly ? options : { ...options, pauseLock: true }, work) },
    memories: {
      ...memories,
      insert(tx, scope, row, receipts, time) {
        return withReceipts(tx, scope, receipts, async () => {
          const result = await memories.insert(tx, scope, row, receipts, time);
          return { id: result.id, result };
        });
      },
      touchDuplicate(tx, scope, id, receipts, merge, time) {
        return withReceipts(tx, scope, receipts, async () =>
          ({ id, result: await memories.touchDuplicate(tx, scope, id, receipts, merge, time) }));
      },
    },
  };
}

function withRawUpkeep(adapter) {
  if (!adapter.maintainContextRaw) return adapter;
  let published = false;
  return {
    ...adapter,
    contextRead: {
      ...adapter.contextRead,
      async prepareLexical(readSet, selection, options) {
        // The Raw case begins with a complete empty inventory. Publish it
        // through actual upkeep before asking core to deliver it.
        if (!published) published = await adapter.maintainContextRaw(readSet, options);
        return adapter.contextRead.prepareLexical(readSet, selection, options);
      },
    },
  };
}

async function withFingerprintFixture(adapter, capabilities) {
  if (!capabilities.fingerprintKey) return adapter;
  const signingKey = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return { ...adapter, capabilities: { ...adapter.capabilities, fingerprintKey: true },
    keys: { async userKey() { return { id: "fixture-key", signingKey }; } } };
}

const factory = (monotonicMs) => ({
  name: "sqlite context read",
  async open({ capabilities }) {
    const { path, remove } = scratch();
    let storage;
    try {
      storage = await openStorage(path);
      const sqlite = createSqliteAdapter(storage, { capabilities, monotonicMs });
      const fixtures = withRawUpkeep(withReceiptFixtures(sqlite, storage.port));
      const adapter = await withFingerprintFixture(fixtures, capabilities);
      return {
        adapter, nativeErrorMap: {}, busyNativeCodes: [], embeddingDimensions: null, sessionRefs: "hashed",
        async close() {
          try {
            await adapter.close();
          } finally {
            remove();
          }
        },
      };
    } catch (error) {
      try {
        await storage?.close();
      } finally {
        remove();
      }
      throw error;
    }
  },
});

for (const candidate of [...CONTEXT_READ_CASES, ...CONTEXT_ASSEMBLY_CASES]) {
  test(`${candidate.id} ${candidate.title}`, async () => {
    // The deadline case advances a zero-based clock during metering. Align
    // the SQLite deadline checks with that clock for its small fixtures.
    const monotonicMs = candidate.id === "T-CONTEXT-ASSEMBLY-3" ? () => 0 : undefined;
    assert.equal(await runCase(factory(monotonicMs), candidate), null);
  });
}
