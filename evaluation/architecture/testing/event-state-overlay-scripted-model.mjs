// OFFLINE TEST ONLY: a deliberately scripted proposal, never semantic evidence.
import { eventStateScriptedModel } from './event-state-scripted-model.mjs';
export function overlayScriptedModel(options = {}) {
  const base = eventStateScriptedModel(options);
  return { ...base, relate: request => {
    if (options.failMethod === 'relate') throw new Error('offline-relation-failure');
    const memories = request.input.memories;
    const decision = memories.find(memory => memory.receipts.some(receipt => receipt.excerpt.includes('recorded route decision')));
    const update = memories.find(memory => memory.receipts.some(receipt => receipt.excerpt.includes('lift is now out of service')));
    const edge = (from, to, relation) => ({ from: from.index, to: to.index, relation, fromReceipt: 0, toReceipt: 0 });
    return { edges: decision ? [edge(decision, decision, 'supports-decision'),
      ...(update ? [edge(update, decision, 'challenges-premise')] : [])] : [] };
  } };
}
