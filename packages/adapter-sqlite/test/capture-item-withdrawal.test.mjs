import assert from "node:assert/strict";
import { test } from "node:test";
import { assertDeletedBeforeItemEmbedding, scope } from "../../core/test/helpers/capture-item-withdrawal.mjs";
import { captureFixture } from "./capture-fixtures.mjs";
import { testAccess } from "./storage-fixtures.mjs";

test("SQLite capture withholds item embeddings when Raw is deleted during extraction", async t => {
  const fixture = await captureFixture();
  t.after(fixture.close);
  await assertDeletedBeforeItemEmbedding(fixture.adapter);
  await testAccess(fixture, scope, {}, db => {
    assert.deepEqual(db.prepare("SELECT id FROM cairn_memories").all(), []);
    assert.deepEqual(db.prepare("SELECT body FROM cairn_receipts").all(), []);
    assert.deepEqual(db.prepare("SELECT content FROM cairn_raw_messages").all(), []);
  });
});
