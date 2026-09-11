import { readFileSync } from 'node:fs';
import { callModel } from './model-call.mjs';
import { denseArray, fail, object } from './validation.mjs';
import { emitDiagnostic } from './model-diagnostics.mjs';

const system = readFileSync(new URL('./prompts/reconcile-memories.md', import.meta.url), 'utf8');

function decisions(output, items, candidates, messages) {
  object(output, ['transitions']);
  const seen = new Set();
  return denseArray(output.transitions, 0, 5).map(transition => {
    object(transition, ['replacementIndex', 'predecessorIndex', 'evidenceIndices']);
    const { replacementIndex, predecessorIndex } = transition;
    if (!Number.isInteger(replacementIndex) || replacementIndex < 0 || replacementIndex >= items.length ||
        !Number.isInteger(predecessorIndex) || predecessorIndex < 0 || predecessorIndex >= candidates.length ||
        seen.has(predecessorIndex)) fail('invalid_model_output');
    seen.add(predecessorIndex);
    const evidence = denseArray(transition.evidenceIndices, 1, 4);
    if (new Set(evidence).size !== evidence.length || evidence.some(index =>
      !Number.isInteger(index) || !items[replacementIndex].sourceIndices.includes(index)) ||
      !evidence.some(index => messages[index]?.role === 'user')) fail('invalid_model_output');
    return { replacementIndex, predecessorIndex,
      receiptIndices: evidence.map(index => items[replacementIndex].sourceIndices.indexOf(index)) };
  });
}

export async function reconcileCapture({ model, snapshot, items, discovery }) {
  const { candidates } = discovery;
  if (discovery.reason || !items.length || !candidates.length) {
    return { decisions: [], reason: discovery.reason };
  }
  const input = {
    messages: snapshot.messages.map(({ role, content }, index) => ({ index, role, content })),
    items: items.map(({ content, kind, sourceIndices }, index) => ({ index, content, kind, sourceIndices })),
    candidates: candidates.map(({ row, receipts }, index) => ({ index, content: row.content,
      kind: row.kind, receipts: receipts.map(({ role, excerpt }) => ({ role, excerpt })) })),
  };
  let output;
  try { output = await callModel(model, 'reconcile', system, input, { failureCode: 'reconciliation_failed' }); }
  catch (error) {
    if (error.code === 'context_budget_exceeded') return { decisions: [], reason: 'context_budget' };
    throw error;
  }
  try { return { decisions: decisions(output, items, candidates, snapshot.messages), reason: null }; }
  catch {
    emitDiagnostic(model, 'reconcile', 'core_validation', 'invalid_reconciliation');
    fail('invalid_model_output');
  }
}
