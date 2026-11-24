import assert from "node:assert/strict";
import test from "node:test";
import {
  assertChangedCapture, assertDeletedCapture, deletionTimings, scope,
} from "../../core/test/helpers/service-capture-withdrawal.mjs";
import { captureFixture } from "./capture-fixtures.mjs";
import { testAccess } from "./storage-fixtures.mjs";

function readStored(fixture) {
  return testAccess(fixture, scope, {}, db => ({
    memories: db.prepare("SELECT json_extract(body, '$.text') AS text FROM cairn_memories").all().map(({ text }) => text),
    raw: db.prepare("SELECT content FROM cairn_raw_messages").all().map(({ content }) => JSON.parse(content)),
  }));
}

for (const [timing, boundary] of Object.entries(deletionTimings)) {
  test(`SQLite capture withdraws the deleted conversation ${boundary}`, async t => {
    const fixture = await captureFixture();
    t.after(fixture.close);
    await assertDeletedCapture(fixture.adapter, timing, () => readStored(fixture));
  });
}

for (const timing of ["after-generation", "during-dispatch"]) {
  test(`SQLite capture withdraws the edited source ${deletionTimings[timing]}`, async t => {
    const fixture = await captureFixture();
    t.after(fixture.close);
    async function change() {
      await testAccess(fixture, scope, { write: true }, db => {
        const updated = db.prepare(`UPDATE cairn_capture_outbox
          SET messages = json_set(messages, '$[0].content', lower(json_extract(messages, '$[0].content')))
          WHERE owner_id = ?`).run(scope.owner);
        assert.equal(Number(updated.changes), 1);
        // Start with an empty archive so completion must restore the unchanged source alone.
        const deleted = db.prepare("DELETE FROM cairn_raw_messages WHERE owner_id = ?").run(scope.owner);
        assert.equal(Number(deleted.changes), 2);
      });
    }
    await assertChangedCapture(fixture.adapter, timing, change, () => readStored(fixture));
  });
}
