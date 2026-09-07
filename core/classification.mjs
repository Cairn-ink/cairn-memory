import { readFileSync } from 'node:fs';
import { countTokens } from './model-budget.mjs';
import { placementProposal } from './placement-input.mjs';
import { fail, MemoryStoreError } from './validation.mjs';

const system = readFileSync(new URL('./prompts/classify-placement.md', import.meta.url), 'utf8');

export async function classify({ model, snapshot, map, validateFresh }) {
  if (typeof model?.classify !== 'function') fail('model_not_configured');
  if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow < 8192) fail('context_budget_exceeded');
  const input = { memories: snapshot.memories, map: map.items, mapExhausted: map.exhausted };
  const request = { system, input, maxOutputTokens: 1024 };
  if (countTokens(model, JSON.stringify(request)) > 6000) fail('context_budget_exceeded');
  validateFresh();
  const controller = new AbortController();
  let timer;
  let output;
  try {
    output = await Promise.race([
      Promise.resolve().then(() => model.classify({ ...structuredClone(request), signal: controller.signal })),
      new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new MemoryStoreError('model_timeout')); }, 30_000);
      }),
    ]);
  } catch (error) {
    if (error?.code === 'model_timeout' || controller.signal.aborted) fail('model_timeout');
    if (error?.name === 'AbortError') fail('model_cancelled');
    fail('classification_failed');
  } finally { clearTimeout(timer); }
  validateFresh();
  let proposal;
  try {
    // Bound untrusted serialized output before traversing its proposal shape.
    const text = JSON.stringify(output);
    if (typeof text !== 'string' || text.length > 40_000) fail('invalid_model_output');
    if (countTokens(model, text) > 1024) fail('invalid_model_output');
    proposal = placementProposal(output, snapshot.memories.map((memory) => memory.id));
    const visibleGroups = new Map(map.items.filter((item) => item.type === 'moc')
      .map((item) => [item.moc.id, item.moc.level]));
    for (const item of proposal.items) {
      if (item.parentIds.some((id) => visibleGroups.get(id) !== 'L1')) fail('invalid_model_output');
      if (item.newL1 && (!map.exhausted || item.newL1.parentL2Ids.some((id) => visibleGroups.get(id) !== 'L2'))) {
        fail('invalid_model_output');
      }
    }
  } catch (error) {
    if (error?.code === 'token_count_unavailable') throw error;
    fail('invalid_model_output');
  }
  validateFresh();
  return { proposal, basedOn: { memoryRevisions: snapshot.memories.map((m) =>
    ({ memoryId: m.id, revision: m.revision })), indexRevision: snapshot.indexRevision,
  mapExhausted: map.exhausted } };
}
