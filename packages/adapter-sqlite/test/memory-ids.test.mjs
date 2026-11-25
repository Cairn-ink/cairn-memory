import assert from "node:assert/strict";
import test from "node:test";
import { openMemoryCore } from "../../../core/index.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { fixture, scratch } from "./legacy/fixtures.mjs";
import { admit, coreScope, createLegacyBackup, personal, prepareInput, sha256 } from "./migration-fixtures.mjs";

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

test("allocates 10,000 distinct canonical memory UUIDs alongside a preserved legacy UUID", async t => {
  const directory = scratch(t);
  const input = prepareInput(directory, await fixture(directory, 29));
  const legacyText = "Synthetic memory from the legacy engine";
  const engine = openMemoryCore({ path: input.path });
  let legacyId;
  try {
    legacyId = admit(engine, legacyText).id;
  } finally {
    await engine.close();
  }
  assert.match(legacyId, uuidV4);
  await createLegacyBackup(input);
  await migrateLegacyStore(input);

  const adapter = await openSqliteAdapter(input.destination);
  const scope = coreScope(personal);
  const count = 10_000;
  const ids = new Set();
  try {
    await adapter.uow.run(scope.owner, {}, async tx => {
      for (let index = 0; index < count; index++) {
        const text = `Synthetic new memory ${index}`;
        const { id } = await adapter.memories.insert(tx, scope, {
          kind: "fact", origin: "explicit", text, textHash: "sha256:" + sha256(text),
          source: { kind: "mcp", client: null, sessionId: null }, confidence: 1, embedding: null,
        }, [], index + 1);
        assert.match(id, uuidV4);
        ids.add(id);
      }
    });
    assert.equal(ids.size, count);
    assert.equal(ids.has(legacyId), false);

    await adapter.uow.run(scope.owner, { readOnly: true }, async tx => {
      const legacy = await adapter.memories.get(tx, scope, legacyId);
      assert.equal(legacy.id, legacyId);
      assert.equal(legacy.text, legacyText);
      const { items, nextCursor } = await adapter.memories.exportPage(tx, scope, { cursor: null, limit: count + 1 });
      assert.equal(nextCursor, null);
      assert.deepEqual(new Set(items.map(row => row.id)), new Set([legacyId, ...ids]));
    });
  } finally {
    await adapter.close();
  }
});
