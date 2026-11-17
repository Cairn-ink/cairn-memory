import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { openMemoryCore, openMemoryReader } from '../index.mjs';
import { eventTimeSafetyFixture } from '../testing/receipt-event-time-fixture.mjs';
import { collectOverview, installOverviewLayout, namespace, ok } from '../testing/topic-overview-raw29-fixture.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const control = [['Control fixtures', 25], ['Control validation', 25]];
const large = [['Build queues', 334], ['Build workers', 333], ['Build artifacts', 333]];

async function installed29(t) {
  const workspace = createTestWorkspace(t, { prefix: 'large-overview-29-' });
  const path = join(workspace.path, 'store.sqlite');
  installOverviewLayout(path, 29);
  return { workspace, path };
}

async function safety53(t) {
  const fixture = eventTimeSafetyFixture(t, 33);
  const migration = await fixture.migrate();
  assert.equal(migration.physical, 53);
  assert.equal(migration.suppressionRevision, 1);
  assert.equal(migration.cardLineageRevision, 0);
  return fixture;
}

function buildRegion(core, title, children) {
  const client = 'synthetic-overview';
  let ordinal = 0;
  function place(count, placement) {
    const batchId = `${title}-batch-${ordinal}`;
    const items = Array.from({ length: count }, () => {
      const eventId = 'member-' + ++ordinal;
      const content = `Synthetic ${title} ${eventId}`;
      return { content, kind: 'fact', confidence: 0.9,
        receipts: [{ client, sessionId: title, eventId, role: 'user', excerpt: content }] };
    });
    const key = { namespace, client, eventId: batchId,
      payloadDigest: createHash('sha256').update(JSON.stringify(items)).digest('hex') };
    const { token } = ok(core.claimAdmission({ ...key, leaseMs: 120000 }));
    const admitted = ok(core.finishAdmission({ ...key, token, items }));
    assert.equal(admitted.memories.length, count);
    return ok(core.applyPlacement({ namespace, expectedIndexRevision: admitted.indexRevision,
      expectedMemoryRevisions: admitted.memories.map(({ id, revision }) => ({ memoryId: id, revision })),
      proposal: { items: admitted.memories.map(({ id }, index) => ({ memoryId: id, ...placement(index) })) },
    }));
  }

  // One seed per L1 supplies its title source. The seeds share the new L2.
  const { createdMocs } = place(children.length, index => ({
    parentIds: [], newL1: { title: children[index][0], parentL2Ids: [], newL2Title: title },
  }));
  const root = createdMocs.find(moc => moc.level === 'L2');
  const topics = children.map(([childTitle, count]) => {
    const child = createdMocs.find(moc => moc.level === 'L1' && moc.title === childTitle);
    assert.equal(child.titleSources.length, 1);
    let revision = child.revision;
    // Admission and placement each accept up to five Memories per batch.
    for (let offset = 1; offset < count; offset += 5) {
      const { refs } = place(Math.min(5, count - offset), () => ({ parentIds: [child.id] }));
      revision = refs[0].parentRevision;
    }
    return { id: child.id, revision, level: 'L1', title: childTitle,
      parentIds: [root.id], count };
  });
  return [{ id: root.id, revision: root.revision, level: 'L2', title, parentIds: [],
    count: children.reduce((sum, [, count]) => sum + count, 0) }, ...topics];
}

const identity = ({ id, revision }) => `${id}@${revision}`;

function assertOverview({ items, pages, totals }, expected, memberCount) {
  assert.equal(pages.at(-1).nextCursor, null);
  assert.deepEqual(pages.at(-1).coverage, { complete: true, countsComplete: true, reason: null });
  assert.equal(totals.unique.total, memberCount);
  assert.equal(totals.unfiled.total, 0);

  const merged = new Map();
  for (const { id, revision, level, title, parentIds, descendantCounts } of items) {
    const item = { id, revision, level, title, parentIds, count: descendantCounts.total };
    const key = identity(item);
    if (merged.has(key)) assert.deepEqual(merged.get(key), item);
    merged.set(key, item);
  }
  assert.deepEqual(merged, new Map(expected.map(item => [identity(item), item])));
}

for (const [layout, fixture] of [[29, installed29], [53, safety53]]) {
  test(`layout ${layout} returns exact L1 titles after large topic overview continuations`, async t => {
    const started = performance.now();
    const { workspace, path } = await fixture(t);
    const core = openMemoryCore({ path });
    workspace.defer(() => core.close());
    const reader = openMemoryReader({ path, ownerId: namespace.ownerId });
    workspace.defer(() => reader.close());

    const expectedControl = buildRegion(core, 'Control region', control);
    const controlBuilt = performance.now();
    const controlOverview = await collectOverview(reader, { namespace });
    assert.equal(controlOverview.pages.length, 1);
    assertOverview(controlOverview, expectedControl, 50);
    const controlRead = performance.now();

    // 1,050 singly filed Memories exceed the default 5,000 work units even
    // before counting topic and title-source rows.
    const expected = [...expectedControl, ...buildRegion(core, 'Build region', large)];
    const built = performance.now();
    const overview = await collectOverview(reader, { namespace });
    const [first] = overview.pages;
    assert.deepEqual(first.items, []);
    assert.deepEqual(first.coverage, { complete: false, countsComplete: false, reason: 'work_limit' });
    assert.ok(first.nextCursor);
    assertOverview(overview, expected, 1050);

    const paged = await collectOverview(reader, { namespace, nodeLimit: 1 });
    const firstNodePage = paged.pages.find(page => page.items.length > 0);
    assert.deepEqual(firstNodePage?.items.map(node => node.level), ['L2']);
    assert.equal(firstNodePage.coverage.reason, 'node_limit');
    assert.ok(firstNodePage.nextCursor);
    assertOverview(paged, expected, 1050);

    const finished = performance.now();
    const buildMs = controlBuilt - started + built - controlRead;
    const readMs = controlRead - controlBuilt + finished - built;
    t.diagnostic(`layout ${layout}: build ${buildMs.toFixed(1)} ms, overview checks ${readMs.toFixed(1)} ms`);
  });
}
