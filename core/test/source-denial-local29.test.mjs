import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { resolveContentLayout } from '../content-safety-layout.mjs';
import { openDatabase as openVersion29 } from '../testing/method-package-v29-database.mjs';
import { options, interpretation } from '../testing/episode-capture-helpers.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const namespace = { ownerId: 'synthetic-owner', scope: 'personal', projectId: null };
const source = { id: 'synthetic-message-1', role: 'user', content: 'Synthetic source text one.' };
const clean = { id: 'synthetic-message-2', role: 'user', content: 'Synthetic independent source text.' };
const original = 'Synthetic original fact';
const reworded = 'Synthetic reworded fact';
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const excluded = result => assert.deepEqual(result, { ok: false,
  error: { code: 'source_excluded', retryable: false } });

function fixture(t, client = 'synthetic') {
  const workspace = createTestWorkspace(t, { prefix: 'source-denial-29-' });
  const path = join(workspace.path, 'store.sqlite');
  // Build the actual historical layout, rather than relabeling a newer store.
  // This frozen builder is checked in: no test needs Git history or a full clone.
  const old = openVersion29(path, { localControls: true });
  assert.equal(old.prepare('PRAGMA user_version').get().user_version, 29);
  old.close();
  const db = new DatabaseSync(path);
  workspace.defer(() => db.close());
  const assertShape = () => {
    const physical = db.prepare('PRAGMA user_version').get().user_version;
    assert.equal(physical, 29, 'the installed opener must keep physical layout 29');
    assert.equal(resolveContentLayout(physical).suppressionRevision, 0);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='content_safety_control'").get(), undefined);
    for (const name of ['raw_conversations', 'raw_source_exclusions', 'raw_session_fences', 'local_capture_controls'])
      assert.ok(db.prepare('SELECT 1 FROM sqlite_schema WHERE name=?').get(name), name);
  };
  assertShape();
  const plan = { content: original, seen: [], counter: null };
  const model = { ...rationaleModel(), countTokens() { plan.counter?.(); return 1; },
    extract({ input }) {
      plan.seen.push(structuredClone(input.messages));
      return { items: input.messages.map((message, index) => ({
        content: message.content === source.content ? plan.content : 'Synthetic independent fact',
        kind: 'fact', confidence: .9, sourceIndices: [index],
      })) };
    }, interpretEpisode: request => interpretation(request),
  };
  const open = episode => {
    // Use the installed public local selection, including its default privacy
    // policy and Raw implementation. Do not replace it with a hosted/off opener.
    const core = openMemoryCore({ path, raw: true, model, ...(episode ? options : {}) });
    workspace.defer(() => core.close());
    assert.equal(typeof core.getLocalCaptureControl, 'function', 'local Raw composition is active');
    assertShape();
    return core;
  };
  const core = open(false);
  const send = async (receiver, eventId, messages = [source], sessionId = 'synthetic-session', episode = false) => {
    const result = await receiver.capture({ namespace, client, sessionId, eventId, messages,
      ...(episode ? { episodeContext: { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' } } : {}),
    });
    assertShape();
    return result;
  };
  const forget = memory => {
    assert.equal(ok(core.forget({ namespace, memoryId: memory.id, expectedRevision: memory.revision })).forgotten, true);
    assert.equal(db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(memory.id).n, 0);
    assert.ok(db.prepare("SELECT 1 FROM suppressed WHERE fingerprint LIKE 'rs1:%'").get());
    plan.content = reworded;
    plan.seen = [];
  };
  const active = () => db.prepare('SELECT content FROM memories WHERE deleted=0 ORDER BY content').all().map(row => row.content);
  const noRaw = () => assert.equal(db.prepare('SELECT count(*) n FROM raw_conversations').get().n, 0);
  return { core, db, plan, open, send, forget, active, noRaw, assertShape };
}

test('local 29: forget between filter and extraction dispatch rechecks durable tokens without Raw', async t => {
  const f = fixture(t);
  const first = ok(await f.send(f.core, 'synthetic-batch-1')).admission.memories[0];
  f.noRaw();
  f.plan.seen = [];
  let counters = 0, forgotten = false;
  // The second token count is in callModel, after the capture filter and before
  // validateFresh dispatches extraction. This uses an existing model callback.
  f.plan.counter = () => {
    if (++counters === 2) { f.forget(first); forgotten = true; }
  };
  const result = await f.send(f.core, 'synthetic-batch-2');
  assert.equal(forgotten, true, 'the live source was forgotten during preflight');
  t.diagnostic(JSON.stringify({ outcome: result, extractCalls: f.plan.seen.length, counters }));
  assert.equal(f.plan.seen.length, 0, 'forgotten text must never reach extraction');
  excluded(result);
  assert.deepEqual(f.active(), []);
  f.noRaw();
});

for (const client of ['synthetic', 'codex', 'claude-code']) {
  test(`local 29: ${client} new batch excludes the forgotten message and admits an independent message`, async t => {
    const f = fixture(t, client);
    const first = ok(await f.send(f.core, 'synthetic-batch-1')).admission.memories[0];
    assert.equal(f.db.prepare('SELECT count(*) n FROM raw_conversations').get().n, client === 'synthetic' ? 0 : 1);
    f.forget(first);
    const result = await f.send(f.core, 'synthetic-batch-2');
    t.diagnostic(JSON.stringify({ outcome: result, extractCalls: f.plan.seen.length }));
    if (client === 'synthetic') {
      const { indexRevision } = ok(f.core.map({ namespace }));
      assert.deepEqual(ok(result).admission, { memories: [], suppressedCount: 1, indexRevision });
    } else excluded(result);
    assert.equal(f.plan.seen.length, 0);
    assert.deepEqual(f.active(), []);
    const independent = ok(await f.send(f.core, 'synthetic-batch-3', [clean]));
    assert.equal(independent.admission.memories.length, 1);
    assert.deepEqual(f.plan.seen.flat().map(message => message.content), [clean.content]);
    assert.deepEqual(f.active(), ['Synthetic independent fact']);
  });

  test(`local 29: ${client} fork-like session change with the same message id documents the remaining gap`, async t => {
    const f = fixture(t, client);
    const first = ok(await f.send(f.core, 'synthetic-batch-1')).admission.memories[0];
    f.forget(first);
    // Receipt identities, source addresses, Raw roots and session fences all
    // include the session. A fork supplies no engine-visible link to its origin.
    const result = await f.send(f.core, 'synthetic-batch-2', [source], 'synthetic-fork');
    t.diagnostic(JSON.stringify({ knownGap: 'unlinked-session-change', outcome: result,
      extractCalls: f.plan.seen.length }));
    assert.equal(ok(result).admission.memories.length, 1, 'known gap: the new session can re-admit a reworded fact');
    assert.deepEqual(f.active(), [reworded]);
    assert.deepEqual(f.plan.seen.flat().map(message => message.content), [source.content]);
  });
}

for (const from of [false, true]) {
  test(`local 29: Raw-free mode switch ${from ? 'Episode to ordinary' : 'ordinary to Episode'} filters the re-send`, async t => {
    const f = fixture(t), episode = f.open(true);
    const first = ok(await f.send(from ? episode : f.core, 'synthetic-batch-1', [source], 'synthetic-session', from))
      .admission.memories[0];
    assert.ok(first, 'Episode mode is allowed by the local 29 profile');
    f.forget(first);
    f.noRaw();
    const receiver = from ? f.core : episode;
    const result = await f.send(receiver, 'synthetic-batch-2', [source], 'synthetic-session', !from);
    t.diagnostic(JSON.stringify({ outcome: result, extractCalls: f.plan.seen.length }));
    const { indexRevision } = ok(f.core.map({ namespace }));
    assert.deepEqual(ok(result).admission, { ...(!from ? { status: 'completed' } : {}),
      memories: [], suppressedCount: 1, indexRevision });
    assert.equal(f.plan.seen.length, 0);
    assert.deepEqual(f.active(), []);
    assert.equal(ok(await f.send(receiver, 'synthetic-batch-3', [clean], 'synthetic-session', !from))
      .admission.memories.length, 1);
    assert.deepEqual(f.plan.seen.flat().map(message => message.content), [clean.content]);
    f.noRaw();
  });
}
