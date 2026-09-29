import { bytes } from './confirmation-parity.mjs';
import { createCjkTokenCounter } from './cjk-token-counter.mjs';

// Small recalls whose requests already fit. Every memory has a distinct
// literal-overlap score so candidate order never depends on random IDs.
export const personal = { ownerId: 'cr1-synthetic', scope: 'personal', projectId: null };
export const project = { ...personal, scope: 'project', projectId: 'p' };
const receipt = (eventId, excerpt) => ({ client: 'synthetic', sessionId: 's', eventId, role: 'user', excerpt });
const refOf = (item) => item.type === 'unfiled' ? item.ref : item.type === 'ref' && item.ref.childType === 'memory'
  ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
const visible = (input) => input.maps.flatMap(({ namespaceIndex, items }) =>
  items.flatMap((item) => refOf(item) ? [{ namespaceIndex, ...refOf(item) }] : []));

// Scripted ports only: no provider or network generation.
export function scriptedRecallModel(countTokens, { selectNone = false } = {}) {
  const calls = [];
  const record = (method) => (request) => {
    calls.push({ method, system: request.system, input: structuredClone(request.input),
      maxOutputTokens: request.maxOutputTokens });
  };
  return { calls, contextWindow: 8192, countTokens,
    async select(request) {
      record('select')(request);
      return { refs: selectNone ? [] : visible(request.input).slice(0, request.input.maxRefs) };
    },
    async rank(request) {
      record('rank')(request);
      return { refs: request.input.candidates.slice(0, request.input.limit).map((candidate) => ({
        namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id, revision: candidate.memory.revision })) };
    } };
}

const cases = [
  { name: 'english-default', counter: 'bytes', query: 'alpha beta gamma delta', limit: 3, memories: [
    [personal, 'alpha beta gamma delta review notes'], [personal, 'alpha beta gamma rollout plan'],
    [personal, 'alpha beta migration record'], [personal, 'alpha only reminder']] },
  { name: 'cjk-two-namespaces', counter: 'cjk', query: '部署 遷移 監控', readSet: [personal, project], memories: [
    [personal, '部署 遷移 監控 都要在週五前完成檢查'], [personal, '部署 遷移 需要兩位同事一起確認'],
    [personal, '部署 流程的負責人是小林'], [project, '遷移 監控 告警的門檻已經調整'], [project, '監控 面板放在共用資料夾']] },
  { name: 'source-evidence', counter: 'cjk', query: '部署 遷移', contextMode: 'source-evidence', memories: [
    [personal, '部署 遷移 前先備份資料庫'], [personal, '部署 時段避開尖峰']] },
  { name: 'qualified-null', counter: 'bytes', query: 'alpha beta', includeQualification: true, memories: [
    [personal, 'alpha beta preference for numbered lists'], [personal, 'alpha reminder about reviews']] },
  { name: 'nothing-selected', counter: 'bytes', query: 'alpha', selectNone: true, memories: [
    [personal, 'alpha unrelated note']] },
  { name: 'empty-store', counter: 'cjk', query: '部署', memories: [] },
];

export async function parity(open, path) {
  const results = [];
  for (const [index, scenario] of cases.entries()) {
    const countTokens = scenario.counter === 'cjk' ? createCjkTokenCounter()
      : (text) => Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
    const model = scriptedRecallModel(countTokens, { selectNone: scenario.selectNone });
    const core = open({ path: `${path}-${index}`, model });
    try {
      for (const [memoryIndex, [namespace, content]] of scenario.memories.entries()) {
        const admitted = core.admit({ namespace, memory: { content, kind: 'fact' },
          receipts: [receipt(`event-${memoryIndex}`, content)] });
        if (!admitted.ok) throw Error(JSON.stringify(admitted));
      }
      const result = await core.recall({ readSet: scenario.readSet ?? [personal], query: scenario.query,
        ...(scenario.limit ? { limit: scenario.limit } : {}),
        ...(scenario.contextMode ? { contextMode: scenario.contextMode } : {}),
        ...(scenario.includeQualification ? { includeQualification: true } : {}) });
      results.push({ name: scenario.name, bytes: bytes({ result, calls: model.calls }) });
    } finally { core.close(); }
  }
  return results;
}
