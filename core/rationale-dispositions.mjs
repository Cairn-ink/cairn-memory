import { readFileSync } from 'node:fs';
import { callModel } from './model-call.mjs';
import { countTokens } from './model-budget.mjs';
import { compileRationaleEdges } from './rationale.mjs';
import { denseArray, fail, object } from './validation.mjs';

const system = readFileSync(new URL('./prompts/review-rationale-dispositions-v2.md', import.meta.url), 'utf8');
const exact = (value, keys) => {
  object(value, keys);
  if (keys.some(key => !Object.hasOwn(value, key))) fail('invalid_model_output');
};
const tuple = edge => JSON.stringify([edge.from, edge.to, edge.relation,
  edge.fromReceipt, edge.toReceipt]);

function compile(output, snapshot) {
  exact(output, ['dispositions', 'additions']);
  const { sources, edges: oldEdges } = snapshot;
  const allReceipts = sources.reduce((sum, source) => sum + source.receipts.length, 0);
  const seen = new Set();
  const dispositions = denseArray(output.dispositions, oldEdges.length, oldEdges.length).map(item => {
    exact(item, ['edge', 'action', 'evidence']);
    if (!Number.isSafeInteger(item.edge) || item.edge < 0 || item.edge >= oldEdges.length ||
        seen.has(item.edge) || !['keep', 'withdraw', 'unknown'].includes(item.action)) fail('invalid_model_output');
    seen.add(item.edge);
    const citations = new Set();
    const evidence = denseArray(item.evidence, 0, allReceipts).map(citation => {
      exact(citation, ['memory', 'receipt']);
      if (!Number.isSafeInteger(citation.memory) || citation.memory < 0 || citation.memory >= sources.length ||
          !Number.isSafeInteger(citation.receipt) || citation.receipt < 0 ||
          citation.receipt >= sources[citation.memory].receipts.length) fail('invalid_model_output');
      const key = JSON.stringify([citation.memory, citation.receipt]);
      if (citations.has(key)) fail('invalid_model_output');
      citations.add(key);
      return { memory: citation.memory, receipt: citation.receipt };
    });
    if (item.action === 'withdraw' && evidence.length === 0) fail('invalid_model_output');
    return { edge: item.edge, action: item.action, evidence };
  });
  if (seen.size !== oldEdges.length) fail('invalid_model_output');
  const additions = compileRationaleEdges(output.additions, sources);
  const prior = new Set(oldEdges.map(tuple));
  if (additions.some(edge => prior.has(tuple(edge)))) fail('invalid_model_output');
  const byEdge = new Map(dispositions.map(item => [item.edge, item]));
  const projectedEdges = oldEdges.flatMap((edge, index) => {
    const action = byEdge.get(index).action;
    return action === 'withdraw' ? [] : [{ ...edge, disposition: action }];
  }).concat(additions.map(edge => ({ ...edge, interpretationStatus: 'model-proposed',
    disposition: 'addition' })));
  if (projectedEdges.length > 10) fail('rationale_limit');
  return { status: 'unassessed', interpretationStatus: 'model-proposed', persistence: 'not-stored',
    scope: 'supplied-refs-only', sources, indexRevision: snapshot.indexRevision,
    oldEdges, dispositions, additions, projectedEdges,
    unresolvedCount: dispositions.filter(item => item.action === 'unknown').length };
}

/** An ephemeral proposed graph; no mutation or semantic certification. */
export async function reviewRationaleDispositions(model, snapshot, validateFresh) {
  const input = {
    memories: snapshot.sources.map((source, index) => ({ index,
      receipts: source.receipts.map((receipt, receiptIndex) => ({ index: receiptIndex,
        role: receipt.role, excerpt: receipt.excerpt })) })),
    oldEdges: snapshot.edges.map((edge, index) => ({ index, from: edge.from, to: edge.to,
      relation: edge.relation, fromReceipt: edge.fromReceipt, toReceipt: edge.toReceipt,
      interpretationStatus: 'unverified' })),
  };
  const output = await callModel(model, 'reviewRationaleDispositions', system, input,
    { validateFresh, failureCode: 'rationale_failed' });
  let detached, text;
  try { detached = structuredClone(output); text = JSON.stringify(detached); }
  catch { fail('invalid_model_output'); }
  validateFresh();
  if (typeof text !== 'string' || text.length > 40_000 || countTokens(model, text) > 1024) {
    fail('invalid_model_output');
  }
  validateFresh();
  let result;
  try { result = compile(detached, snapshot); }
  catch (error) { if (error?.code === 'rationale_limit') throw error; fail('invalid_model_output'); }
  validateFresh();
  if (JSON.stringify(result).length > 24000) fail('context_item_too_large');
  validateFresh();
  return result;
}
