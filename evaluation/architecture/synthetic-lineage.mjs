import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openMemoryCore } from '../../core/contract.mjs';
import { planLongMemEvalCase } from '../longmemeval/ingestion.mjs';
import { runPublicComparison } from '../longmemeval/public-comparison.mjs';

const MAX_SOURCES = 4;
const MAX_MEMORIES = 5;
const MAX_EVENTS = 8;
const UNKNOWN = 'unknown';
const REASONS = new Set([null, 'ingestion_incomplete', 'recall_failed',
  'context_window_exceeded', 'full_history_context_window_exceeded']);
const id = (kind, value) => `lme-${kind}-${createHash('sha256').update(`synthetic-lineage/${value}`).digest('hex')}`;
const visibleRef = item => item.type === 'unfiled' ? item.ref
  : item.type === 'ref' && item.ref.childType === 'memory'
    ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;

const cases = Object.freeze([
  { name: 'extraction-omission', texts: ['Amber ledger is retained.', 'Blue ledger is omitted.'],
    extract: [0], select: 'all', rank: 'all' },
  { name: 'extraction-unavailable', texts: ['Amber ledger is submitted.'],
    extract: 'fail', select: 'all', rank: 'all' },
  { name: 'admitted-unfiled', texts: ['Amber ledger is admitted.'],
    extract: [0], classify: 'fail', select: 'all', rank: 'all' },
  { name: 'visible-unselected', texts: ['Amber ledger is visible.'],
    extract: [0], select: 'none', rank: 'all' },
  { name: 'selected-rank-rejected', texts: ['Amber ledger is selected.'],
    extract: [0], select: 'all', rank: 'none' },
  { name: 'source-delivered', texts: ['Amber ledger reaches the answer.'],
    extract: [0], select: 'all', rank: 'all' },
  { name: 'packing-omission', texts: [
    `Amber ledger ${'amber '.repeat(95)}`, `Blue ledger ${'blue '.repeat(95)}`],
    extract: [0, 1], select: 'all', rank: 'all', packing: true },
]);

function fixture(spec) {
  const questionId = id('case', spec.name);
  const history = { question_id: questionId, sessions: [{ session_index: 0,
    session_id: id('session', spec.name), date: '2026/09/01 (Tue) 10:00',
    turns: spec.texts.map((content, index) => ({ turn_id: id('turn', `${spec.name}/${index}`),
      role: 'user', content })) }] };
  const question = { question_id: questionId, text: 'What does the ledger say?', date: '2026/09/02 (Wed) 10:00' };
  const namespace = { ownerId: 'synthetic-lineage', scope: 'project', projectId: questionId };
  return { history, question, namespace };
}

function sourceRows(count) {
  return Array.from({ length: count }, (_, index) => ({ source: index + 1,
    extraction: UNKNOWN, admission: UNKNOWN, filing: UNKNOWN, visible: UNKNOWN,
    selected: UNKNOWN, rankInput: UNKNOWN, rankOutput: UNKNOWN, returned: UNKNOWN, packed: UNKNOWN }));
}

function mark(rows, field, members, observed) {
  for (const row of rows) {
    if (row.admission !== 'admitted' && field !== 'extraction' && field !== 'admission') continue;
    row[field] = observed ? (members.has(row.source) ? 'yes' : 'no') : UNKNOWN;
  }
}

async function runCase(spec) {
  const { history, question, namespace } = fixture(spec);
  if (history.sessions[0].turns.length > MAX_SOURCES) throw new Error('fixture_source_cap');
  const plan = planLongMemEvalCase({ history, namespace });
  if (!plan.executable || plan.batches.length !== 1
    || plan.batches[0].sourceMap.length !== spec.texts.length
    || plan.batches[0].sourceMap.some((source, index) => source.turnIndex !== index || source.chunkIndex !== 0)) {
    throw new Error('fixture_shape_changed');
  }
  const sourceByEvent = new Map(plan.batches[0].sourceMap.map((source, index) => [source.messageId, index + 1]));
  const sourceByTurn = new Map(plan.batches[0].sourceMap.map((source, index) => [source.turnId, index + 1]));
  const rows = sourceRows(spec.texts.length);
  const memorySources = new Map();
  const seen = { capture: 0, extract: 0, select: 0, rank: 0, recall: 0, answer: 0 };
  let overflow = false;
  let activeIds = null;
  let extractSucceeded = false;
  let captureComplete = false;
  let recallSucceeded = false;
  let cairnAnswerObserved = false;
  const sets = Object.fromEntries(['proposal', 'admitted', 'visible', 'selected', 'rankInput',
    'rankOutput', 'returned', 'packed'].map(field => [field, new Set()]));
  const take = stage => {
    if (seen[stage] === MAX_EVENTS) overflow = true;
    else seen[stage] += 1;
  };
  const noOracleKeys = input => {
    const visit = value => {
      if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
        if (/^(answer|expected|has_answer|oracle)/iu.test(key)) throw new Error('oracle_key_in_model_input');
        visit(child);
      }
    };
    visit(input);
  };
  const addRefs = (target, refs) => {
    for (const ref of refs) for (const source of memorySources.get(ref.memoryId) ?? []) target.add(source);
  };
  const root = await mkdtemp(path.join(tmpdir(), 'cairn-lineage-'));
  let core;
  try {
    const countTokens = value => Buffer.byteLength(value, 'utf8');
    const model = {
      contextWindow: 16_384, countTokens,
      extract: async ({ input }) => {
        take('extract');
        noOracleKeys(input);
        if (spec.extract === 'fail') throw new Error('synthetic-extraction-failure');
        const output = { items: spec.extract.map(index => ({
          content: `Synthetic record ${index + 1}`, kind: 'fact', confidence: 1,
          sourceIndices: [index],
        })) };
        for (const item of output.items) for (const index of item.sourceIndices) {
          const ordinal = sourceByEvent.get(activeIds?.[index]);
          if (ordinal) sets.proposal.add(ordinal);
        }
        extractSucceeded = true;
        return output;
      },
      classify: async ({ input }) => {
        noOracleKeys(input);
        if (spec.classify === 'fail') throw new Error('synthetic-classification-failure');
        const existing = input.map.find(item => item.moc?.level === 'L1');
        return { items: input.memories.map(memory => ({ memoryId: memory.id,
          ...(existing ? { parentIds: [existing.moc.id] }
            : { parentIds: [], newL1: { title: 'Ledger', parentL2Ids: [] } }) })) };
      },
      select: async ({ input }) => {
        noOracleKeys(input);
        take('select');
        const candidates = input.maps.flatMap(page => page.items.map(item => ({
          ref: visibleRef(item), label: item.label ?? '', namespaceIndex: page.namespaceIndex,
        })).filter(item => item.ref));
        const refs = candidates.map(item => ({ namespaceIndex: item.namespaceIndex, ...item.ref }));
        addRefs(sets.visible, refs);
        const output = { refs: spec.select === 'none' ? [] : candidates
          .sort((a, b) => a.label.localeCompare(b.label))
          .map(item => ({ namespaceIndex: item.namespaceIndex, ...item.ref })) };
        addRefs(sets.selected, output.refs);
        return output;
      },
      rank: async ({ input }) => {
        noOracleKeys(input);
        take('rank');
        const refs = input.candidates.map(item => ({ namespaceIndex: item.namespaceIndex,
          memoryId: item.memory.id, revision: item.memory.revision,
          label: item.receipts[0]?.excerpt ?? '' }));
        addRefs(sets.rankInput, refs);
        const output = { refs: spec.rank === 'none' ? [] : refs
          .sort((a, b) => a.label.localeCompare(b.label)).slice(0, input.limit)
          .map(({ label, ...ref }) => ref) };
        addRefs(sets.rankOutput, output.refs);
        return output;
      },
    };
    core = openMemoryCore({ path: path.join(root, 'memory.sqlite'), model });
    const observedCore = {
      list: input => core.list(input),
      get: input => core.get(input),
      capture: async input => {
        take('capture');
        activeIds = input.messages.map(message => message.id);
        const result = await core.capture(input).finally(() => { activeIds = null; });
        if (result.ok && result.value.admission?.memories.length <= MAX_MEMORIES) {
          captureComplete = true;
          for (const memory of result.value.admission.memories) {
            const detail = core.get({ namespace, memoryId: memory.id, receiptLimit: 100 });
            if (detail.ok && detail.value?.exhausted === true && detail.value.receipts.length > 0) {
              const sources = new Set(detail.value.receipts.map(receipt => sourceByEvent.get(receipt.eventId))
                .filter(Boolean));
              if (sources.size !== detail.value.receipts.length) captureComplete = false;
              memorySources.set(memory.id, sources);
              for (const source of sources) sets.admitted.add(source);
              for (const source of sources) rows[source - 1].filing = detail.value.memory.filing.status;
            } else captureComplete = false;
          }
        } else if (result.ok) overflow = true;
        return result;
      },
      recall: async input => {
        take('recall');
        const result = await core.recall(input);
        if (result.ok) {
          recallSucceeded = true;
          addRefs(sets.returned, result.value.memories.map(item => ({
          memoryId: item.memory.id, revision: item.memory.revision })));
        }
        return result;
      },
    };
    const limits = { contextWindow: spec.packing ? 2100 : 16_384,
      outputTokens: 64, answerTimeoutMs: 1000, recallLimit: 6 };
    const comparison = await runPublicComparison({ history, question, namespace,
      core: observedCore, countTokens, answerModel: 'scripted-lineage', limits,
      answer: async ({ request }) => {
        take('answer');
        // If Cairn reaches answerArm, its call is first; the completed-arm guard below
        // prevents a later full-history call from being attributed to Cairn.
        if (seen.answer === 1) {
          cairnAnswerObserved = true;
          const evidence = JSON.parse(request.messages[1].content).evidence;
          for (const item of evidence) for (const receipt of item.receipts ?? []) {
            const source = sourceByTurn.get(receipt.source?.turnId);
            if (source && memorySources.get(item.memoryId)?.has(source)) sets.packed.add(source);
          }
        }
        return { text: 'Scripted answer' };
      } });
    const cairn = comparison.arms[0];
    mark(rows, 'extraction', sets.proposal, seen.extract > 0 && extractSucceeded);
    for (const row of rows) row.extraction = row.extraction === 'yes' ? 'proposed' : row.extraction === 'no' ? 'omitted' : UNKNOWN;
    for (const row of rows) row.admission = captureComplete
      ? sets.admitted.has(row.source) ? 'admitted' : 'none' : UNKNOWN;
    if (!captureComplete) for (const row of rows) row.filing = UNKNOWN;
    mark(rows, 'visible', sets.visible, seen.select > 0);
    mark(rows, 'selected', sets.selected, seen.select > 0);
    mark(rows, 'rankInput', sets.rankInput, seen.rank > 0);
    mark(rows, 'rankOutput', sets.rankOutput, seen.rank > 0);
    mark(rows, 'returned', sets.returned, recallSucceeded);
    mark(rows, 'packed', sets.packed, cairnAnswerObserved && cairn.status === 'completed');
    if (overflow) for (const row of rows) for (const field of Object.keys(row)) {
      if (field !== 'source') row[field] = UNKNOWN;
    }
    return { scenario: spec.name,
      status: ['completed', 'failed', 'blocked'].includes(cairn.status) ? cairn.status : UNKNOWN,
      reason: REASONS.has(cairn.reason) ? cairn.reason : 'other',
      sourceCount: rows.length, memoryCount: memorySources.size,
      overflow, observations: { ...seen }, sources: rows };
  } finally {
    core?.close();
    await rm(root, { recursive: true, force: true });
  }
}

export async function runSyntheticLineage() {
  const scenarios = [];
  for (const spec of cases) scenarios.push(await runCase(spec));
  return { synthetic: true, semanticAccuracy: 'not-measured',
    reportVersion: 'synthetic-evidence-lineage-v1', scenarios };
}
