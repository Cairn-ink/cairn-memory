import { CoreError } from "../errors.mjs";
import { createBM25, scoreBM25 } from "../retrieval/bm25.mjs";
import { termFrequencies, tokenizeT1 } from "../retrieval/tokenize.mjs";
import { compareUtf8 } from "../utf8.mjs";
import { CONTEXT_HORIZON, namespaceSlot } from "./context-read-input.mjs";
import { fitCardAmendments } from "./context-read-pack.mjs";
import { canReplaceCitedMemory, cardHits, citesMemory, compareDates, FRAMING, minute, sourceDate, turnKey,
  wireItem } from "./context-read-projection.mjs";

/** @import { CallOptions, ContextAssemblyRawExcerpt, ContextAssemblyRepresentation, ContextRawCoverage,
  ContextRawReadStore, ContextRawTurn, ContextReadSet, UnitOfWork } from "../ports/index.d.ts" */
/** @import { PackDiagnostics, PackOptions, Projection, meter } from "./context-read-pack.mjs" */
/** @import { PreparedItem } from "./context-read-projection.mjs" */
/** @typedef {{ turns: readonly ContextRawTurn[], coverage: ContextRawCoverage }} Channel */
/** @typedef {ContextAssemblyRawExcerpt & { body: string }} RawExcerpt */
/** @typedef {{key: string, session: string, rank: number, wire: RawExcerpt}} Excerpt */
/** @typedef {{members: PreparedItem[], evidence: Excerpt[], turns: string[]}} Group */

const deadline = new Error("raw assembly deadline");

/** @param {ContextRawReadStore | undefined} store @param {UnitOfWork} uow @param {ContextReadSet} readSet
 * @param {string} query @param {boolean} lexicalOnly @param {CallOptions} options @param {() => number} now
 * @param {number} end @returns {Promise<Channel>} */
export async function readRawChannel(store, uow, readSet, query, lexicalOnly, options, now, end) {
  if (!store) return { turns: [], coverage: "unavailable" };
  // Legacy context-read-three-layer.mjs:21–102. Scope, cap and timeout apply
  // to the qualified search and preparation together.
  const started = now();
  const cutoff = Math.min(end - 50, started + (end - started) * 0.4);
  /** @type {Channel} */
  const partial = { turns: [], coverage: "partial" };
  if (cutoff <= started || options.signal?.aborted) return partial;
  const timeout = AbortSignal.timeout(Math.max(1, Math.ceil(cutoff - now())));
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let onAbort = () => {};
  try {
    const search = uow.run(readSet.owner, { readOnly: true }, async tx => {
      const result = await store.search(tx, readSet, query, { limit: CONTEXT_HORIZON, lexicalOnly, deadlineAtMs: cutoff, signal });
      if (now() >= cutoff || signal.aborted) return partial;
      if (result.coverage !== "included" && result.coverage !== "partial") {
        return { turns: [], coverage: result.coverage };
      }
      const keys = new Set();
      const turns = result.turns.slice(0, CONTEXT_HORIZON).filter(turn => {
        const key = turnKey(turn);
        if (namespaceSlot(readSet, turn.scope) < 0 || keys.has(key) || !turn.ranges.length) return false;
        keys.add(key);
        return true;
      });
      const coverage = turns.length < result.turns.length && result.coverage === "included" ? "partial" : result.coverage;
      return { turns: structuredClone(turns), coverage };
    });
    return await Promise.race([search, new Promise(resolve => {
      onAbort = () => resolve(partial);
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    })]);
  } catch {
    return now() >= cutoff || signal.aborted ? partial : { turns: [], coverage: "unavailable" };
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/** @param {Set<string>} a @param {Set<string>} b */
function overlap(a, b) {
  let common = 0;
  for (const term of a) if (b.has(term)) common++;
  return common / (a.size + b.size - common || 1);
}

/** @param {string} text @param {Set<string>} terms @param {(text: string) => number} count @param {() => void} check */
function querySpan(text, terms, count, check) {
  // Legacy context-read-three-layer.mjs:120–158. Probe exact UTF-16 slices
  // near lexical hits and avoid splitting surrogate pairs at either edge.
  const starts = new Set([0]);
  for (const hit of text.matchAll(/\p{Script=Han}|[\p{L}\p{N}]+/gu)) {
    check();
    const probe = /\p{Script=Han}/u.test(hit[0]) ? text.slice(hit.index, hit.index + 4) : hit[0];
    if (tokenizeT1(probe).some(term => terms.has(term))) {
      starts.add(Math.max(0, hit.index - 160));
      starts.add(hit.index);
    }
  }
  let best;
  for (let start of starts) {
    check();
    if (/[\uDC00-\uDFFF]/u.test(text[start] ?? "")) start++;
    let end = Math.min(text.length, start + 1600);
    if (/[\uD800-\uDBFF]/u.test(text[end - 1] ?? "")) end--;
    if (count(text.slice(start, end)) > 200) {
      const offsets = [start];
      let offset = start;
      for (const character of text.slice(start, end)) {
        offset += character.length;
        offsets.push(offset);
      }
      let lo = 0, hi = offsets.length - 1;
      while (lo < hi) {
        check();
        const middle = Math.ceil((lo + hi) / 2);
        if (count(text.slice(start, offsets[middle])) <= 200) lo = middle;
        else hi = middle - 1;
      }
      end = offsets[lo];
    }
    if (end <= start) continue;
    const body = text.slice(start, end), matched = tokenizeT1(body).filter(term => terms.has(term));
    const score = new Set(matched).size * 10000 + matched.length;
    if (!best || score > best.score || (score === best.score && start < best.start)) best = { start, end, body, score };
  }
  return best;
}

/** @param {ContextRawTurn} turn @param {number} i @param {ContextReadSet} readSet @param {Set<string>} terms
 * @param {ContextAssemblyRepresentation} representation @param {(text: string) => number} count @param {() => void} check
 * @returns {Excerpt | null} */
function excerptFor(turn, i, readSet, terms, representation, count, check) {
  /** @type {{ start: number, text: string }[]} */
  const ranges = [];
  for (const range of turn.ranges) {
    const previous = ranges.at(-1);
    // Coalesce only adjacent authorized ranges, preserving gaps.
    if (previous && previous.start + previous.text.length === range.start) previous.text += range.text;
    else ranges.push({ ...range });
  }
  const spans = ranges.flatMap(({ start, text }) => {
    const span = querySpan(text, terms, count, check);
    return span ? [{ ...span, start: start + span.start, end: start + span.end }] : [];
  });
  const span = spans.sort((a, b) => b.score - a.score || a.start - b.start)[0];
  if (!span) return null;
  const { scope, conversationId, messageId, role, occurredAtMs } = turn;
  return { key: turnKey(turn), session: JSON.stringify([scope.namespace, conversationId]), rank: i + 1,
    wire: { ref: { ns: namespaceSlot(readSet, scope), type: "raw", conversationId, messageId }, role,
      ...(occurredAtMs !== null && { occurredAt: new Date(occurredAtMs).toISOString(),
        ...(representation === "representation-v2-dated" && { date: minute(occurredAtMs) }) }),
      start: span.start, end: span.end, body: span.body } };
}

/** @param {readonly PreparedItem[]} items @param {Excerpt[]} excerpts @param {boolean} rankWhole */
function groupContext(items, excerpts, rankWhole) {
  /** @type {Group[]} */
  const groups = [];
  // Legacy context-read-three-layer.mjs:228–246. Only shared qualified
  // receipt lineage may merge two Memories or attach a Raw excerpt.
  for (const item of items) {
    const linked = rankWhole ? [] : groups.filter(group => item.turnIds.some(turn => group.turns.includes(turn)));
    const group = linked[0] ?? { members: [], turns: [], evidence: [] };
    if (!linked.length) groups.push(group);
    group.members.push(item);
    for (const other of linked.slice(1)) {
      group.members.push(...other.members);
      groups.splice(groups.indexOf(other), 1);
    }
    group.turns = [...new Set(group.members.flatMap(member => member.turnIds))];
  }
  /** @type {Map<string, Group>} */
  const owners = new Map();
  for (const group of groups) for (const turn of group.turns) {
    if (!owners.has(turn)) owners.set(turn, group);
  }
  for (const excerpt of excerpts) {
    const group = owners.get(excerpt.key);
    if (group) group.evidence.push(excerpt);
    else groups.push({ members: [], turns: [excerpt.key], evidence: [excerpt] });
  }
  return groups;
}

/** @param {Group} group @param {ContextAssemblyRepresentation} representation @param {number} count */
function projectUnit(group, representation, count) {
  const members = group.members.slice().sort((a, b) => a.rank - b.rank);
  const evidence = group.evidence.slice().sort((a, b) => compareDates(a.wire.occurredAt?.slice(0, 16), b.wire.occurredAt?.slice(0, 16)) || a.rank - b.rank);
  const first = members[0];
  /** @type {{ text: string, terms: Set<string> }[]} */
  const bodies = [];
  for (const { body } of members) {
    const terms = new Set(tokenizeT1(body));
    if (!bodies.some(other => body === other.text || overlap(terms, other.terms) >= 0.6)) bodies.push({ text: body, terms });
  }
  const text = bodies.map(body => body.text).join("\n");
  const rawDates = evidence.flatMap(({ wire }) => wire.occurredAt ? [minute(Date.parse(wire.occurredAt))] : []);
  const date = [...members.flatMap(item => item.sortDate ? [item.sortDate] : []), ...rawDates].sort(compareUtf8)[0];
  const turns = [...new Set([...members.flatMap(item => item.turnIds), ...evidence.map(item => item.key)])];
  const sessions = [...new Set([...evidence.map(item => item.session), ...members.flatMap(item =>
    item.turnIds.length ? item.turnIds.map(turn => JSON.stringify(JSON.parse(turn).slice(0, 2))) : item.sessionIds)])];
  const lexical = [...bodies.map(body => body.text), ...evidence.map(({ wire }) => wire.body)].join(" ");
  const rank = first ? first.rank : count + evidence[0].rank;
  const id = first ? JSON.stringify(first.compact) : evidence[0].key;

  if (!first) return { ...group, members, evidence, date, turns, sessions, lexical, rank, id,
    wire: { layer: /** @type {const} */ ("Raw"), ...evidence[0].wire } };

  // Legacy context-read-three-layer.mjs:247–289. Keep secondary date-only
  // sources qualified by their individual refs, then attach exact Raw slices.
  /** @type {import("../ports/index.d.ts").ContextAssemblySource[]} */
  const sources = first.sources.map(source => ({ index: source.index, ...sourceDate(source, representation), role: source.role,
    ...(source.excerpt === text ? { sameAsBody: true } : { excerpt: source.excerpt }) }));
  const primarySources = sources.length;
  if (representation === "representation-v2-dated") for (const member of members.slice(1)) {
    for (const source of member.sources) if (source.date || source.dates?.length) {
      sources.push({ memory: member.compact, index: source.index, ...sourceDate(source, representation), role: source.role });
    }
  }
  const originalDate = [...members.flatMap(item => item.receiptDate ? [item.receiptDate] : []), ...rawDates].sort(compareUtf8)[0];
  const itemDate = originalDate ?? members.flatMap(item => item.date ? [item.date] : []).sort(compareUtf8)[0];
  const attached = evidence.map(({ wire }) => {
    const { body, ...ref } = wire;
    return body === text ? { ...ref, sameAsBody: /** @type {const} */ (true) } : wire;
  });
  const wire = { ...wireItem(first, representation, sources, first.sourcesComplete && sources.length === primarySources, text),
    ...(attached.length && { evidence: attached }) };
  // Legacy updates an existing primary date in place and appends a new date after the evidence.
  if (representation === "representation-v2-dated" && itemDate) wire.date = itemDate;
  return { ...group, members, evidence, date, turns, sessions, lexical, rank, id, wire };
}

/** @param {readonly PreparedItem[]} items @param {Channel} raw @param {ContextReadSet} readSet @param {string} query
 * @param {PackOptions} options @param {ReturnType<typeof meter>} metering */
export function packRawContext(items, raw, readSet, query, options, metering) {
  const { now, representation, deadline: end, budget } = options;
  const { tokens, trace, stops, check } = metering;
  const cutoff = end - Math.min(250, Math.max(25, (end - now()) * 0.25));
  const active = () => { if (now() >= cutoff) throw deadline; };
  const count = (/** @type {string} */ text) => { active(); return tokens(text); };
  try {
    const terms = new Set(tokenizeT1(query));
    const excerpts = raw.turns.flatMap((turn, index) => {
      const excerpt = excerptFor(turn, index, readSet, terms, representation, count, active);
      return excerpt ? [excerpt] : [];
    });
    if (excerpts.length !== raw.turns.length) return null;
    const hasDocumentCards = items.some(item => item.evidence.documentCard);
    const rankWhole = options.policy === "rank-first-whole-v1" && hasDocumentCards;
    const groups = groupContext(items, excerpts, rankWhole);
    const docs = groups.map(group => {
      const unit = projectUnit(group, representation, items.length);
      return { unit, text: unit.lexical, ref: { namespace: null, type: /** @type {const} */ ("raw"), id: unit.id } };
    });
    // Legacy context-read-three-layer.mjs:295–298. Score every group against
    // the same corpus, including those beyond the final item ceiling.
    const corpus = createBM25(docs);
    const scores = docs.map(doc => scoreBM25(terms, termFrequencies(doc.text), corpus) ?? 0);
    const max = Math.max(1e-12, ...scores);
    const units = docs.map(({ unit }, i) => ({ ...unit, terms: new Set(tokenizeT1(unit.lexical)),
      cost: count(JSON.stringify(unit.wire)), bm25: scores[i] / max,
      prior: unit.members[0]?.compact.type === "memory" ? 61 / (60 + unit.rank) : 0, cardHit: false }));
    const hits = cardHits(items, budget.maxItems);
    const byMemory = new Map(units.flatMap(unit => unit.members.map(member => [member, unit])));
    for (const unit of units) {
      const hit = unit.members.map(card => hits.get(card)).filter(member => member !== undefined).sort((a, b) => a.rank - b.rank)[0];
      const source = hit && byMemory.get(hit);
      if (source) Object.assign(unit, { bm25: source.bm25, prior: source.prior, rank: source.rank, cardHit: true });
    }
    /** @typedef {typeof units[number]} Unit */
    /** @type {Unit[]} */
    const selected = [], remaining = units.slice();
    const sessions = new Set(), turns = new Set();
    const { ledger } = options;
    const breadth = /\b(how many|how often|number of|count|total|list|all|which)\b|\bhow much\b(?!\s+(earlier|later|more|less|longer|shorter)\b)/iu.test(query);
    /** @param {Unit[]} proposed @returns {Projection} */
    function project(proposed) {
      const cards = proposed.flatMap(unit => unit.members).filter(canReplaceCitedMemory);
      const surviving = proposed.flatMap(unit => {
        const members = unit.members.filter(item => !cards.some(card => citesMemory(card, item)));
        if (members.length === unit.members.length) return [unit];
        return members.length || unit.evidence.length ? [projectUnit({ ...unit, members }, representation, items.length)] : [];
      });
      const selected = surviving.flatMap(unit => unit.members);
      const rendered = surviving.slice().sort((a, b) =>
        (representation === "representation-v2-dated" ? compareDates(a.date, b.date) : 0) || a.rank - b.rank);
      const wire = rendered.map(unit => unit.wire);
      return { value: { framing: FRAMING, ...(ledger && { ledgerDigest: ledger }), items: wire }, selected,
        details: selected.map(({ evidence, metadata }) => ({ ref: evidence.item.ref, metadata })) };
    }
    /** @param {Projection} projection @param {number} size @returns {PackDiagnostics} */
    function diagnostics(projection, size) {
      const omitted = units.length - size;
      return { items: projection.details, omitted: { items: omitted, bodies: omitted, sources: 0, unavailable: 0, oversized: 0 },
        dedup: { sources: 0, body: 0 }, trace: trace(), stops };
    }
    const empty = project([]);
    if (!check(empty, p => diagnostics(p, 0))?.fits) {
      active();
      throw new CoreError("context_item_too_large");
    }
    // Legacy context-read-three-layer.mjs:310–365. Pack ranked units together,
    // including their provenance, and update diversity only on acceptance.
    let accepted = empty;
    const availableItems = budget.maxItems - Number(!!ledger);
    while (remaining.length) {
      const full = accepted.value.items.length >= availableItems;
      if (full && (!hasDocumentCards || !remaining.some(unit => unit.members[0]?.evidence.documentCard))) break;
      active();
      const score = (/** @type {Unit} */ unit) => unit.bm25 + unit.prior - (unit.cardHit ? 0 : 0.15 * unit.cost / 250)
        + (breadth ? 0.30 : 0.15) * unit.sessions.filter(session => !sessions.has(session)).length
        + 0.05 * unit.turns.filter(turn => !turns.has(turn)).length
        - 0.30 * Math.max(0, ...selected.map(other => overlap(unit.terms, other.terms)));
      remaining.sort((a, b) => {
        // Default document-card reads visit candidate bodies in lexical rank order.
        // Raw-only units keep their existing scoring and use the remaining budget.
        if (rankWhole && (a.members.length || b.members.length)) {
          return Number(!a.members.length) - Number(!b.members.length) || a.rank - b.rank;
        }
        return score(b) - score(a) || a.rank - b.rank || compareUtf8(a.id, b.id);
      });
      const unit = /** @type {Unit} */ (remaining.shift());
      const first = unit.members[0];
      if (full && !first?.evidence.documentCard) { stops.items = true; continue; }
      if (!unit.cardHit && unit.members.some(card => card.engine && accepted.selected.some(memory =>
        memory.rank < card.rank && citesMemory(card, memory)))) continue;
      const trial = project([...selected, unit]);
      if (trial.value.items.length > availableItems) { stops.items = true; continue; }
      if (trial.value.items.length === accepted.value.items.length &&
          trial.selected.length === accepted.selected.length && !unit.members.some(canReplaceCitedMemory)) continue;
      const value = check(trial, p => diagnostics(p, selected.length + 1));
      active();
      if (!value?.fits) { stops.budget = true; continue; }
      const amended = first?.evidence.amendments.length ? fitCardAmendments(first, value.used, budget, (body, sources) => {
        active();
        const revised = { ...unit, ...projectUnit({ ...unit, members: [{ ...first, body, sources }] }, representation, items.length) };
        const projection = project([...selected, revised]);
        const result = check(projection, p => diagnostics(p, selected.length + 1));
        active();
        return result ? { result, value: { revised, projection } } : null;
      }) : null;
      selected.push(amended?.revised ?? unit);
      accepted = amended?.projection ?? trial;
      unit.sessions.forEach(session => sessions.add(session));
      unit.turns.forEach(turn => turns.add(turn));
    }
    stops.items ||= remaining.length > 0;
    active();
    const final = check(accepted, p => diagnostics(p, selected.length));
    active();
    if (!final?.fits) throw new CoreError("context_item_too_large");
    return { ...accepted, used: final.used, diagnostics: diagnostics(accepted, selected.length) };
  } catch (error) {
    if (error === deadline) return null;
    throw error;
  }
}
