import assert from "node:assert/strict";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import { factIncarnationBody } from "@cairn-ink/core";
import { openMemoryCore } from "../../../core/index.mjs";
import { defaultRawOptions } from "../../../core/local-defaults.mjs";
import { rawRequest, splitRaw } from "../../../core/testing/raw-fixtures.mjs";
import { rationaleModel } from "../../../core/testing/rationale-model.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { fixture, scratch } from "./legacy/fixtures.mjs";
import { coreScope, createLegacyBackup, ok, personal, prepareInput, project, sha256 } from "./migration-fixtures.mjs";

const foreign = { ...project, ownerId: "freed-bytes-synthetic-owner" };
const namespaces = [project, personal, foreign];
const rawSource = { client: "claude-code", sessionId: "synthetic-freed-bytes-turn" };

/** Pin the legacy memory ids to a fixed order: the freed-block residue only appears for this row order. */
async function withPinnedMemoryIds(order, run) {
  const original = crypto.randomUUID;
  let next = 0;
  crypto.randomUUID = (...args) => {
    const stack = new Error().stack ?? "";
    if (stack.includes("at allocateContentKey (") && stack.includes("at admitMutation (")) {
      return order[next++ % order.length] + "0000000-0000-4000-8000-000000000000";
    }
    return original.apply(crypto, args);
  };
  syncBuiltinESMExports();
  try {
    return await run();
  } finally {
    crypto.randomUUID = original;
    syncBuiltinESMExports();
  }
}

async function migrated(t, label) {
  const directory = scratch(t);
  const input = prepareInput(directory, await fixture(directory, 29, { localPrivacy: true }));
  const marker = "Quartz synthetic freed-bytes marker " + label;
  const rows = [];
  const engine = openMemoryCore({ path: input.path, rawSearch: false, rawConversations: defaultRawOptions(), model: {
    ...rationaleModel(),
    extract: ({ input: { messages } }) => ({ items: messages.map(({ content, index }) => ({
      content: "Synthetic conclusion for " + content.split(" ")[0], kind: "fact", confidence: 0.8, sourceIndices: [index],
    })) }),
  } });
  try {
    await withPinnedMemoryIds("012", async () => {
      for (const [index, namespace] of namespaces.entries()) {
        const excerpt = index === 0 ? marker : ["Quartz", "Agate", "Basalt"][index] + " synthetic retained witness " + label;
        const capture = ok(await engine.captureRaw(rawRequest(
          splitRaw(excerpt, { id: "message", occurredAt: new Date().toISOString() })[0], { namespace, ...rawSource })));
        rows.push({ scope: coreScope(namespace), memoryId: ok(capture.interpretation).admission.memories[0].id });
      }
    });
  } finally {
    await engine.close();
  }
  assert.deepEqual(rows.map(row => row.memoryId[0]), ["0", "2", "1"], "Pinned allocation 012 must yield this memory id order");
  await createLegacyBackup(input);
  await migrateLegacyStore(input);
  return { input, marker, target: rows[0] };
}

function residue(path, marker) {
  const needle = Buffer.from(marker);
  return ["", "-wal", "-shm", "-journal"].filter(suffix => existsSync(path + suffix)
    && readFileSync(path + suffix).includes(needle)).map(suffix => "database" + suffix);
}

test("conversation delete after migration leaves no excerpt bytes in the closed database", async t => {
  const { input, marker, target } = await migrated(t, "delete");
  assert.equal(residue(input.destination, marker).length > 0, true, "Marker must be stored before deletion");
  const store = await openSqliteAdapter(input.destination);
  try {
    const result = await store.uow.run(target.scope.owner, { pauseLock: true },
      tx => store.raw.deleteConversation(tx, target.scope, rawSource));
    assert.equal(result.rawDeleted, 1);
  } finally {
    await store.close();
  }
  assert.deepEqual(residue(input.destination, marker), []);
});

test("span purge after migration leaves no excerpt bytes in the closed database", async t => {
  const { input, marker, target } = await migrated(t, "span");
  assert.equal(residue(input.destination, marker).length > 0, true, "Marker must be stored before the purge");
  const store = await openSqliteAdapter(input.destination);
  try {
    const { scope, memoryId } = target;
    const run = operation => store.uow.run(scope.owner, { pauseLock: true }, operation);
    const spans = await run(tx => store.spanLineage.resolveSpans(tx, scope, memoryId));
    assert.equal(spans.length, 1);
    const fact = { ...spans[0], actionId: "synthetic-freed-bytes-span" };
    const incarnation = sha256(factIncarnationBody(fact));
    await run(async tx => {
      const persisted = await store.suppressions.writeFact(tx, fact, incarnation);
      const result = await store.raw.purgeWithheld(tx, scope, [{ ...persisted, fact, incarnation }]);
      assert.equal(result.rawDeleted, 1);
    });
  } finally {
    await store.close();
  }
  assert.deepEqual(residue(input.destination, marker), []);
});
