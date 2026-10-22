import { tokenizeT1 } from '../../lib/tokenize.mjs';
import { normalizeVector } from '../../lib/embed-local.mjs';
export const document = (memoryId, text, kind = 'body', docId = `${memoryId}#${kind}`) => ({ docId, memoryId, kind, text });
export const toyDocuments = [document('m-a', 'Amber deploy Tuesday 資料庫備份'), document('m-b', 'Cedar deploy Thursday blue'),
  document('m-c', 'Amber retention thirty days'), document('m-d', '無關行程記錄')];
export const toyQueries = [{ queryId: 'q-a', text: 'Amber deploy', intent: 'current' },
  { queryId: 'q-b', text: '資料庫', intent: 'history' }];
export function fakeEmbedder() {
  const calls = [];
  return { calls, metadata: { name: 'fake', coldLoadMs: 0, device: 'cpu', threads: 1 },
    async embed(texts, options = {}) {
      calls.push({ texts: [...texts], ...options });
      return texts.map(text => {
        const tokens = new Set(tokenizeT1(text));
        return normalizeVector([1, ...['amber','deploy','cedar','blue','資料','料庫','備份'].map(t => Number(tokens.has(t)))]);
      });
    }, async close() {} };
}
export function toyFixture() {
  const memories = toyDocuments.map((doc, i) => ({ id: doc.memoryId, namespace: 'target', scale: 'S300',
    content: doc.text, kind: 'context', state: 'current', family: 'hidden-family', expresses: [{ fact: 'hidden-fact' }],
    spans: [{ id: `${doc.memoryId}#s1`, text: `Synthetic source ${i} ${doc.text}` }] }));
  memories.push({ id: 'm-old', namespace: 'target', scale: 'S300', content: 'Amber deploy Monday', state: 'historical',
    spans: [{ id: 'm-old#s1', text: 'The old launch date was Monday.' }] });
  memories.push({ id: 'm-await', namespace: 'target', scale: 'S300', content: 'Amber awaiting review', state: 'awaiting-review',
    spans: [{ id: 'm-await#s1', text: 'Awaiting review.' }] });
  memories.push({ id: 'm-deleted', namespace: 'target', scale: 'S300', content: 'Amber deleted', deleted: true, spans: [] });
  memories.push({ id: 'm-extra', namespace: 'target', scale: 'S1000-extra', content: 'Amber extra', state: 'current',
    spans: [{ id: 'm-extra#s1', text: 'Extra source.' }] });
  memories.push({ id: 'foreign-a', namespace: 'foreign', scale: 'foreign', content: 'Amber deploy 資料庫', state: 'current',
    spans: [{ id: 'foreign-a#s1', text: 'Amber deploy 資料庫' }] });
  return { corpus: { memories }, hashes: { toy: 'synthetic' }, split: { 'hidden-family': 'dev' },
    queries: { queries: toyQueries.map(query => ({ id: query.queryId, text: query.text, intent: query.intent, family: 'hidden-family',
      category: 'C3', requiredFacts: ['not-an-arm-input'] })) }, labels: null };
}
