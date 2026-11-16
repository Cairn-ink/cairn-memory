import test from 'node:test';
import assert from 'node:assert/strict';
import { recorded, assertRecorded } from './fixtures/forget-episode-recording.mjs';
import { sql, forgottenText, stepText } from './fixtures/forget-episode.mjs';
import { layouts, label, snapshot, assertStored, noNeedles } from './fixtures/forget-episode-assertions.mjs';
import { mixedFixture, cleanRefusal, committedReads } from './fixtures/forget-episode-scope.mjs';

for (const options of layouts.filter(value => value.layout >= 48)) for (const operation of ['forget', 'correct']) {
  const fence = 'window';
  for (const deletion of ['unrelated', 'source']) {
    test('mixed-origin summary ' + fence + ' deletes ' + deletion + ' conversation then ' + operation + ' ' + label(options),
      { concurrency: false }, async t => {
        const { f, source, other, consumer, before } = await mixedFixture(t, options, fence);
        const pin = recorded('forget-episode-scope', t.name);
        await cleanRefusal(f, operation, before, pin);
        const removed = deletion === 'unrelated' ? other : source;
        const header = before.headers.find(row => row.client === removed.client && row.session_key === removed.session_key);
        // Match the owner's raw delete --conversation --yes path, including
        // retainMemories: adapters/mcp/raw-command.mjs:95-96. No SQL deletion.
        const deleted = await f.core.deleteConversation({ namespace: f.namespace, conversationId: header.id,
          expectedRevision: header.revision, retainMemories: true, actionId: 'delete-before-' + operation });
        assert.equal(assertRecorded(deleted, pin.p2.deleteConversation).conversationId, header.id);
        noNeedles(deleted);
        assertStored(f, before, { named: [removed.id], consumers: [consumer],
          upstream: [deletion === 'unrelated' ? source.id : other.id] });
        sql(f.path, db => {
          assert.equal(db.prepare('SELECT 1 FROM raw_conversations WHERE id=?').get(header.id), undefined);
          assert.deepEqual(db.prepare('SELECT * FROM memories WHERE id=?').get(f.target.id), f.target,
            'owner conversation deletion retains the Memory before the requested mutation');
        });
        const afterDeletion = snapshot(f), result = await f.act(operation);
        assertRecorded(result, pin.actions[2]);
        await committedReads(f, afterDeletion, { named: deletion === 'unrelated' ? [source.id, other.id] : [source.id], consumers: [consumer],
          pin: pin.p3, readBefore: before,
          needles: [forgottenText, stepText, 'consumerneedle', 'consumerstep'] });
        sql(f.path, db => {
          const memory = db.prepare('SELECT * FROM memories WHERE id=?').get(f.target.id);
          assert.equal(memory.deleted, Number(operation === 'forget'));
          assert.equal(memory.content, operation === 'forget' ? null : 'synthetic corrected replacement');
          assert.ok(db.prepare('SELECT 1 FROM raw_session_fences WHERE client=? AND session_key=?').get(source.client, source.session_key));
          if (deletion === 'unrelated') assert.ok(db.prepare('SELECT 1 FROM raw_source_exclusions WHERE conversation_id=?').get(f.conversation.id));
        });
      });
  }
}
