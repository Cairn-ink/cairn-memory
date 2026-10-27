import { memberFixture, namespace, ok, kinds, sorted } from './topic-members-fixture.mjs';
export function buildMemberWorld(t, count, options = {}) {
  const f = memberFixture(t, options);
  const spaces = [namespace, ...['project-a', 'project-b', 'project-c'].map(projectId => ({ ...namespace, scope: 'project', projectId }))];
  for (let i = 0; i < count; i++) f.admit('scale-' + i, kinds[i % 5], spaces[i % 4]);
  spaces.forEach((ns, index) => {
    const memories = f.ledger.filter(row => row.namespace === ns), roots = [], children = [];
    for (let i = 0; i < 15; i++) {
      const newRoot = i < (index === 3 ? 2 : 3);
      const result = f.place(ns, [{ memoryId: memories[i].id, parentIds: [], newL1: {
        title: `Topic ${i}`, parentL2Ids: newRoot ? [] : [roots[i % roots.length]], ...(newRoot ? { newL2Title: `Region ${i}` } : {}) } }]);
      children.push(result.createdMocs.find(node => node.level === 'L1').id);
      const root = result.createdMocs.find(node => node.level === 'L2'); if (root) roots.push(root.id);
    }
    // Shared L1 children, linked through the public mutation port.
    const childId = children[0], parentId = roots[1];
    const linked = ok(f.core.linkMocs({ namespace: ns, expectedIndexRevision: f.epoch(ns),
      parentId, expectedParentRevision: f.mocs.get(parentId).revision,
      childId, expectedChildRevision: f.mocs.get(childId).revision }));
    f.edges.get(parentId).add(childId);
    f.mocs.get(parentId).revision = linked.ref.parentRevision;
    f.mocs.get(childId).revision = linked.ref.childRevision;
    // Link increments the parent revision; place reads the current epoch below.
    for (let start = 15; start < memories.length; start += 5) {
      const batch = memories.slice(start, start + 5).filter((row, i) => (start + i) % 9 !== 0);
      if (!batch.length) continue;
      // Keep the fixture's public ledger epoch synchronized with the link result.
      if (start === 15) f.setEpoch(ns, linked.indexRevision);
      f.place(ns, batch.map((row, i) => ({ memoryId: row.id,
        parentIds: [children[(start + i) % 15], children[(start + i + 4) % 15]] })));
    }
  });
  return { f, spaces };
}
export function ledgerMembers(f, ns, selection) {
  const children = selection.type === 'unfiled' ? null : selection.level === 'L1' ? new Set([selection.mocId]) : f.edges.get(selection.mocId);
  return sorted(f.ledger.filter(row => row.namespace === ns).flatMap(row => {
    const matches = row.parents.filter(id => children?.has(id)).sort();
    if (children ? !matches.length : row.parents.length) return [];
    const parent = matches.length ? f.mocs.get(matches[0]) : null;
    return [{ type: 'memory', namespace: ns, id: row.id, revision: row.revision, kind: row.kind,
      label: { text: row.id, source: 'identifier' }, reportedUnder: parent ? { type: 'l1', mocId: parent.id, revision: parent.revision } : null }];
  }));
}
