import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const engineDir = process.env.ENGINE_DIR;
if (!engineDir) throw new Error('Usage: ENGINE_DIR=<engine extract root> node tools/goldens/rationale.generate.mjs');
const load = file => import(pathToFileURL(resolve(engineDir, file)).href);
const [{ openMemoryCore, openMemoryStore }, { proposeRationale }, { schemasFor }, { rationaleModel }] = await Promise.all([
  load('core/index.mjs'), load('core/rationale.mjs'), load('adapters/openai/schemas.mjs'),
  load('core/testing/rationale-model.mjs'),
]);
const engine = 'a7dccb788c8a086706bd84b1f6d125fc996afe1e';
const support = 'supports-decision';
const challenge = 'challenges-premise';
const edge = (from, to, relation = support, fromReceipt = 0, toReceipt = 0) => ({ from, to, relation, fromReceipt, toReceipt });
const texts = ['I chose A because it supports offline work.', 'A supports offline work.', 'I checked: A cannot work offline.'];
const sources = texts.map((excerpt, index) => ({ memory: { id: 'm' + index, revision: 1 },
  receipts: [{ id: 'r' + index, role: index === 2 ? 'assistant' : 'user', excerpt }] }));
const ok = result => {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
};
const byJson = (a, b) => Buffer.compare(Buffer.from(JSON.stringify(a)), Buffer.from(JSON.stringify(b)));

const P1 = [];
const invalid = [
  ['null', null], ['missing edges', {}], ['extra top-level key', { edges: [], extra: true }],
  ['memory index', { edges: [edge(1, 0), edge(2, 9)] }], ['self-challenge', { edges: [edge(1, 1, challenge)] }],
  ['relation', { edges: [edge(1, 0, 'supersedes')] }], ['duplicate', { edges: [edge(1, 0), edge(1, 0)] }],
  ['receipt index', { edges: [edge(1, 0, support, 100)] }], ['extra edge key', { edges: [{ ...edge(1, 0), confidence: 1 }] }],
  ['eleven edges', { edges: Array(11).fill(edge(1, 0)) }],
];
for (const [name, output, input = sources] of [
  ['R2 / empty', { edges: [] }],
  ...invalid.map(([name, output]) => ['R3 / ' + name, output]),
  ['R12 / self-support and challenge', { edges: [edge(0, 0), edge(1, 0, challenge)] }, [sources[0], sources[2]]],
  ['self-support', { edges: [edge(0, 0)] }],
  ['receipt index in the union but wrong endpoint', { edges: [edge(0, 1, support, 1)] }, [
    sources[0], { ...sources[1], receipts: [...sources[1].receipts, { id: 'r3', role: 'assistant', excerpt: 'A second receipt.' }] },
  ]],
]) {
  try {
    const value = await proposeRationale({ contextWindow: 8192, countTokens: () => 1, relate: () => output }, input);
    P1.push({ name, sources: input, output, value });
  } catch (error) {
    assert.equal(error.code, 'invalid_model_output', name);
    P1.push({ name, sources: input, output, error: error.code });
  }
}

const wireSources = P1.at(-1).sources;
let request;
await proposeRationale({
  contextWindow: 8192, countTokens: () => 1,
  relate(value) { request = value; return { edges: [] }; },
}, wireSources);
const prompt = await readFile(resolve(engineDir, 'core/prompts/relate-rationale.md'), 'utf8');
assert.equal(request.system, prompt);
const P2 = { sources: wireSources, system: prompt, input: request.input, schema: schemasFor('relate', request.input),
  schemaName: 'cairn_relate', maxOutputTokens: request.maxOutputTokens };

const review = (refs, edges) => ({ action: 'review', refs, ...(edges && { edges }) });
const inspect = (root = 0, args = {}) => ({ action: 'inspect', root, ...args });
const mutate = (mutation, target = 2) => ({ action: 'mutate', mutation, target });
const original = [0, 1, 2];
const scriptedChain = [edge(1, 0), edge(2, 1, challenge)];
const namespaces = { primary: { ownerId: 'example', scope: 'personal', projectId: null },
  foreign: { ownerId: 'another-example', scope: 'personal', projectId: null } };
const P3 = [];

const scratch = await mkdtemp(join(tmpdir(), 'cairn-rationale-goldens-'));
try {
  async function scenario(name, count, steps) {
    const path = join(scratch, 'case-' + P3.length + '.sqlite');
    const scripted = rationaleModel();
    let latest;
    let scriptedEdges;
    const model = {
      ...scripted,
      relate(request) {
        const output = scripted.relate(request);
        latest = scriptedEdges === undefined ? output : { edges: scriptedEdges };
        return latest;
      },
    };
    let core = openMemoryCore({ path, model });
    const db = new DatabaseSync(path);
    const seeds = Array.from({ length: count }, (_, i) => ({
      id: 'm' + i, text: 'Memory ' + (texts[i] ?? ('Synthetic source ' + i + '.')),
      excerpt: texts[i] ?? ('Synthetic source ' + i + '.'),
    }));
    const receipt = (excerpt, eventId) => ({ client: 'fixture', sessionId: 'fixture', eventId, role: 'user', excerpt });
    const refs = seeds.map(({ text, excerpt }, i) => {
      const { memory } = ok(core.admit({ namespace: namespaces.primary, memory: { content: text, kind: 'context' },
        receipts: [receipt(excerpt, 'r' + i)] }));
      return { memoryId: memory.id, revision: memory.revision };
    });
    const label = id => {
      const i = refs.findIndex(ref => ref.memoryId === id);
      assert.notEqual(i, -1);
      return seeds[i].id;
    };
    const normalizeView = ({ root, edges, sources, ...view }) => {
      const receiptLabels = new Map(sources.flatMap(({ memory, receipts }) => receipts.map(({ id }, i) =>
        [id, label(memory.id) + ':r' + i])));
      return { ...view, root: { id: label(root.memoryId), revision: root.revision },
        edges: edges.map(({ from, to, fromReceipt, toReceipt, ...edge }) => ({
          ...edge, from: label(from), to: label(to), fromReceipt: receiptLabels.get(fromReceipt), toReceipt: receiptLabels.get(toReceipt),
        })).sort(byJson),
        sources: sources.map(({ memory: { id, revision }, receipts }) => ({
          memory: { id: label(id), revision }, receipts: receipts.map(({ id, role, excerpt }) => ({
            id: receiptLabels.get(id), role, excerpt,
          })),
        })).sort(byJson),
      };
    };
    const results = [];
    try {
      for (const step of steps) {
        if (step.action === 'review') {
          scriptedEdges = step.edges;
          latest = undefined;
          const result = await core.reviewRationale({ namespace: namespaces.primary, refs: step.refs.map(i => refs[i]) });
          results.push({ ...step, output: latest, expected: result.ok ? {
            proposed: result.value.proposed, inserted: result.value.inserted,
          } : { error: result.error.code } });
        } else if (step.action === 'inspect') {
          const input = { namespace: namespaces[step.scope ?? 'primary'], ...refs[step.root],
            ...(step.revision && { revision: step.revision }), ...(Object.hasOwn(step, 'view') && { view: step.view }) };
          const result = core.getRationale(input);
          results.push({ ...step, expected: result.ok ? normalizeView(result.value) : { error: result.error.code } });
        } else if (step.action === 'reopen') {
          core.close();
          core = openMemoryCore({ path });
          results.push(step);
        } else {
          const { memoryId, revision } = refs[step.target];
          const namespace = namespaces.primary;
          switch (step.mutation) {
            case 'correct':
              ok(core.correct({ namespace, memoryId, expectedRevision: revision, content: 'Corrected fixture content.', kind: 'fact',
                receipt: receipt('Corrected fixture content.', 'correction') }));
              break;
            case 'forget':
              ok(core.forget({ namespace, memoryId, expectedRevision: revision }));
              break;
            case 'legacy-correct':
            case 'legacy-forget': {
              const legacy = openMemoryStore({ path });
              try {
                const store = legacy.scope({ ownerId: namespace.ownerId });
                if (step.mutation === 'legacy-forget') store.forget(memoryId, revision);
                else store.correct(memoryId, { content: 'Legacy corrected content.', kind: 'fact',
                  origin: 'explicit', confidence: 1, receipt: receipt('Legacy corrected content.', 'legacy-correction') }, revision);
              } finally { legacy.close(); }
              break;
            }
            case 'receipt-update':
              db.prepare('UPDATE receipts SET excerpt = ? WHERE memory_id = ?').run('Changed source evidence.', memoryId);
              break;
            case 'receipt-delete':
              db.prepare('DELETE FROM receipts WHERE memory_id = ?').run(memoryId);
              break;
            case 'receipt-add':
              ok(core.admit({ namespace, memory: { content: seeds[step.target].text, kind: 'context' },
                receipts: [receipt('Additional receipt.', 'added')] }));
              break;
            case 'revision':
              db.prepare('UPDATE memories SET revision = revision + 1 WHERE id = ?').run(memoryId);
              break;
            case 'supersede':
              ok(core.supersede({ namespace, memoryId, expectedRevision: revision,
                replacement: { content: 'Offline unavailable', kind: 'fact' }, receipts: [receipt('Replacement.', 'new')] }));
              break;
            default: throw new Error(step.mutation);
          }
          results.push({ ...step, stored: db.prepare('SELECT count(*) AS n FROM rationale_edges').get().n });
        }
      }
      P3.push({ name, seeds, steps: results, stored: db.prepare('SELECT count(*) AS n FROM rationale_edges').get().n });
    } finally { core.close(); db.close(); }
  }

  const incident = { view: 'incident-proposals' };
  await scenario('R1 / scripted source-only review, idempotence and cold inspection', 3,
    [review(original, scriptedChain), inspect(), inspect(0, incident), review(original, scriptedChain), { action: 'reopen' }, inspect(), inspect(0, incident)]);
  await scenario('R2 / empty keeps prior proposals', 3,
    [review(original, []), inspect(), review(original), review(original, []), inspect()]);
  await scenario('R12 / self-support uses one receipt', 3, [review([0, 2]), inspect(), inspect(0, incident)]);
  for (const mutation of ['correct', 'forget', 'legacy-correct', 'legacy-forget', 'receipt-update', 'receipt-delete',
    'receipt-add', 'revision', 'supersede']) {
    await scenario('R6 / ' + mutation, 3,
      [review(original, scriptedChain), inspect(), mutate(mutation, 1), inspect(), inspect(0, incident)]);
  }
  const repeated = (n, relation, outgoing = false) => Array.from({ length: n }, (_, i) =>
    review([0, i + 1], [outgoing ? edge(0, 1, relation) : edge(1, 0, relation)]));
  await scenario('R7 / degree and whole-batch rollback', 13, [
    ...repeated(10, support), inspect(), inspect(0, incident),
    review([0, 11, 12], [edge(2, 1), edge(1, 0)]), inspect(11, incident),
  ]);
  await scenario('DC1 / direct challenge', 3, [review(original, [edge(2, 0, challenge)]), inspect(), inspect(0, incident)]);
  await scenario('DC1 / self-support deduplication', 3, [review(original), inspect(), inspect(0, incident)]);
  await scenario('DC2 / correction clears direct challenge', 3,
    [review(original, [edge(2, 0, challenge)]), inspect(), mutate('correct'), inspect(), inspect(0, incident)]);
  const direct = repeated(6, challenge);
  await scenario('DC2 / six-source bound', 7, [...direct.slice(0, 5), inspect(), direct[5], inspect()]);
  const paired = Array.from({ length: 5 }, (_, i) => review([0, i + 1], [edge(1, 0), edge(1, 0, challenge)]));
  await scenario('DC2 / ten-edge bound across paths', 6, [...paired, inspect(), review([1, 2], [edge(1, 0, challenge)]), inspect()]);
  await scenario('RI2 / incident outgoing and self rows', 4,
    [review([0, 1, 2, 3], [edge(0, 0), edge(0, 1), edge(1, 2), edge(3, 2)]), inspect(), inspect(0, incident)]);
  await scenario('RI3 / view guards, scope, revision and cold forget', 3, [
    review(original, [edge(2, 0, challenge)]), ...[null, '', 'history', true, {}, []].map(view => inspect(0, { view })),
    inspect(0, { ...incident, scope: 'foreign' }), inspect(0, { ...incident, revision: 999 }),
    inspect(0, incident), { action: 'reopen' }, inspect(0, incident), mutate('forget'), inspect(0, incident), inspect(),
  ]);
  const outgoing = repeated(6, support, true);
  await scenario('RI4 / incident six-source bound', 7, [...outgoing.slice(0, 5), inspect(0, incident), outgoing[5], inspect(0, incident), inspect()]);
  await scenario('RI5 / receipt edit clears incident rows', 3,
    [review(original, [edge(2, 0, challenge)]), inspect(0, incident), mutate('receipt-update'), inspect(), inspect(0, incident)]);
} finally { await rm(scratch, { recursive: true, force: true }); }

const fixture = new URL('../../packages/core/test/fixtures/rationale/engine-goldens.json', import.meta.url);
const json = JSON.stringify({ engine, P1, P2, P3 }, null, 2) + '\n';
await mkdir(new URL('.', fixture), { recursive: true });
await writeFile(fixture, json);
console.log(createHash('sha256').update(json).digest('hex'), 'engine-goldens.json');
