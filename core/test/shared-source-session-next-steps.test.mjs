import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { openMemoryCore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { transaction } from '../database.mjs';
import { receiptDenialTokens } from '../content-safety.mjs';
import { assembleSessionContext, contextInput, contextQuery } from '../session-context.mjs';
import { lineageFixture, lineageHost, ns, ok } from '../testing/card-lineage-fixture.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { trace } from '../testing/shared-source-fixture.mjs';

const source = readFileSync(new URL('../session-context.mjs', import.meta.url), 'utf8');
const pageSize = Number(source.match(/const NEXT_STEP_PAGE_SIZE = (\d+);/)[1]);
const maxPasses = Number(source.match(/const NEXT_STEP_MAX_PASSES = (\d+);/)[1]);
const scanLimit = pageSize * maxPasses;
const groups = { nextSteps: true, procedural: false };
const config = { groups, maxTokens: 2000, maxChars: 8000 };
const counter = { countTokens: () => 1 };
const sha = value => createHash('sha256').update(value).digest('hex');
const time = '2026-01-01T00:00:00.000Z';

async function fixture(t, layout = 53) {
  let f;
  if (layout === 53) f = await lineageFixture(t, { base: 33, options: { model: counter } });
  else {
    f = safetyFixture(t, 33);
    await f.migrate();
    f.db = f.connect();
    f.core = openMemoryCore({ path: f.path, privateCards: lineageHost().options, model: counter });
    t.after(() => { f.core.close(); f.db.close(); });
  }
  f.runtime = createMemoryRuntime({ path: f.path });
  t.after(() => f.runtime.close());
  return f;
}

// These read fixtures insert a deterministic ready record and one ordinary
// source per Episode. They need no capture scheduler, writer leases or model.
// All delivered ids, ordinals, timestamps and texts are fixed across trees.
function seed(f, count) {
  const episodes = [];
  transaction(f.db, () => {
    f.db.prepare('INSERT INTO namespace_epochs VALUES(?,?,?,1)').run(ns.ownerId, ns.scope, ns.projectId);
    f.db.prepare(`INSERT INTO memories(id,owner_id,scope,project_id,fingerprint,content,kind,origin,
      confidence,revision,created_at,updated_at,review_state)
      VALUES('synthetic-review-memory',?,?,?,?,'Synthetic review claim','decision','agent-inferred',1,1,?,?,'awaiting')`)
      .run(ns.ownerId, ns.scope, ns.projectId, sha('Synthetic review claim'), time, time);
    const review = { client: 'synthetic', sessionId: 'synthetic-review', eventId: 'synthetic-review-message',
      role: 'user', excerpt: 'Synthetic review support' };
    f.db.prepare(`INSERT INTO receipts(id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
      VALUES('synthetic-review-receipt','synthetic-review-memory',?,?,?,?,?,?,?)`)
      .run(sha(JSON.stringify(review)), review.client, review.sessionId, review.eventId, review.role, review.excerpt, time);
    if (f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='raw_receipt_origins'").get())
      f.db.prepare("INSERT INTO raw_receipt_origins VALUES('synthetic-review-receipt','independent')").run();
    for (let index = 0; index < count; index++) {
      const suffix = String(index).padStart(3, '0'), id = 'synthetic-step-episode-' + suffix;
      const sourceId = 'synthetic-step-source-' + suffix, text = 'Synthetic step support ' + suffix;
      const anchor = { sourceId, digest: sha(text), start: 0, end: text.length };
      const nextStep = { id: 'synthetic-step-' + suffix, text: 'Synthetic next action ' + suffix,
        status: 'open', anchors: [anchor], receiptOrdinal: count - index };
      const record = { clientLabel: 'Synthetic', eventStart: time, eventEnd: time, eventTimeCoverage: 'complete',
        interpretedAt: time, type: 'work', language: 'en', gist: 'Synthetic activity ' + suffix, outcome: null,
        nextStep, anchors: { type: [anchor], gist: [anchor], nextStep: [anchor] }, modelMetadata: null,
        semanticSupport: 'unassessed', editor: {},
        processing: { state: 'ready', missing: 0, expired: 0, omitted: 0, errorCode: null } };
      const session = 's1:' + sha(id);
      f.db.prepare(`INSERT INTO session_episodes(id,owner_id,scope,project_id,client,session_key,revision,
        generation,draft_every,observed,attempted,covered,first_received_at,last_received_at,updated_at,record)
        VALUES(?,?,?,?,'synthetic',?,1,'initial',2,1,1,1,?,?,?,?)`)
        .run(id, ns.ownerId, ns.scope, ns.projectId, session, time, time, time, JSON.stringify(record));
      f.db.prepare('INSERT INTO episode_sources VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(sourceId, id, id, 'synthetic-event-' + suffix, 'synthetic-message-' + suffix,
          anchor.digest, 'user', text, 0, nextStep.receiptOrdinal);
      const receipt = { client: 'synthetic', sessionId: session, eventId: 'synthetic-message-' + suffix,
        role: 'user', excerpt: text };
      episodes.push({ id, receipt, item: { episodeId: id, revision: 1, client: 'synthetic', nextStep,
        semanticSupport: 'unassessed', sources: [{ id: sourceId, digest: anchor.digest, role: 'user', text, truncated: false }] } });
    }
  });
  return episodes;
}
function hide(f, episodes) {
  for (const { id } of episodes) f.db.prepare('INSERT INTO episode_memory_links VALUES(?,?,?,?,?,?)')
    .run('synthetic-review-link-' + id, id, 'synthetic-review-memory', 'synthetic-review-event', 1,
      JSON.stringify(['synthetic-review-receipt']));
}
function withhold(f, episodes) {
  for (const { receipt } of episodes) for (const token of receiptDenialTokens([{
    receipt_key: sha(JSON.stringify(receipt)), client: receipt.client, session_id: receipt.sessionId,
    event_id: receipt.eventId, role: receipt.role,
  }])) f.db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(ns.ownerId, ns.scope, ns.projectId, token);
}
function candidatePasses(rows, passes, scans) {
  const candidates = rows.filter(row => row.sql.startsWith('SELECT e.* FROM session_episodes e INDEXED BY episode_open_step_read'));
  const snapshots = new Map();
  for (const row of candidates) {
    assert.ok(row.snapshot, 'each candidate pass belongs to a storage transaction');
    snapshots.set(row.snapshot, (snapshots.get(row.snapshot) ?? 0) + 1);
  }
  assert.equal(snapshots.size, scans);
  for (const count of snapshots.values()) assert.equal(count, passes);
  assert.ok([...snapshots.values()].every(count => count <= maxPasses));
}
function expectedGroup(items, exhausted = false) {
  return { enabled: true, returned: items.length, complete: !exhausted, budget_exhausted: exhausted,
    status: exhausted ? 'budget_exhausted' : 'complete', items };
}
function physical(f, after) {
  const query = contextQuery(ns, 'nextSteps', { after });
  return f.db.prepare(query.sql).all(...query.params).map(row => row.id);
}

for (const layout of [48, 53]) for (const hidden of [13, 30])
test(`review-hidden next steps are excluded before the page limit, layout ${layout}, count ${hidden}`, { timeout: 45000 }, async t => {
  const f = await fixture(t, layout), episodes = seed(f, hidden + 2);
  hide(f, episodes.slice(0, hidden));
  assert.equal(f.db.prepare('SELECT count(*) n FROM suppressed').get().n, 0, 'zero forgets or markers');
  const survivors = episodes.slice(hidden);
  assert.deepEqual(physical(f), survivors.map(episode => episode.id));
  // Two call shapes share the same one-step eligibility rule.
  for (const input of [{}, config]) {
    const measured = await trace(() => f.core.sessionStartContext({ namespace: ns, ...input }));
    const group = ok(measured.result).groups.nextSteps;
    assert.deepEqual(group, expectedGroup([survivors[0].item]));
    assert.equal(JSON.stringify(group), JSON.stringify(expectedGroup([survivors[0].item])), 'deterministic group bytes');
    candidatePasses(measured.rows, 1, 2); // Preparation and authoritative reread.
  }
});

test('candidate hidden ancestry matches the view through origins and cycles', { timeout: 45000 }, async t => {
  const f = await fixture(t), episodes = seed(f, 6);
  hide(f, [episodes[3]]);
  const origin = (child, parent) => f.db.prepare('UPDATE episode_sources SET origin_episode_id=? WHERE episode_id=?')
    .run(episodes[parent].id, episodes[child].id);
  origin(0, 1); origin(1, 3); origin(3, 0); // A hidden cycle and its transitive consumer.
  origin(2, 4); origin(4, 2); // A visible cycle must terminate too.
  const expected = [episodes[2].id, episodes[4].id, episodes[5].id];
  const fromView = f.db.prepare(`SELECT e.id FROM session_episodes e WHERE e.owner_id=? AND e.scope=? AND e.project_id=?
    AND e.id NOT IN (SELECT id FROM review_hidden_episodes)
    ORDER BY json_extract(e.record,'$.nextStep.receiptOrdinal') DESC,e.id`).all(ns.ownerId, ns.scope, ns.projectId).map(row => row.id);
  assert.deepEqual(fromView, expected);
  assert.deepEqual(physical(f), expected);
  assert.deepEqual(physical(f, { ordinal: episodes.length, id: episodes[0].id }), expected);
  // Match the view even for retained ancestry whose namespace or Episode
  // deletion metadata differs; neither is part of its awaiting-link rule.
  f.db.prepare("UPDATE session_episodes SET owner_id='synthetic-other-owner',deleted=1 WHERE id=?").run(episodes[3].id);
  assert.deepEqual(physical(f), expected);
  // The view's review rule does not hide a deleted awaiting Memory.
  f.db.prepare("UPDATE memories SET deleted=1,content=NULL WHERE id='synthetic-review-memory'").run();
  assert.deepEqual(physical(f), episodes.filter((_, index) => index !== 3).map(episode => episode.id));
});

for (const found of [0, 1, 12])
test(`withheld refill stops at its fixed cap and preserves ${found} found rows`, { timeout: 45000 }, async t => {
  assert.equal(pageSize, 13); assert.equal(maxPasses, 2);
  const f = await fixture(t), episodes = seed(f, scanLimit + 2);
  const retained = episodes.slice(0, found), denied = episodes.slice(found, scanLimit + 1);
  withhold(f, denied);
  const measured = await trace(() => f.core.sessionStartContext({ namespace: ns, ...config }));
  const group = ok(measured.result).groups.nextSteps;
  assert.deepEqual(group, expectedGroup(retained.slice(0, 1).map(episode => episode.item), true));
  assert.equal(group.returned, group.items.length);
  for (const { id, receipt } of denied) {
    assert.equal(JSON.stringify(group).includes(id), false);
    assert.equal(JSON.stringify(group).includes(receipt.excerpt), false);
  }
  candidatePasses(measured.rows, maxPasses, 2);
  // Internal storage retains its existing twelve-item shape and repeats the
  // same identities AND exhausted state when expected is supplied.
  const stored = await trace(() => f.runtime.sessionContextSnapshot(ns, groups));
  const snapshot = stored.result;
  candidatePasses(stored.rows, maxPasses, 1);
  assert.deepEqual(snapshot.groups.nextSteps.items, retained.slice(0, 12).map(episode => episode.item));
  assert.deepEqual(snapshot.groups.nextSteps.identities, retained.map(episode => ({ id: episode.id, revision: 1 })));
  assert.equal(snapshot.groups.nextSteps.budget_exhausted, true);
  const reread = await trace(() => f.runtime.sessionContextSnapshot(ns, groups, snapshot));
  assert.deepEqual(reread.result, snapshot);
  candidatePasses(reread.rows, maxPasses, 1);
  // Compare assembly with its uncapped treatment of exactly these found rows.
  // Completeness changes; item eligibility and envelope accounting do not.
  const sameRows = structuredClone(snapshot);
  delete sameRows.groups.nextSteps.budget_exhausted;
  const assemble = data => assembleSessionContext({ ns, config: contextInput(config), model: counter,
    runtime: { sessionContextSnapshot: () => data } }).groups.nextSteps;
  assert.deepEqual(assemble(snapshot).items, assemble(sameRows).items);
  assert.equal(assemble(snapshot).returned, Math.min(1, found));
});

test('a withheld run below the cap still returns the newest visible step completely', { timeout: 45000 }, async t => {
  const f = await fixture(t), episodes = seed(f, pageSize + 2);
  withhold(f, episodes.slice(0, pageSize));
  const measured = await trace(() => f.core.sessionStartContext({ namespace: ns, ...config }));
  assert.deepEqual(ok(measured.result).groups.nextSteps, expectedGroup([episodes[pageSize].item]));
  candidatePasses(measured.rows, 2, 2);
});

test('a full visible page keeps storage and public item ceilings with one pass', { timeout: 45000 }, async t => {
  const f = await fixture(t), episodes = seed(f, 15);
  const stored = await trace(() => f.runtime.sessionContextSnapshot(ns, groups));
  assert.deepEqual(stored.result.groups.nextSteps.items, episodes.slice(0, 12).map(episode => episode.item));
  assert.equal(stored.result.groups.nextSteps.identities.length, 13);
  assert.equal(Object.hasOwn(stored.result.groups.nextSteps, 'budget_exhausted'), false);
  candidatePasses(stored.rows, 1, 1);
  for (const input of [{}, config, { ...config, groups: { ...groups, background: true } }]) {
    const measured = await trace(() => f.core.sessionStartContext({ namespace: ns, ...input }));
    assert.deepEqual(ok(measured.result).groups.nextSteps, expectedGroup([episodes[0].item]));
    candidatePasses(measured.rows, 1, 2);
  }
});
