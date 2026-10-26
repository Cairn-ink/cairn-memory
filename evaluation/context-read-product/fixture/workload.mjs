import { parameters, namespaces, readJSON, fit } from './content.mjs';
export const workload = readJSON('writer-workload.json');
export function targetNamespace(index, target = 'same-owner') {
  if (!['same-owner', 'other-owner'].includes(target)) throw Error('unknown writer target');
  return { ...namespaces[index % 4], ownerId: target === 'same-owner' ? parameters.ownerId : parameters.otherOwnerId };
}
export function freshnessTarget(index, type, { target = 'same-owner', repetition = 0 } = {}) {
  if (!Number.isInteger(index) || index < 0 || index >= workload.freshness.targetsPerType || !['memory', 'card'].includes(type)) throw Error('invalid target');
  // Pure ASCII letters/digits form one unique lexical term under frozen T1.
  const token = `${type === 'memory' ? workload.freshness.memoryTokenPrefix : workload.freshness.cardTokenPrefix}${target === 'same-owner' ? 's' : 'o'}r${repetition}i${String(index).padStart(3, '0')}`;
  const namespace = targetNamespace(index, target), actionId = `fresh-${target}-${repetition}-${type}-${index}`;
  return { index, type, namespace, token, actionId, intents: ['current', 'history'],
    body: fit(`${token} 合成新項目：虛構樣片已通過新鮮度核對。`, type === 'memory' ? 360 : 900),
    receipt: { client: 'synthetic-p2-writer', sessionId: `fresh-${repetition}`, eventId: actionId,
      role: 'user', excerpt: fit(`${token} 合成來源已確認。`, 240) },
    note: fit(`${token} 合成卡片來源已確認。`, 400) };
}
export function writerOperation(index, { target = 'same-owner', repetition = 0, mix = 'mixed-80-20' } = {}) {
  if (!Number.isSafeInteger(index) || index < 0 || !['mixed-80-20', 'capture-only', 'review-only'].includes(mix)) throw Error('invalid operation');
  const kind = mix === 'capture-only' ? 'capture' : mix === 'review-only' ? 'review' : workload.perRequest.captureReviewCycle[index % 5];
  const namespace = targetNamespace(index, target), eventId = `writer-${target}-${repetition}-${index}`;
  const content = fit(`合成寫入 ${eventId}：虛構石芽樣片第${index}次核對。`, 360);
  const receipts = [{ client: 'synthetic-p2-writer', sessionId: `writer-${repetition}`, eventId,
    role: 'user', excerpt: fit(`合成寫入來源 ${eventId}。`, 240) }];
  return { index, kind, method: kind === 'capture' ? 'admit' : 'supersede', namespace,
    reviewPoolSlot: index % 4, content, receipts,
    bindRule: kind === 'review' ? 'Resolve current pool id/revision immediately before call; update pool to returned successor on success only.' : null };
}
