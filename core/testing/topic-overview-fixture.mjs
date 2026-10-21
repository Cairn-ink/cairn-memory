import assert from 'node:assert/strict';
import { join } from 'node:path';
import { openMemoryCore } from '../contract.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

export const overviewNamespace = { ownerId: 'overview-owner', scope: 'personal', projectId: null };
export const unwrapOverview = result => {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
};
export function topicOverviewFixture(t) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-topic-overview-' });
  const path = join(workspace.path, 'memory.sqlite');
  const core = openMemoryCore({ path });
  workspace.defer(() => core.close());
  let epoch;
  const admit = (name, kind = 'fact', namespace = overviewNamespace) => {
    const content = `PRIVATE_BODY_SENTINEL synthetic ${name}`;
    const saved = unwrapOverview(core.admit({ namespace, memory: { content, kind }, receipts: [{
      client: 'synthetic-overview', sessionId: 'fixture', eventId: name, role: 'user', excerpt: content,
    }] }));
    epoch = saved.indexRevision;
    return saved.memory;
  };
  const a = admit('a'), b = admit('b', 'decision'), c = admit('c'), unfiled = admit('unfiled', 'preference');
  const place = items => {
    const result = unwrapOverview(core.applyPlacement({ namespace: overviewNamespace,
      expectedIndexRevision: epoch,
      expectedMemoryRevisions: items.map(item => ({ memoryId: item.memoryId,
        revision: unwrapOverview(core.get({ namespace: overviewNamespace, memoryId: item.memoryId })).memory.revision })),
      proposal: { items } }));
    epoch = result.indexRevision;
    return result;
  };
  const created = place([{ memoryId: a.id, parentIds: [], newL1: {
    title: 'Topic A', parentL2Ids: [], newL2Title: 'Root',
  } }]).createdMocs;
  const root = created.find(moc => moc.level === 'L2'), topicA = created.find(moc => moc.level === 'L1');
  const topicB = place([{ memoryId: b.id, parentIds: [], newL1: {
    title: 'Topic B', parentL2Ids: [root.id],
  } }]).createdMocs[0];
  place([{ memoryId: c.id, parentIds: [topicA.id, topicB.id] }]);
  return { workspace, path, core, a, b, c, unfiled, root, topicA, topicB, admit, place };
}

export async function collectOverview(reader, input) {
  const pages = [], items = [];
  let cursor;
  for (let attempt = 0; attempt < 1000; attempt++) {
    const page = unwrapOverview(await reader.readTopicOverview({ ...input, ...(cursor ? { cursor } : {}) }));
    pages.push(page); items.push(...page.items);
    if (!page.nextCursor) return { items, pages, totals: page.totals };
    cursor = page.nextCursor;
  }
  assert.fail('overview continuation did not finish within fixture bound');
}
