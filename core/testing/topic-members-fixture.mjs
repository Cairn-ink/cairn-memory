import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore, openMemoryReader } from '../index.mjs';
import { STORAGE_BUSY_TIMEOUT_MS } from '../database.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

export const kinds = ['fact', 'preference', 'decision', 'instruction', 'context'];
export const namespace = { ownerId: 'member-owner', scope: 'personal', projectId: null };
export const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
export const sorted = items => [...items].sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)));
export const expected = node => ({ type: 'moc', mocId: node.id, revision: node.revision, level: node.level });
export async function collectMembers(reader, input, observe = () => {}) {
  const items = [], pages = []; let cursor;
  for (let i = 0; i < 100000; i++) {
    const page = ok(await reader.readTopicMembers({ ...input, ...(cursor ? { cursor } : {}) }));
    assert.deepEqual(Object.keys(page).sort(), ['version','status','namespace','selection','snapshot','kind','order','items','coverage','nextCursor'].sort());
    assert.deepEqual(page.namespace, input.namespace);
    assert.deepEqual(page.selection, input.selection);
    assert.equal(page.version, 'topic-members-v1');
    if (input.expectedSnapshot) assert.deepEqual(page.snapshot, { ...input.expectedSnapshot,
      accessRevision: input.accessRevision, configuration: 'topic-members-v1' });
    for (const row of page.items) {
      assert.deepEqual(Object.keys(row).sort(), ['type','namespace','id','revision','kind','label','reportedUnder'].sort());
      assert.equal(row.type,'memory'); assert.deepEqual(row.namespace,page.namespace);
      assert.deepEqual(row.label,{text:row.id,source:'identifier'});
    }
    observe(page); items.push(...page.items); pages.push(page);
    if (!page.nextCursor) { assert.equal(page.coverage.complete, true); return { items, pages }; }
    cursor = page.nextCursor;
  }
  assert.fail('no finite progress');
}
export async function overview(reader, ns = namespace, extra = {}) {
  const items = []; let cursor, page, snapshot;
  do {
    page = ok(await reader.readTopicOverview({ namespace: ns, snapshotVersion: 'topic-snapshot-v1', ...extra, ...(cursor ? { cursor } : {}) }));
    snapshot ??= page.snapshot; assert.deepEqual(page.snapshot, snapshot);
    items.push(...page.items); cursor = page.nextCursor;
  } while (cursor);
  return { items, snapshot, totals: page.totals };
}
export function memberFixture(t, { mode = 'DELETE', coreOptions = {} } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-topic-members-' });
  const path = join(workspace.path, 'memory.sqlite'), core = openMemoryCore({ path, ...coreOptions });
  workspace.defer(() => core.close());
  const db = new DatabaseSync(path); db.exec(`PRAGMA busy_timeout=${STORAGE_BUSY_TIMEOUT_MS}; PRAGMA journal_mode=${mode}`);
  let dbClosed = false;
  const closeDb = () => { if (!dbClosed) { db.close(); dbClosed = true; } };
  workspace.defer(closeDb);
  const ledger = [], mocs = new Map(), edges = new Map(), epochs = new Map();
  const key = ns => JSON.stringify(ns);
  const admit = (name, kind = 'fact', ns = namespace) => {
    const content = 'MEMBER_BODY_SENTINEL ' + name;
    const saved = ok(core.admit({ namespace: ns, memory: { content, kind }, receipts: [{
      client: 'member-fixture', sessionId: 'fixture', eventId: name, role: 'user', excerpt: content }] }));
    epochs.set(key(ns), saved.indexRevision);
    const row = { ...ok(core.get({ namespace: ns, memoryId: saved.memory.id })).memory, namespace: ns, parents: [] }; ledger.push(row); return row;
  };
  const memory = row => ok(core.get({ namespace: row.namespace, memoryId: row.id })).memory;
  const place = (ns, items) => {
    const result = ok(core.applyPlacement({ namespace: ns, expectedIndexRevision: epochs.get(key(ns)),
      expectedMemoryRevisions: items.map(item => ({ memoryId: item.memoryId,
        revision: memory(ledger.find(row => row.id === item.memoryId)).revision })), proposal: { items } }));
    epochs.set(key(ns), result.indexRevision);
    for (const node of result.createdMocs) {
      mocs.set(node.id, { ...node, namespace: ns });
      if (node.level === 'L2') edges.set(node.id, new Set());
    }
    // refs contains the resulting placements, not removed parents or every
    // title-source MOC invalidated by a filing revision. Refresh the metadata
    // ledger through SQLite before deriving selections and expected attribution.
    for (const node of db.prepare('SELECT id,revision FROM mocs').all()) {
      if (mocs.has(node.id)) mocs.get(node.id).revision = node.revision;
    }
    for (const row of result.memories) {
      const stored = ledger.find(item => item.id === row.id); Object.assign(stored, row, { namespace: ns });
    }
    items.forEach(item => {
      const row = ledger.find(r => r.id === item.memoryId);
      const created = result.createdMocs.filter(node => node.level === 'L1');
      row.parents = [...item.parentIds, ...(item.newL1 ? [created.shift()?.id] : [])];
      // Creation fixtures use one new L1 per mutation.
      if (item.newL1) {
        const child = row.parents.at(-1);
        for (const parent of item.newL1.parentL2Ids) edges.get(parent).add(child);
        const root = result.createdMocs.find(node => node.level === 'L2');
        if (root) edges.get(root.id).add(child);
      }
    });
    return result;
  };
  const reader = (ns = namespace, location = path) => {
    const value = openMemoryReader({ path: location, ownerId: ns.ownerId }); workspace.defer(() => value.close()); return value;
  };
  const epoch = ns => epochs.get(key(ns));
  return { workspace, path, core, db, closeDb, ledger, mocs, edges, admit, memory, place, reader, epoch, setEpoch: (ns, value) => epochs.set(key(ns), value) };
}
export function smallHierarchy(f, ns = namespace) {
  const a = f.admit('a', 'fact', ns), b = f.admit('b', 'decision', ns), c = f.admit('c', 'context', ns), u = f.admit('u', 'preference', ns);
  const first = f.place(ns, [{ memoryId: a.id, parentIds: [], newL1: { title: 'Topic a', parentL2Ids: [], newL2Title: 'Root' } }]);
  const root = first.createdMocs.find(n => n.level === 'L2'), l1 = first.createdMocs.find(n => n.level === 'L1');
  const l2 = f.place(ns, [{ memoryId: b.id, parentIds: [], newL1: { title: 'Topic b', parentL2Ids: [root.id] } }]).createdMocs[0];
  f.place(ns, [{ memoryId: c.id, parentIds: [l1.id, l2.id] }]);
  return { a, b, c, u, root, l1, l2 };
}
