import assert from 'node:assert/strict';
import { writeSync } from 'node:fs';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createCairnServer } from '../../server.mjs';
import { parseConfiguration } from '../../cli.mjs';
import { rationaleModel } from '../../../../core/testing/rationale-model.mjs';

// Test-only observations never enter MCP stdout or become production tools.
let sequence = 0;
function trace(record) {
  const bytes = Buffer.from(`rationale-lifecycle:${JSON.stringify({ sequence: ++sequence, ...record })}\n`);
  assert.ok(bytes.length <= 65536, 'bounded synthetic observation');
  assert.equal(writeSync(2, bytes), bytes.length);
}
globalThis.fetch = () => { throw new Error('offline_only'); };
const model = rationaleModel();
const extract = model.extract;
model.extract = request => {
  const result = extract(request);
  for (const item of result.items) item.kind = item.content.startsWith('I chose ') ? 'decision'
    : item.content.startsWith('I keep ') ? 'instruction' : 'fact';
  return result;
};
const qualify = model.qualifyCandidates;
model.qualifyCandidates = request => {
  const result = qualify(request);
  for (const qualification of result.qualifications) {
    const item = request.input.items.find(item => item.itemIndex === qualification.itemIndex);
    if (item.content.startsWith('I chose ')) qualification.commitment = {
      value: 'adopted', evidenceIndices: [item.candidates[0].candidateIndex],
    };
  }
  return result;
};
model.relate = ({ input }) => {
  // These are frozen scripted interpretations, not an entailment detector.
  const find = prefix => input.memories.find(memory => memory.receipts.some(receipt => receipt.excerpt.startsWith(prefix)));
  const decision = find('I chose '), premise = find('A supports offline work'), challenge = find('I checked: A cannot work offline');
  const edge = (from, to, relation) => ({ from: from.index, to: to.index, relation,
    fromReceipt: from.receipts[0].index, toReceipt: to.receipts[0].index });
  return { edges: [...(decision && premise ? [edge(premise, decision, 'supports-decision')] : []),
    ...(premise && challenge ? [edge(challenge, premise, 'challenges-premise')] : [])] };
};
// Each fresh server has no warm IDs or expected-source roster. Selection uses
// only this request's query and visible catalog; rank uses visible candidates.
model.select = ({ input }) => ({ refs: input.maps.flatMap(map => map.items
  .filter(item => item.type === 'unfiled' && /^(I chose |I keep )/.test(item.label)
    && item.label.includes(input.query))
  .map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) });
model.rank = ({ input }) => ({ refs: [...input.candidates]
  .sort((a, b) => Number(b.receipts.some(receipt => receipt.excerpt.startsWith('I chose ')))
    - Number(a.receipts.some(receipt => receipt.excerpt.startsWith('I chose '))))
  .slice(0, input.limit).map(candidate => ({ namespaceIndex: candidate.namespaceIndex,
    memoryId: candidate.memory.id, revision: candidate.memory.revision })) });
for (const method of ['extract', 'qualifyCandidates', 'classify', 'relate', 'select', 'rank']) {
  const run = model[method];
  model[method] = request => {
    const output = run(request);
    trace({ kind: 'model', method, input: request.input, output });
    return output;
  };
}
const handle = serveStdio(() => createCairnServer({ ...parseConfiguration(process.argv.slice(2)), model }));
let closing;
const close = () => {
  closing ??= handle.close().then(() => trace({ kind: 'closed' }));
  closing.catch(error => { console.error(error); process.exitCode = 1; });
};
process.stdin.once('end', close);
process.once('SIGTERM', close);
