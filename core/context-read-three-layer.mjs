import { performance } from 'node:perf_hooks';
import { assertContentPort } from './content-safety-boundary.mjs';
import { assembleContext, ASSEMBLY_FRAMING, meteredText, cardSourceKeys, memoryPackKey, sourceDateFields } from './context-read-assembly.mjs';
import { ASSEMBLY_DEFAULTS, ASSEMBLY_LIMITS, CONTEXT_VERSION, namespaceKey } from './context-read-input.mjs';
import { createBM25, scoreBM25 } from './context-read-bm25.mjs';
import { tokenizeT1, termFrequencies } from './context-read-tokenize.mjs';
import { countTokens } from './model-budget.mjs';
import { fail } from './validation.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const binary = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const port = work => assertContentPort({ invoke: work });
const turnKey = value => JSON.stringify([namespaceKey(value.namespace), value.conversationId, value.messageId]);
const sessionKey = value => JSON.stringify([namespaceKey(value.namespace), value.conversationId]);
export const countListQuestion = query => /\b(how many|how often|number of|count|total|list|all)\b|\bwhich\b[\s\S]*\bever\b|\bwhich\b|\bhow much\b(?!\s+(earlier|later|more|less|longer|shorter)\b)/iu.test(query);
const unavailable = raw => ({ items: [], coverage: raw });

// The host owns this already-open service and its credentials/lifecycle. No
// search-index internals, crypto, capture, maintenance or evaluation code here.
// Keep time for Memory assembly, including when a provider never settles.
export async function readRawChannel(rawSearch, input, token, deadlineAt) {
  if (!rawSearch || input.raw === false) return unavailable('unavailable');
  const at = performance.now(), cutoff = Math.min(deadlineAt - 50, at + Math.max(0, (deadlineAt - at) * .4));
  if (cutoff <= at) return unavailable('partial');
  let timer, stopped = false;
  const items = [];
  // Snapshot at every stop: an in-flight prepare may settle after the timer.
  const snapshot = coverage => items.length || coverage === 'included'
    ? { items: items.slice(), coverage, rawSearch } : unavailable(coverage);
  const expired = () => stopped || performance.now() >= cutoff;
  const work = async () => {
    try {
      const result = await port(() => rawSearch.search({ query: input.query, intent: 'current' }, token));
      if (expired()) return snapshot('partial');
      if (result.coverage?.status === 'unsupported_store') return unavailable('unsupported_store');
      let dropped = result.coverage?.status !== 'complete';
      const candidates = result.candidates.slice(0, 24).filter(candidate => {
        if (input.readSet.some(ns => same(ns, candidate.namespace))) return true;
        dropped = true; return false;
      });
      let completed = 0;
      const processed = new Set();
      const onPrepared = (handle, index) => {
        if (expired()) return;
        if (!Number.isInteger(index) || index < 0 || index >= candidates.length || processed.has(index)) { dropped = true; return; }
        processed.add(index); completed++;
        const candidate = candidates[index];
        try {
          // Read only identity metadata here; one fresh batch validation
          // precedes all text projection below. Late handles are never read.
          if (!handle) { dropped = true; return; }
          const value = port(() => handle.value);
          if (!value || !input.readSet.some(ns => same(ns, value.namespace)) ||
              !same(value.namespace, candidate.namespace) || value.conversationId !== candidate.conversationId ||
              value.messageId !== candidate.messageId) { dropped = true; return; }
          if (expired()) return;
          items.push({ handle, value, key: turnKey(value), rank: items.length + 1 });
        } catch { dropped = true; }
      };
      // This loop is shared by local, facade and Worker readers. Keep the
      // original per-candidate failure and checked-prefix delivery semantics.
      const singles = async () => {
        for (let index = 0; index < candidates.length; index++) {
          if (expired()) return;
          if (processed.has(index)) continue;
          try {
            const handle = await port(() => rawSearch.prepare(candidates[index], { intent: 'current' }, token));
            onPrepared(handle, index);
          } catch { onPrepared(null, index); }
        }
      };
      if (candidates.length) {
        if (typeof rawSearch.prepareMany === 'function') {
          try {
            const batch = await port(() => rawSearch.prepareMany(candidates, { intent: 'current', deadlineAt: cutoff, onPrepared }, token));
            if (expired()) return snapshot('partial');
            dropped ||= !batch.complete || completed !== candidates.length;
          } catch (error) {
            // A host may expose an optional batch method it cannot honour.
            // Recover the unprocessed suffix through its existing port.
            if (typeof rawSearch.prepare !== 'function') throw error;
            await singles();
          }
        } else {
          if (typeof rawSearch.prepare !== 'function') fail('invalid_input');
          await singles();
        }
      }
      if (expired()) return snapshot('partial');
      return snapshot(dropped ? 'partial' : 'included');
    } catch (error) { return unavailable(error?.reason === 'deadline' ||
      ['search_deadline', 'read_timeout', 'timeout'].includes(error?.code) || error?.name === 'AbortError' ? 'partial' : 'unavailable'); }
  };
  try {
    return await Promise.race([work(), new Promise(resolve => {
      timer = setTimeout(() => { stopped = true; resolve(snapshot('partial')); }, Math.max(0, cutoff - performance.now()));
    })]);
  } finally { stopped = true; clearTimeout(timer); }
}

// Only authorized receipt rows enter this lookup, and only when Raw is present.
// The namespace join prevents a malformed lineage edge from coalescing owners.
export function citedRawTurns(db, namespace, rows, raw) {
  if (!raw?.items.length || !rows.length) return [];
  const found = db.prepare(`SELECT DISTINCT l.receipt_id,l.conversation_id,l.message_id FROM raw_receipt_lineage l
    JOIN raw_conversations c ON c.id=l.conversation_id
    WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND l.receipt_id IN (${rows.map(() => '?').join(',')})`)
    .all(namespace.ownerId, namespace.scope, namespace.projectId ?? '', ...rows.map(row => row.id));
  return [...new Set(rows.flatMap(row => {
    const linked = found.filter(value => value.receipt_id === row.id);
    return linked.length ? linked.map(value => turnKey({ namespace, conversationId: value.conversation_id, messageId: value.message_id }))
      : [JSON.stringify([namespaceKey(namespace), ['receipt', row.client, row.session_id], row.event_id])];
  }))];
}

// Exact slices, with lexical windows across the entire turn (including long
// assistant messages). All truncation uses code-point offsets, never token bytes.
export function queryExcerpt(text, query, counter, cap = 200, check = () => {}) {
  const terms = new Set(tokenizeT1(query)), starts = new Set([0]);
  for (const match of text.matchAll(/\p{Script=Han}|[\p{L}\p{N}]+/gu)) {
    check();
    const probe = /\p{Script=Han}/u.test(match[0]) ? text.slice(match.index, match.index + 4) : match[0];
    if (tokenizeT1(probe).some(term => terms.has(term))) {
      starts.add(Math.max(0, match.index - 160)); starts.add(match.index);
    }
  }
  const relevance = body => {
    const hits = tokenizeT1(body).filter(term => terms.has(term));
    return new Set(hits).size * 10000 + hits.length;
  };
  const windows = [...starts].map(start => {
    if (/[\uDC00-\uDFFF]/.test(text[start] ?? '')) start++;
    let end = Math.min(text.length, start + cap * 8);
    if (/[\uD800-\uDBFF]/.test(text[end - 1] ?? '')) end--;
    return { start, end };
  });
  let best;
  for (const window of windows) {
    check();
    const { start } = window; let { end } = window;
    if (countTokens(counter, text.slice(start, end)) > cap) {
      const offsets = [start]; let at = start;
      for (const cp of text.slice(start, end)) { at += cp.length; offsets.push(at); }
      let lo = 0, hi = offsets.length - 1;
      while (lo < hi) {
        check(); const mid = Math.ceil((lo + hi) / 2);
        if (countTokens(counter, text.slice(start, offsets[mid])) <= cap) lo = mid; else hi = mid - 1;
      }
      end = offsets[lo];
    }
    const body = text.slice(start, end), score = relevance(body);
    if (!best || score > best.score || score === best.score && start < best.start) best = { start, end, body, score };
  }
  return best;
}

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort(binary).map(key => [key, canonical(value[key])])) : value;
function memoryWire(item, representation, body = item.text) {
  const metadata = {}, defaults = ASSEMBLY_DEFAULTS.metadata[item.type];
  for (const key of item.type === 'memory' ? ['state', 'reviewState', 'filing', 'kind', 'origin', 'confidence'] : ['state', 'support', 'origin']) {
    const value = canonical(item.metadata[key]);
    if (!Object.hasOwn(defaults, key) || !same(value, canonical(defaults[key]))) metadata[key] = value;
  }
  if (item.metadata.origin === 'engine') for (const key of ['builtAt', 'clusterKey', 'status']) metadata[key] = item.metadata[key];
  return { ref: { ns: item.ns, type: item.type, id: item.ref.memoryId ?? item.ref.cardId, rev: item.ref.revision,
    ...(item.type === 'card' ? { bodyRev: item.ref.bodyRevision } : {}), f: item.fence.slice(0, 8) }, rank: item.rank,
    ...(representation === 'representation-v2-dated' && item.date ? { date: item.date } : {}), body,
    ...(Object.keys(metadata).length ? { metadata } : {}),
    sources: item.sources.map(source => ({ index: source.index, ...sourceDateFields(source, representation), role: source.role,
      ...(source.excerpt === body ? { sameAsBody: true } : { excerpt: source.excerpt }) })),
    ...(item.sourceAccess !== 'available' ? { sourceAccess: item.sourceAccess } : {}),
    ...(!item.sourcesComplete ? { sourcesComplete: false } : {}) };
}
const overlap = (a, b) => {
  let intersection = 0; for (const term of a) if (b.has(term)) intersection++;
  return intersection / (a.size + b.size - intersection || 1);
};
const datedOrder = (a, b) => a.date && b.date ? binary(a.date, b.date) || a.rank - b.rank : a.date ? -1 : b.date ? 1 : a.rank - b.rank;

// Cards share ordinary ranking. Their bound Memory sources are removed only
// from a trial pack that actually contains the Card and fits its budget.
export function assembleThreeLayerContext(args, raw = unavailable('unavailable')) {
  const fallback = coverage => {
    const value = assembleContext({ ...args, responseBytes: args.responseBytes && (trial => args.responseBytes({ ...trial,
      diagnostics: { ...trial.diagnostics, coverage: { raw: coverage } } })) });
    value.diagnostics.coverage = { raw: coverage };
    return { ...value, validateRaw: () => true };
  };
  if (!raw.items.length) return fallback(raw.coverage);
  // Expanded-source previews can expose 32 candidates. Keep their existing
  // Memory-only packing until coalesced snapshots support more than 24 refs.
  if (args.prepared.length > ASSEMBLY_LIMITS.maxItems) return fallback('partial');
  const started = performance.now(); let counterCalls = 0;
  const assemblyCutoff = args.deadlineAt - Math.min(250, Math.max(25, (args.deadlineAt - started) * .25));
  const check = () => { if (performance.now() >= assemblyCutoff) throw Error('assembly_deadline'); };
  const counter = { id: args.counter.id, countTokens(text) { check(); counterCalls++; return countTokens(args.counter, text); } };
  try {
    // Revalidate before reading any text. Batch validation prevents a later
    // handle's callback from invalidating an earlier handle unnoticed.
    const values = port(() => raw.rawSearch.revalidate(raw.items.map(item => item.handle)));
    const excerpts = raw.items.map((item, index) => {
      check(); const value = values[index];
      if (!value || !same(value.namespace, item.value.namespace) || value.conversationId !== item.value.conversationId ||
          value.messageId !== item.value.messageId) throw Error('raw_changed');
      // Merge only adjacent exact ranges; never fabricate a contiguous span
      // across a missing or excluded part of a message.
      const ranges = [];
      for (const range of value.ranges) {
        const start = range.source.span.start, last = ranges.at(-1);
        if (last && last.start + last.text.length === start) last.text += range.text;
        else ranges.push({ start, text: range.text });
      }
      const spans = ranges.map(range => ({ ...queryExcerpt(range.text, args.query, counter, 200, check), offset: range.start }));
      spans.sort((a, b) => b.score - a.score || a.offset + a.start - b.offset - b.start);
      const span = spans[0]; if (!span) throw Error('raw_empty');
      return { key: item.key, handle: item.handle, session: sessionKey(value), rank: item.rank,
        wire: { ref: { ns: args.readSet.findIndex(ns => same(ns, value.namespace)), type: 'raw',
          conversationId: value.conversationId, messageId: value.messageId }, role: value.role,
          ...(value.occurredAt ? { occurredAt: value.occurredAt,
            ...(args.representation === 'representation-v2-dated' ? { date: value.occurredAt.slice(0, 16) + 'Z' } : {}) } : {}),
          start: span.offset + span.start, end: span.offset + span.end, body: span.body }, date: value.occurredAt ? value.occurredAt.slice(0, 16) + 'Z' : null };
    });
    const units = [];
    for (const memory of [...args.prepared].sort((a, b) => a.rank - b.rank)) {
      check(); const turns = memory.turnIds ?? [];
      const linked = units.filter(unit => turns.some(turn => unit.turns.includes(turn)));
      const unit = linked[0] ?? { id: JSON.stringify(memory.ref), rank: memory.rank, memories: [], turns: [], evidence: [] };
      if (!linked.length) units.push(unit);
      unit.memories.push(memory);
      for (const other of linked.slice(1)) { unit.memories.push(...other.memories); units.splice(units.indexOf(other), 1); }
      unit.turns = [...new Set(unit.memories.flatMap(item => item.turnIds ?? []))];
    }
    const owner = new Map(units.flatMap(unit => unit.turns.map(turn => [turn, unit])));
    for (const excerpt of excerpts) {
      let unit = owner.get(excerpt.key);
      if (!unit) {
        unit = { id: excerpt.key, rank: args.prepared.length + excerpt.rank, memories: [], turns: [excerpt.key], evidence: [] };
        units.push(unit); owner.set(excerpt.key, unit);
      }
      unit.evidence.push(excerpt);
    }
    // Build the same projection for initial units and for a Card's surviving
    // sources. Recompute identity and chronology rather than retaining fields
    // from a group that still included a covered Memory.
    const buildUnit = unit => {
      unit.memories.sort((a, b) => a.rank - b.rank);
      unit.id = unit.memories.length ? JSON.stringify(unit.memories[0].ref) : unit.evidence[0].key;
      unit.rank = unit.memories[0]?.rank ?? args.prepared.length + unit.evidence[0].rank;
      unit.turns = [...new Set([...unit.memories.flatMap(item => item.turnIds ?? []), ...unit.evidence.map(item => item.key)])];
      const bodies = [];
      for (const memory of unit.memories) if (!bodies.some(body => body === memory.text ||
        overlap(new Set(tokenizeT1(body)), new Set(tokenizeT1(memory.text))) >= .6)) bodies.push(memory.text);
      unit.wire = unit.memories.length ? memoryWire(unit.memories[0], args.representation, bodies.join('\n'))
        : { layer: 'Raw', ...unit.evidence[0].wire };
      if (args.representation === 'representation-v2-dated' && unit.memories.length > 1) {
        // Coalescing retains the original bodies/excerpts. Date-only entries
        // keep secondary Memories' source dates, qualified by their own ref so
        // receipt indexes never silently refer to the primary Memory instead.
        for (const memory of unit.memories.slice(1)) {
          let ref;
          for (const source of memory.sources) {
            if (!source.date && !source.dates?.length) continue;
            ref ??= memoryWire(memory, args.representation).ref;
            unit.wire.sources.push({ memory: ref, index: source.index,
              ...sourceDateFields(source, args.representation), role: source.role });
            unit.wire.sourcesComplete = false;
          }
        }
      }
      unit.evidence.sort((a, b) => datedOrder({ date: a.date, rank: a.rank }, { date: b.date, rank: b.rank }));
      if (unit.memories.length && unit.evidence.length) unit.wire.evidence = unit.evidence.map(item => {
        if (item.wire.body !== unit.wire.body) return item.wire;
        const { body, ...ref } = item.wire; return { ...ref, sameAsBody: true };
      });
      unit.date = [...unit.memories.map(item => item.sortDate ?? item.date), ...unit.evidence.map(item => item.date)].filter(Boolean).sort(binary)[0];
      // Preserve the date this unit already delivered from receipts/attached
      // Raw. Lineage-only dates fill the previously undated case.
      const existingDate = [...unit.memories.map(item => Object.hasOwn(item, 'receiptDate') ? item.receiptDate : item.date),
        ...unit.evidence.map(item => item.date)].filter(Boolean).sort(binary)[0];
      const itemDate = existingDate ?? unit.memories.map(item => item.date).filter(Boolean).sort(binary)[0];
      if (args.representation === 'representation-v2-dated' && itemDate) unit.wire.date = itemDate.slice(0, 16) + 'Z';
      unit.lexicalText = [...bodies, ...unit.evidence.map(item => item.wire.body)].join(' ');
      unit.terms = new Set(tokenizeT1(unit.lexicalText));
      unit.cost = countTokens(counter, JSON.stringify(unit.wire));
      unit.sessions = [...new Set([...unit.evidence.map(item => item.session), ...unit.memories.flatMap(item =>
        item.turnIds?.length ? item.turnIds.map(turn => { const [namespace, conversation] = JSON.parse(turn); return JSON.stringify([namespace, conversation]); })
          : item.sessionIds ?? [])])];
      return unit;
    };
    units.forEach(buildUnit);
    const documents = units.map(unit => ({ id: unit.id, text: unit.lexicalText })), bm = createBM25(documents), terms = tokenizeT1(args.query);
    const scores = units.map(unit => scoreBM25(terms, termFrequencies(unit.lexicalText), bm) ?? 0), max = Math.max(1e-12, ...scores);
    units.forEach((unit, i) => { unit.bm25 = scores[i] / max; unit.prior = unit.memories[0]?.type === 'memory' ? 61 / (60 + unit.rank) : 0; });
    const selected = [], remaining = [...units], sessions = new Set(), turns = new Set();
    const stops = { budget: false, items: false, deadline: false }, breadth = countListQuestion(args.query);
    const deduped = proposed => {
      const covered = cardSourceKeys(proposed.flatMap(unit => unit.memories));
      if (!covered.size) return proposed;
      return proposed.flatMap(unit => {
        const members = unit.memories.filter(item => item.type !== 'memory' || !covered.has(memoryPackKey(item.ref)));
        if (members.length === unit.memories.length) return [unit];
        if (!members.length && !unit.evidence.length) return [];
        return [buildUnit({ memories: members, evidence: unit.evidence.slice() })];
      });
    };
    const payload = proposed => ({ framing: ASSEMBLY_FRAMING, items: [...deduped(proposed)]
      .sort(args.representation === 'representation-v2-dated' ? datedOrder : (a, b) => a.rank - b.rank).map(unit => unit.wire) });
    const memories = proposed => deduped(proposed).flatMap(unit => unit.memories);
    const diagnostics = (proposed, used) => ({ version: CONTEXT_VERSION, policy: { id: args.policy.id }, representation: args.representation,
      counter: { id: counter.id }, items: memories(proposed).map(item => ({ ref: item.ref, metadata: item.metadata })),
      budget: { ...args.budget, used }, omitted: { items: units.length - proposed.length, bodies: units.length - proposed.length,
        sources: 0, unavailable: 0, oversized: 0 }, dedup: { sources: 0, body: 0 }, stops,
      coverage: { raw: raw.coverage }, trace: { timings: { assemblyMs: performance.now() - started }, counterCalls } });
    const fits = proposed => {
      check(); const metered = payload(proposed), text = meteredText(metered), used = countTokens(counter, text);
      const details = diagnostics(proposed, used);
      // Reserve volatile diagnostic scalar bytes without imposing a second cap
      // on the host's signed snapshot or complete response envelope.
      details.trace.timings.assemblyMs = -0.0000010000000000000002;
      details.trace.counterCalls = 999999999;
      const bytes = !args.responseBytes || args.responseBytes({ meteredBytes: Buffer.byteLength(JSON.stringify(metered)),
        diagnostics: details, selected: memories(proposed) });
      return { metered, used, fits: used <= args.budget.maxTokens && bytes };
    };
    if (!fits([]).fits) fail('context_item_too_large');
    while (remaining.length && selected.length < args.budget.maxItems) {
      check();
      remaining.sort((a, b) => {
        const score = unit => unit.bm25 + unit.prior - .15 * unit.cost / 250
          + (breadth ? .30 : .15) * unit.sessions.filter(session => !sessions.has(session)).length
          + .05 * unit.turns.filter(turn => !turns.has(turn)).length
          - .30 * Math.max(0, ...selected.map(other => overlap(unit.terms, other.terms)));
        return score(b) - score(a) || a.rank - b.rank || binary(a.id, b.id);
      });
      const unit = remaining.shift();
      const covered = cardSourceKeys(unit.memories), cardRank = Math.min(...unit.memories.filter(item => item.type === 'card').map(item => item.rank));
      if (covered.size && selected.some(other => other.memories.some(item => item.type === 'memory' &&
        item.rank < cardRank && covered.has(memoryPackKey(item.ref))))) continue;
      if (!fits([...selected, unit]).fits) { stops.budget = true; continue; }
      selected.push(unit); unit.sessions.forEach(session => sessions.add(session)); unit.turns.forEach(turn => turns.add(turn));
    }
    stops.items = remaining.length > 0;
    const value = fits(selected), delivered = memories(selected);
    const snapshot = delivered.length ? args.snapshotOf(delivered) : null;
    // Omitted Raw units still shape the returned counts, so every prepared
    // handle is revalidated; a denial anywhere falls back to Memory-only.
    const handles = [...new Set(units.flatMap(unit => unit.evidence.map(item => item.handle)))];
    return { metered: value.metered, snapshot, selected: delivered, diagnostics: diagnostics(selected, value.used),
      validateRaw() {
        try { check(); port(() => raw.rawSearch.revalidate(handles)); return true; } catch { return false; }
      } };
  } catch (error) {
    if (['context_item_too_large', 'token_count_unavailable'].includes(error.code)) throw error;
    return fallback('partial');
  }
}
