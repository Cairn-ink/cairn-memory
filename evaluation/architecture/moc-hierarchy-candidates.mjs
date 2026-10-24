import { readFileSync } from 'node:fs';
import { callModel } from '../../core/model-call.mjs';
import { boundedText, denseArray, fail, identifier, object, revision } from '../../core/validation.mjs';

const l2Prompt = readFileSync(new URL('./prompts/moc-route-l2.md', import.meta.url), 'utf8');
const l1Prompt = readFileSync(new URL('./prompts/moc-route-l1.md', import.meta.url), 'utf8');
const key = ref => JSON.stringify([ref.namespaceIndex, ref.mocId ?? ref.memoryId, ref.revision]);
const flags = { finalRetrieval: false, fallbackRequired: true,
  snapshotGuarantee: 'per-call-not-atomic', semanticCoverage: 'unassessed' };

function namespaces(input) {
  try {
    denseArray(input, 1, 2);
    const result = input.map(value => {
      object(value, ['ownerId', 'scope', 'projectId']);
      const ownerId = identifier(value.ownerId);
      if (value.scope === 'personal' && value.projectId === null) return { ownerId, scope: 'personal', projectId: null };
      if (value.scope === 'project') return { ownerId, scope: 'project', projectId: identifier(value.projectId) };
      fail('invalid_read_set');
    });
    if (result.length === 2 && (result[0].ownerId !== result[1].ownerId || result[0].scope === result[1].scope)) {
      fail('invalid_read_set');
    }
    return result;
  } catch { fail('invalid_read_set'); }
}

function select(output, visible, maximum, perNamespace) {
  try {
    object(output, ['refs']);
    denseArray(output.refs, 0, maximum);
    const seen = new Set();
    const counts = new Map();
    return output.refs.map(value => {
      object(value, ['namespaceIndex', 'mocId', 'revision']);
      if (!Number.isSafeInteger(value.namespaceIndex) || value.namespaceIndex < 0) fail('invalid_model_output');
      const ref = { namespaceIndex: value.namespaceIndex, mocId: identifier(value.mocId), revision: revision(value.revision) };
      const identity = key(ref);
      const count = (counts.get(ref.namespaceIndex) ?? 0) + 1;
      if (!visible.has(identity) || seen.has(identity) || count > perNamespace) fail('invalid_model_output');
      counts.set(ref.namespaceIndex, count);
      seen.add(identity);
      return ref;
    });
  } catch { fail('invalid_model_output'); }
}

/** Evaluation-only two-hop navigation. This does not fetch, rank or finalize. */
export async function generateMocCandidates({ core, readSet, query, groupModel }) {
  const audit = { maps: [], models: [], selectedL2: [], selectedL1: [],
    resources: { mapCalls: 0, modelCalls: 0, returnedRows: 0 }, partialPages: [] };
  try {
    const ordered = namespaces(readSet);
    const cleanQuery = boundedText(query, 4000);
    if (typeof core?.map !== 'function') fail('invalid_input');
    const epochs = new Map();
    const observedRevisions = new Map();
    const observeRef = (namespaceIndex, id, value) => {
      identifier(id); revision(value);
      const identity = JSON.stringify([namespaceIndex, id]);
      if (observedRevisions.has(identity) && observedRevisions.get(identity) !== value) fail('revision_conflict');
      observedRevisions.set(identity, value);
    };
    const page = async (namespaceIndex, stage, limit, parentRef, cursor) => {
      const request = { namespace: { ...ordered[namespaceIndex] }, purpose: 'recall', limit, tokenBudget: 4000,
        ...(parentRef ? { parentRef: { mocId: parentRef.mocId, revision: parentRef.revision } } : {}),
        ...(cursor === undefined ? {} : { cursor }) };
      if (++audit.resources.mapCalls > 14) fail('invalid_input');
      const result = await core.map(request);
      audit.maps.push({ namespaceIndex, stage, request: structuredClone(request), result: structuredClone(result) });
      if (!result.ok) fail(result.error.code);
      const value = result.value;
      denseArray(value.items, 0, limit);
      denseArray(value.invalidRefs, 0, limit);
      const rows = value.items.length + value.invalidRefs.length;
      if (rows > limit) fail('invalid_ref');
      audit.resources.returnedRows += rows;
      revision(value.indexRevision);
      if (epochs.has(namespaceIndex) && epochs.get(namespaceIndex) !== value.indexRevision) fail('index_revision_conflict');
      epochs.set(namespaceIndex, value.indexRevision);
      if (value.invalidRefs.length) fail('invalid_ref');
      if (!value.exhausted || value.nextCursor !== null || value.truncatedBy !== null) {
        audit.partialPages.push({ namespaceIndex, stage, mapIndex: audit.maps.length - 1,
          nextCursor: value.nextCursor, truncatedBy: value.truncatedBy });
      }
      return value;
    };
    const pages = async (namespaceIndex, stage, limit, maximum, parentRef) => {
      const items = [];
      let previous;
      for (let round = 0; round < maximum; round++) {
        previous = await page(namespaceIndex, stage, limit, parentRef, previous?.nextCursor ?? undefined);
        items.push(...previous.items);
        if (previous.exhausted || previous.nextCursor === null) break;
      }
      return items;
    };
    const addGroup = (groups, namespaceIndex, moc, level) => {
      if (moc.level !== level) return;
      observeRef(namespaceIndex, moc.id, moc.revision);
      const ref = { namespaceIndex, mocId: moc.id, revision: moc.revision };
      groups.set(key(ref), { ...ref, title: moc.title });
    };
    const decide = async (stage, groups, maximum, perNamespace, system) => {
      if (!groups.size) return [];
      const input = { query: cleanQuery, maps: ordered.map((_, namespaceIndex) => ({ namespaceIndex,
        groups: [...groups.values()].filter(ref => ref.namespaceIndex === namespaceIndex) })),
      maxRefs: maximum, maxRefsPerNamespace: perNamespace };
      const record = { stage, input: structuredClone(input), system };
      audit.models.push(record);
      audit.resources.modelCalls++;
      const output = await callModel(groupModel, 'select', system, input);
      record.output = structuredClone(output);
      return select(output, groups, maximum, perNamespace);
    };
    const l2 = new Map();
    for (let namespaceIndex = 0; namespaceIndex < ordered.length; namespaceIndex++) {
      for (const item of await pages(namespaceIndex, 'root', 100, 2)) {
        if (item.type === 'moc') addGroup(l2, namespaceIndex, item.moc, 'L2');
      }
    }
    audit.selectedL2 = await decide('L2', l2, 2, 2, l2Prompt);
    const l1 = new Map();
    const l1Paths = new Map();
    for (const parent of audit.selectedL2) {
      const items = await pages(parent.namespaceIndex, 'children', 50, 2, parent);
      const children = new Map();
      for (const item of items) if (item.type === 'moc') addGroup(children, parent.namespaceIndex, item.moc, 'L1');
      for (const item of items) {
        if (item.type !== 'ref' || item.ref.childType !== 'moc') continue;
        const edge = item.ref;
        if (edge.relation !== 'contains' || edge.parentId !== parent.mocId || edge.parentRevision !== parent.revision) fail('invalid_ref');
        observeRef(parent.namespaceIndex, edge.childId, edge.childRevision);
        const ref = { namespaceIndex: parent.namespaceIndex, mocId: edge.childId, revision: edge.childRevision };
        const child = children.get(key(ref));
        if (!child) continue; // A header or edge outside the fixed pages is not a joined group.
        l1.set(key(ref), child);
        const paths = l1Paths.get(key(ref)) ?? [];
        if (!paths.some(path => key(path.l2) === key(parent))) paths.push({ l2: { ...parent }, edge: { ...edge } });
        l1Paths.set(key(ref), paths);
      }
    }
    audit.selectedL1 = await decide('L1', l1, 4, 2, l1Prompt);
    const candidates = new Map();
    for (const parent of audit.selectedL1) {
      for (const item of await pages(parent.namespaceIndex, 'leaves', 6, 1, parent)) {
        if (item.type !== 'ref' || item.ref.childType !== 'memory') continue;
        const edge = item.ref;
        if (edge.relation !== 'contains' || edge.parentId !== parent.mocId || edge.parentRevision !== parent.revision) fail('invalid_ref');
        observeRef(parent.namespaceIndex, edge.childId, edge.childRevision);
        const ref = { namespaceIndex: parent.namespaceIndex, memoryId: edge.childId, revision: edge.childRevision };
        const candidate = candidates.get(key(ref)) ?? { ...ref, paths: [] };
        for (const path of l1Paths.get(key(parent))) candidate.paths.push({ l2: { ...path.l2 },
          l2ToL1: { ...path.edge }, l1: { ...parent }, l1ToMemory: { ...edge } });
        candidates.set(key(ref), candidate);
      }
    }
    // One bounded final observation per namespace catches drift without claiming
    // the private runtime.recallSnapshot atomic guarantee.
    for (let index = 0; index < ordered.length; index++) await page(index, 'final-root', 100);
    return { ...flags, readSet: ordered, candidates: [...candidates.values()], audit,
      namespaces: ordered.map((namespace, namespaceIndex) => ({ namespace, namespaceIndex,
        indexRevision: epochs.get(namespaceIndex) })),
      coverage: 'incomplete', unvisitedEvidence: ['orphan-L1', 'unfiled', 'cross-topic', 'unvisited-groups'],
      notObservedMeansAbsent: false };
  } catch (error) {
    // Failed observations remain inspectable, but never expose a success set.
    error.audit = audit;
    throw error;
  }
}
