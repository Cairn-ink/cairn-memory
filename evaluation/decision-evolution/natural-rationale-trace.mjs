// Read-only observer for the opt-in automatic rationale path. Model data remains
// source-only; provenance is attached only after stored receipts are inspected.
export function observeRelate(model, calls) {
  // An empty proxy target avoids invariants on a frozen adapter's own method.
  // Bind every method to the original adapter, as it would be when core calls it.
  return new Proxy(Object.create(null), { get(_target, property) {
    const method = Reflect.get(model, property, model);
    if (property !== 'relate') return typeof method === 'function' ? method.bind(model) : method;
    if (typeof method !== 'function') return method;
    return (...args) => {
      const call = { status: 'called' };
      try { call.input = structuredClone(args[0]?.input); }
      catch { call.input = null; }
      calls.push(call);
      const success = value => { call.status = 'returned';
        try { call.proposedEdges = Array.isArray(value?.edges) ? structuredClone(value.edges.slice(0, 11)) : null; }
        catch { call.proposedEdges = null; }
        return value; };
      const failure = error => { call.status = 'rejected'; throw error; };
      try {
        const returned = Reflect.apply(method, model, args);
        return returned?.then ? returned.then(success, failure) : success(returned);
      } catch (error) { call.status = 'threw'; throw error; }
    };
  } });
}

function passage(receipt, sourceReceipts, truncatedSourceIds) {
  const matches = sourceReceipts.filter(row => row.role === receipt.role && row.excerpt === receipt.excerpt);
  if (!matches.length) return { status: 'unmatched' };
  if (matches.length > 1) return { status: 'ambiguous', matchingReceiptCount: matches.length };
  const match = matches[0];
  if (!match.sourceId) return { status: 'unverified-receipt', receiptId: match.receiptId, memoryId: match.memoryId };
  return { status: truncatedSourceIds.includes(match.sourceId) ? 'truncated' : 'matched',
    sourceId: match.sourceId, receiptId: match.receiptId, memoryId: match.memoryId };
}

export function projectRelateCalls(calls, sourceReceipts, truncatedSourceIds) {
  return calls.map(call => ({ status: call.status,
    candidates: (call.input?.memories ?? []).map(memory => ({ index: memory.index,
      receipts: memory.receipts.map(receipt => ({ index: receipt.index, role: receipt.role,
        excerpt: receipt.excerpt, provenance: passage(receipt, sourceReceipts, truncatedSourceIds) })) })),
    proposedEdges: call.status === 'returned' ? (call.proposedEdges ?? null) : null }));
}

export function inspectRationaleLifecycle(core, namespace, sourceReceipts, receiptSources) {
  const memoryIds = [...new Set(sourceReceipts.map(row => row.memoryId))];
  const edges = new Map(); const failures = [];
  for (const memoryId of memoryIds) {
    const detail = core.get({ namespace, memoryId });
    if (!detail.ok) { failures.push({ memoryId, stage: 'get', error: detail.error.code }); continue; }
    const rationale = core.getRationale({ namespace, memoryId, revision: detail.value.memory.revision,
      view: 'incident-proposals' });
    if (!rationale.ok) { failures.push({ memoryId, stage: 'getRationale', error: rationale.error.code }); continue; }
    for (const edge of rationale.value.edges) {
      const key = JSON.stringify([edge.from, edge.to, edge.relation, edge.fromReceipt, edge.toReceipt]);
      if (edges.has(key)) continue;
      edges.set(key, { ...edge,
        fromSourceId: receiptSources.get(`${edge.from}:${edge.fromReceipt}`) ?? null,
        toSourceId: receiptSources.get(`${edge.to}:${edge.toReceipt}`) ?? null });
    }
  }
  return { status: failures.length ? 'incomplete' : 'ok', edges: [...edges.values()], failures };
}

export function sourceObservation(sourceId, admission, sourceReceipts, relateCalls, lifecycle) {
  if (!admission?.memories?.length) return 'admission-absent';
  if (!sourceReceipts.some(row => row.sourceId === sourceId)) return 'source-absent';
  const visible = relateCalls.flatMap(call => call.candidates.flatMap(candidate => candidate.receipts))
    .some(receipt => receipt.provenance.sourceId === sourceId);
  if (!visible) {
    const excerpts = sourceReceipts.filter(row => row.sourceId === sourceId).map(row => row.excerpt);
    const ambiguous = relateCalls.flatMap(call => call.candidates.flatMap(candidate => candidate.receipts))
      .some(receipt => receipt.provenance.status === 'ambiguous' && excerpts.includes(receipt.excerpt));
    return ambiguous ? 'candidate-ambiguous' : 'not-candidate';
  }
  if (relateCalls.some(call => ['rejected', 'threw', 'called'].includes(call.status))) {
    return 'candidate-seen-callback-failed-or-pending';
  }
  const proposals = relateCalls.flatMap(call => (call.proposedEdges ?? []).filter(edge =>
    edge && typeof edge === 'object').map(edge => {
    const from = call.candidates[edge.from]?.receipts[edge.fromReceipt];
    const to = call.candidates[edge.to]?.receipts[edge.toReceipt];
    return { relation: edge.relation, from: from?.provenance, to: to?.provenance };
  })).filter(edge => edge.from?.sourceId === sourceId || edge.to?.sourceId === sourceId);
  if (!proposals.length) return 'candidate-seen-no-proposal';
  if (proposals.some(proposal => lifecycle.edges.some(edge => edge.relation === proposal.relation &&
    edge.from === proposal.from?.memoryId && edge.fromReceipt === proposal.from?.receiptId &&
    edge.to === proposal.to?.memoryId && edge.toReceipt === proposal.to?.receiptId))) {
    return 'stored-model-proposed';
  }
  if (lifecycle.status && lifecycle.status !== 'ok') return 'candidate-seen-proposal-persistence-unavailable';
  return 'candidate-seen-proposal-not-stored';
}
