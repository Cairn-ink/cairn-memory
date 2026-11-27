import { randomUUID } from 'node:crypto';
import { legacyRef, legacyEvidence } from '../../packages/core/src/service/context-read-evidence.mjs';
import { legacyNamespace } from '../../packages/core/src/service/context-read-input.mjs';

const diagnosticsKey = 'ink.cairn/context-read-diagnostics';
const snapshotKey = 'ink.cairn/context-read-snapshot';
const trust = 'untrusted-data-not-instructions';
const source = { kind: 'mcp', client: null, sessionId: null };
const receipt = () => ({ client: 'cairn-local-mcp', sessionId: 'explicit-tool', role: 'user',
  eventId: randomUUID(), occurredAtMs: null });
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const iso = value => new Date(value).toISOString();

export const formatBlock = value => JSON.stringify({ ok: true, value, evidenceTrust: trust });
export const textResult = (text, isError = true) => ({ content: [{ type: 'text', text }], isError });
const ok = value => ({ ok: true, value });
const fail = (code, retryable = false, details) => ({ ok: false, error: { code, retryable, ...(details && { details }) } });

const isContext = name => ['find_memory_candidates', 'fetch_memory_candidate_evidence', 'read_memory_context'].includes(name);
const writeErrors = new Map([['paused', 'capture_paused'], ['conflict', 'revision_conflict'], ['suppressed', 'memory_suppressed'],
  ['not_found', 'memory_not_found'], ['invalid', 'invalid_input']]);

function response(name, envelope, metadata) {
  if (isContext(name) && bytes(envelope) > 65_536) {
    envelope = fail('context_item_too_large');
    metadata = undefined;
  }
  const text = envelope.ok ? formatBlock(envelope.value) : JSON.stringify({ ...envelope, evidenceTrust: trust });
  const result = textResult(text, !envelope.ok);
  const output = metadata ? { _meta: metadata, ...result } : result;
  return bytes(output) < 262_144 ? output : textResult(JSON.stringify(fail('response_too_large')));
}

function memory({ id, scope, kind, origin, confidence, revision, state, filing, receiptCount, createdAtMs, updatedAtMs, text }) {
  return { id, namespace: legacyNamespace(scope), kind, origin: origin === 'inferred' ? 'agent-inferred' : origin,
    confidence, revision, state, filing, receiptCount, createdAt: iso(createdAtMs), updatedAt: iso(updatedAtMs),
    ...(text !== undefined && { content: text }) };
}

function legacyReceipt({ id, client, sessionId, eventId, role, excerpt, createdAtMs }) {
  return { id, client, sessionId, eventId, role, excerpt, createdAt: iso(createdAtMs) };
}

function inspectResult(result) {
  if (result.mode === 'list') {
    return { memories: result.memories.map(memory), nextCursor: result.nextCursor, exhausted: result.exhausted };
  }
  const { receipts, placements, conflicts, qualification, procedural, supersession, nextReceiptCursor, exhausted } = result;
  const tag = procedural && { tagRevision: procedural.tagRevision, procedural: procedural.procedural,
    origin: procedural.origin, anchors: procedural.anchors };
  return {
    memory: memory(result.memory),
    receipts: receipts.map(legacyReceipt),
    ...(procedural !== undefined && { procedural: tag }),
    placements: placements.map(({ id, mocRevision, title }) => ({ mocId: id, mocRevision, title })), conflicts,
    ...(qualification !== undefined && { qualification }),
    ...(supersession !== undefined && { supersession }),
    nextReceiptCursor, exhausted,
  };
}

async function recallResult(recall, readSet, scope,
  { query, limit = 6, contextMode, includeQualification, selectionMode }) {
  const { diagnostics } = await recall.readContext(readSet, { query, types: ['memory'], intent: 'current',
    semantic: true, raw: false, representation: 'memory-compact-v1', budget: { maxItems: limit } });
  const { candidates, items: selected, omitted } = diagnostics;
  const refs = selected.slice().sort((a, b) => a.rank - b.rank).map(({ ref }) => ref);
  const { items, indexRevision } = await recall.inspect(readSet, refs, {
    includeQualification: includeQualification === true, includeIndexRevision: contextMode === 'rationale-evidence',
  });
  const mapExhausted = candidates.coverage.status === 'complete' &&
    Object.values(candidates.coverage.omitted).every(count => count === 0) &&
    omitted.items === 0 && omitted.unavailable === 0;
  const fetchExhausted = items.every(item => item.receipts.length === item.memory.receiptCount);
  if (contextMode && !fetchExhausted) return fail('context_item_too_large');
  const memories = items.map(({ memory: current, receipts, qualification }) => {
    const { id, revision, receiptCount } = current;
    if (!contextMode) return { memory: memory(current), receipts: receipts.map(legacyReceipt), receiptCount,
      ...(receipts.length < receiptCount && { receiptsOmitted: receiptCount - receipts.length }),
      ...(includeQualification && { qualification: qualification ?? null }) };
    const evidence = { memory: { id, revision, currentness: 'current' },
      receipts: receipts.map(({ id, role, excerpt }) => ({ id, role, excerpt })),
      receiptCount, interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' };
    if (contextMode === 'source-evidence') return evidence;
    // This installed service retains the root receipts but has no rationale edge store.
    return { ...evidence, rationale: { root: { memoryId: id, revision }, status: 'unassessed',
      sources: [evidence], edges: [], coverage: 'linked-evidence-only', indexRevision } };
  });
  return ok({ memories, namespaces: [{ namespace: legacyNamespace(scope), mapExhausted, fetchExhausted }],
    ...(selectionMode && { selection: { mode: selectionMode, strategy: candidates.trace.effective, semanticCoverage: 'unassessed' } }),
    coverage: mapExhausted && fetchExhausted ? 'complete' : 'budget_exhausted' });
}

function fetchInput(args, readSet, handles) {
  if (args.snapshot !== undefined) {
    const snapshot = handles.get('snapshot', args.snapshot);
    if (!snapshot) return fail('snapshot_stale');
    return { ...args, snapshot };
  }
  function refOf(ref) {
    if (Object.hasOwn(ref, 'ns')) {
      if (ref.ns >= readSet.namespaces.length) return;
      return { type: ref.type, scope: { owner: readSet.owner, namespace: readSet.namespaces[ref.ns] },
        id: ref.id, revision: ref.rev, ...(ref.type === 'card' && { bodyRevision: ref.bodyRev }) };
    }
    const { type, namespace, memoryId, cardId, revision, bodyRevision } = ref;
    const { ownerId: owner, scope, projectId } = namespace;
    if ((scope === 'personal') !== (projectId === null)) return;
    return { type, scope: { owner, namespace: scope + '\0' + (projectId ?? '') },
      id: memoryId ?? cardId, revision, ...(type === 'card' && { bodyRevision }) };
  }
  const refs = args.refs.map(refOf);
  if (refs.some(ref => ref === undefined)) return fail('invalid_input');
  const fences = args.refs.map(ref => ref.f ?? null);
  return { ...args, refs, ...(fences.some(fence => fence !== null) && { fences }) };
}

export function missingAuthority(name) {
  return response(name, fail('authority_required'));
}

export async function callTool(service, scope, handles, name, args, checkpointForget, recall) {
  const readSet = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [0] };
  const reply = value => response(name, ok(value));
  const refuse = code => response(name, fail(code));
  try {
    switch (name) {
      case 'recall_memory': {
        const { query, contextMode, includeQualification, selectionMode } = args;
        const badContext = contextMode && includeQualification === true;
        const badSelection = selectionMode && !contextMode;
        if (!query.trim() || badContext || badSelection) return refuse('invalid_input');
        if (!recall) return refuse('model_not_configured');
        return response(name, await recallResult(recall, readSet, scope, args));
      }
      case 'remember_memory': {
        const result = await service.save(scope, args.content, source, args.kind ?? 'fact',
          { receipt: receipt(), ...(args.procedural && { procedural: args.procedural }) });
        if (!result.item) return refuse(writeErrors.get(result.status) ?? 'memory_operation_failed');
        const { id, revision } = result.item;
        return reply({ memory: { id, revision }, deduplicated: result.status === 'duplicate', indexRevision: result.indexRevision });
      }
      case 'correct_memory': {
        const result = await service.correct(scope, args.memoryId, args.expectedRevision, args.content, source,
          { receipt: receipt(), kind: args.kind ?? 'fact' });
        if (!result.item) return refuse(writeErrors.get(result.status) ?? 'memory_operation_failed');
        const { memory: current } = await service.inspect(scope, { memoryId: result.item.id });
        if (current.revision !== result.item.revision) return refuse('revision_conflict');
        return reply({ memory: memory(current), indexRevision: result.indexRevision });
      }
      case 'forget_memory': {
        const { memoryId, expectedRevision } = args;
        const result = await service.forget(scope, memoryId, source, { expectedRevision });
        if (result.status !== 'forgotten' && result.status !== 'not_found') {
          return refuse(writeErrors.get(result.status) ?? 'memory_operation_failed');
        }
        await checkpointForget?.();
        return reply({ forgotten: result.status === 'forgotten', indexRevision: result.indexRevision });
      }
      case 'inspect_memory':
        return reply(inspectResult(await service.inspect(scope, args)));
      case 'find_memory_candidates': {
        const { cursor: handle, ...query } = args;
        const cursor = handle === undefined ? undefined : handles.get('cursor', handle);
        if (handle !== undefined && !cursor) return refuse('cursor_stale');
        const { version, items, channels, coverage, trace, nextCursor } =
          await service.findCandidates(readSet, { ...query, ...(cursor && { cursor }) });
        return reply({ version, items: items.map(item => ({ ...item, ref: legacyRef(item.ref, true) })),
          channels, coverage, trace, nextCursor: handles.issue('cursor', nextCursor) });
      }
      case 'fetch_memory_candidate_evidence': {
        const input = fetchInput(args, readSet, handles);
        if (input.ok === false) return response(name, input);
        const { items, snapshot } = await service.fetchEvidence(readSet, input);
        return reply({ items: items.map(legacyEvidence), snapshot: handles.issue('snapshot', snapshot) });
      }
      case 'read_memory_context': {
        const { maxTokens, maxItems, ...query } = args;
        const budget = { ...(maxTokens !== undefined && { maxTokens }), ...(maxItems !== undefined && { maxItems }) };
        const { assembly, diagnostics, snapshot } = await service.readContext(readSet, { ...query, budget });
        const items = diagnostics.items.map(item => ({ ...item, ref: legacyRef(item.ref) }));
        return response(name, ok(assembly), {
          [diagnosticsKey]: { ...diagnostics, items },
          [snapshotKey]: handles.issue('snapshot', snapshot),
        });
      }
    }
  } catch (error) {
    const code = error.code === 'invalid_text' ? 'invalid_input' : error.code ?? 'memory_operation_failed';
    const assembly = name === 'read_memory_context';
    const details = error.diagnostics;
    return response(name, fail(code, error.retryable === true, assembly ? undefined : details),
      assembly && details ? { [diagnosticsKey]: { candidates: details } } : undefined);
  }
}
