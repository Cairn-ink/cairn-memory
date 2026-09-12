import { mkdtempSync, lstatSync, realpathSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openMemoryCore } from '../../core/contract.mjs';
import { searchLexical } from './moc-lexical-baseline.mjs';

const unwrap = result => { if (!result.ok) throw new Error(result.error.code); return result.value; };
const namespace = Object.freeze({ ownerId: 'synthetic-moc-audit', scope: 'personal', projectId: null });
const ref = item => item.type === 'unfiled' ? item.ref : item.type === 'ref' && item.ref.childType === 'memory'
  ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
const fixtures = [
  { id: 'english-small', size: 16, placement: 'late', query: 'Who owns the Juniper migration?', targets: ['Mira owns the Juniper migration.'] },
  { id: 'unfiled-distractors', size: 16, placement: 'late', unfiledDistractors: true,
    query: 'Who owns the Juniper migration?', targets: ['Mira owns the Juniper migration.'] },
  { id: 'english-late', size: 224, placement: 'late', query: 'Who owns the Juniper migration?', targets: ['Mira owns the Juniper migration.'] },
  { id: 'english-misfiled', size: 224, placement: 'misfiled', query: 'Who owns the Juniper migration?', targets: ['Mira owns the Juniper migration.'] },
  { id: 'english-early', size: 224, placement: 'early', query: 'Who owns the Juniper migration?', targets: ['Mira owns the Juniper migration.'] },
  { id: 'unfiled-behind-filed', size: 224, placement: 'unfiled', query: 'Who owns the Juniper migration?', targets: ['Mira owns the Juniper migration.'] },
  { id: 'chinese-contiguous', size: 16, placement: 'late', query: '小林', targets: ['維護窗口由小林負責。'] },
  { id: 'chinese-spaced-control', size: 16, placement: 'late', query: '小林', targets: ['小林 負責 維護窗口。'] },
  { id: 'paraphrase-control', size: 16, placement: 'late', query: 'vehicle caretaker', targets: ['Mira maintains the automobile.'] },
  { id: 'multi-evidence-late', size: 224, placement: 'late', query: 'Juniper owner deadline',
    targets: ['Mira is the Juniper owner.', 'The Juniper deadline is Thursday.'] },
];

function admit(core, ns, content, eventId) {
  return unwrap(core.admit({ namespace: ns, memory: { content, kind: 'fact' },
    receipts: [{ client: 'moc-diagnostic', sessionId: 'synthetic', eventId, role: 'user', excerpt: content }] }));
}
function place(core, admitted, title, groups) {
  const id = groups.get(title);
  const result = unwrap(core.applyPlacement({ namespace, expectedIndexRevision: admitted.indexRevision,
    expectedMemoryRevisions: [{ memoryId: admitted.memory.id, revision: admitted.memory.revision }],
    proposal: { items: [{ memoryId: admitted.memory.id, parentIds: id ? [id] : [],
      ...(id ? {} : { newL1: { title, parentL2Ids: [] } }) }] } }));
  for (const moc of result.createdMocs) if (moc.level === 'L1') groups.set(title, moc.id);
}
function inventory(core) {
  const pages = [], ids = new Set();
  let cursor;
  do {
    const page = unwrap(core.map({ namespace, purpose: 'recall', ...(cursor ? { cursor } : {}) }));
    pages.push(page);
    for (const item of page.items) { const value = ref(item); if (value) ids.add(value.memoryId); }
    if (pages.length >= 32 && !page.exhausted) throw new Error('inventory_bound');
    cursor = page.nextCursor;
  } while (cursor);
  return { pages, ids: [...ids] };
}
function corpus(core) {
  const memories = [];
  let cursor;
  do {
    const page = unwrap(core.list({ namespace, states: ['active'], limit: 100, ...(cursor ? { cursor } : {}) }));
    for (const item of page.memories) {
      const detail = unwrap(core.get({ namespace, memoryId: item.id }));
      memories.push({ id: item.id, content: detail.memory.content });
    }
    cursor = page.nextCursor;
  } while (cursor);
  return memories;
}
function oracle(targetIds, observations) {
  return { contextWindow: 100000, countTokens: () => 1,
    select: ({ input }) => {
      const visible = input.maps.flatMap(map => map.items.map(item => {
        const value = ref(item); return value ? { namespaceIndex: map.namespaceIndex, ...value } : null;
      }).filter(Boolean));
      observations.push({ method: 'select', visibleIds: visible.map(item => item.memoryId),
        mapItemCount: input.maps.reduce((sum, map) => sum + map.items.length, 0), inputBytes: Buffer.byteLength(JSON.stringify(input)) });
      return { refs: visible.filter(item => targetIds.has(item.memoryId)) };
    },
    rank: ({ input }) => {
      observations.push({ method: 'rank', fetchedIds: input.candidates.map(item => item.memory.id), inputBytes: Buffer.byteLength(JSON.stringify(input)) });
      return { refs: input.candidates.filter(item => targetIds.has(item.memory.id))
        .map(item => ({ namespaceIndex: item.namespaceIndex, memoryId: item.memory.id, revision: item.memory.revision })) };
    } };
}

/** Explicit visibility oracle: knows targets, but can only select visible refs.
 * This tests an architectural upper bound, NOT model relevance or answer quality.
 */
export async function runMocRetrievalDiagnostic({ directory } = {}) {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || realpathSync(directory) !== directory || (stat.mode & 0o777) !== 0o700
    || readdirSync(directory).length) throw new Error('unsafe_diagnostic_directory');
  const report = { version: 'moc-architecture-diagnostic-v1', providerRequests: 0,
    counter: 'synthetic-constant-one; row-ceiling control, not provider token accounting',
    model: 'target-ID visibility oracle; NOT a semantic-quality model', outputLimit: 12,
    lexicalWork: 'full active corpus in temporary FTS5; not equal candidate work to bounded MOC', cases: [], classification: [] };
  for (const fixture of fixtures) {
    let core;
    const started = performance.now();
    const database = path.join(directory, `${fixture.id}.sqlite`);
    const ids = new Set(), observations = [], groups = new Map();
    const model = oracle(ids, observations);
    const entry = { ...fixture, status: 'failed' };
    report.cases.push(entry);
    try {
      core = openMemoryCore({ path: database, model });
      for (let index = 0; index < fixture.size - fixture.targets.length; index++) {
        const memory = admit(core, namespace, `Archive entry ${index} records calibration value ${index}.`, `d-${index}`);
        if (!fixture.unfiledDistractors) place(core, memory,
          fixture.placement === 'early' ? 'ZZZ archived notes' : 'AAA archived notes', groups);
      }
      for (const [index, content] of fixture.targets.entries()) {
        const memory = admit(core, namespace, content, `target-${index}`);
        ids.add(memory.memory.id);
        if (fixture.placement !== 'unfiled') place(core, memory, fixture.placement === 'early' ? 'AAA Juniper project'
          : fixture.placement === 'misfiled' ? 'ZZZ recipes' : 'ZZZ Juniper project', groups);
      }
      // An out-of-scope exact lexical hit must never enter either retrieval corpus.
      admit(core, { ...namespace, ownerId: 'synthetic-foreign' }, 'FOREIGN_SENTINEL Juniper owner deadline 小林', 'foreign');
      unwrap(core.close()); core = null;
      core = openMemoryCore({ path: database, model });
      const memories = corpus(core);
      const fullMap = inventory(core);
      entry.targetIds = [...ids];
      entry.coldDirectReadSupported = fixture.targets.every((content, index) =>
        unwrap(core.get({ namespace, memoryId: entry.targetIds[index] })).memory.content === content);
      entry.fullInventoryCount = fullMap.ids.length;
      entry.targetMapPages = entry.targetIds.map(id => fullMap.pages.findIndex(page => page.items.some(item => ref(item)?.memoryId === id)) + 1);
      entry.allTargetsInventoried = entry.targetIds.every(id => fullMap.ids.includes(id));
      const mocStarted = performance.now();
      entry.recall = await core.recall({ readSet: [namespace], query: fixture.query, limit: 12 });
      entry.mocElapsedMs = performance.now() - mocStarted;
      entry.observations = observations;
      const visible = new Set(observations.flatMap(item => item.visibleIds ?? []));
      entry.targetVisibleCount = entry.targetIds.filter(id => visible.has(id)).length;
      entry.targetRecalledCount = entry.targetIds.filter(id => entry.recall.ok && entry.recall.value.memories.some(item => item.memory.id === id)).length;
      const lexicalStarted = performance.now();
      entry.lexical = searchLexical({ memories, query: fixture.query, limit: 12 });
      entry.lexicalElapsedMs = performance.now() - lexicalStarted;
      entry.targetLexicalCount = entry.targetIds.filter(id => entry.lexical.ids.includes(id)).length;
      entry.namespaceIsolated = memories.length === fixture.size && !memories.some(item => item.content.includes('FOREIGN_SENTINEL'));
      entry.status = entry.recall.ok && entry.coldDirectReadSupported && entry.allTargetsInventoried && entry.namespaceIsolated ? 'observed' : 'failed';
    } catch (error) { entry.error = { code: /^[a-z_]+$/u.test(error?.message ?? '') ? error.message : 'diagnostic_failed' }; }
    finally { if (core) unwrap(core.close()); entry.elapsedMs = performance.now() - started; }
  }
  for (const size of [1, 101]) {
    const observations = [];
    const model = { contextWindow: 100000, countTokens: () => 1, classify: ({ input }) => {
      observations.push({ mapExhausted: input.mapExhausted, mapItemCount: input.map.length,
        mocCount: input.map.filter(item => item.type === 'moc').length });
      return { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [], newL1: { title: 'First category', parentL2Ids: [] } })) };
    } };
    let core;
    try {
      core = openMemoryCore({ path: path.join(directory, `classify-${size}.sqlite`), model });
      let first;
      for (let index = 0; index < size; index++) {
        const added = admit(core, namespace, `Classification control ${index}.`, `classify-${index}`);
        first ??= added.memory;
      }
      const mapped = unwrap(core.map({ namespace, purpose: 'classification' }));
      const result = await core.classifyPlacement({ namespace, memoryIds: [first.id],
        expectedMemoryRevisions: [{ memoryId: first.id, revision: first.revision }], mapRevision: mapped.indexRevision });
      report.classification.push({ size, observations, result });
    } finally { if (core) unwrap(core.close()); }
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'cairn-moc-diagnostic-'));
  console.log(JSON.stringify(await runMocRetrievalDiagnostic({ directory }), null, 2));
}
