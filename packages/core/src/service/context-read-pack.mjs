import { isWellFormedText } from "../capture/validate.mjs";
import { renderCardAmendments } from "../routing/amendment-read.mjs";
import { CoreError } from "../errors.mjs";
import { canReplaceCitedMemory, cardHits, citesMemory, compareDates, FRAMING, sourceDate, wireItem } from "./context-read-projection.mjs";

/** @import { ContextAssemblyDiagnostics, ContextAssemblyPolicy, ContextAssemblyRepresentation,
  ContextAssemblySource, ContextAssemblyValue, ContextLedgerDigest } from "../ports/index.d.ts" */
/** @import { PreparedItem, Source } from "./context-read-projection.mjs" */
/** @typedef {Pick<ContextAssemblyDiagnostics, "items" | "omitted" | "dedup" | "stops" | "trace">} PackDiagnostics */
/** @typedef {{ maxTokens: number, maxItems: number }} Budget */
/** @typedef {{ value: ContextAssemblyValue, details: PackDiagnostics["items"], selected: PreparedItem[], amendmentSourceCount?: number }} Projection */
/** @typedef {{ budget: Budget, policy: ContextAssemblyPolicy, representation: ContextAssemblyRepresentation,
 * now: () => number, deadline: number, ledger?: ContextLedgerDigest,
 * format: (value: ContextAssemblyValue) => string, count: (text: string) => number,
 * fitsBytes: (value: ContextAssemblyValue, text: string, details: PackDiagnostics, selected: PreparedItem[], used: number) => boolean }} PackOptions */
/** @typedef {{ tokens: number, sources: { source: Source, tokens: number }[],
 * body?: string, amendmentSources?: Source[] }} Choice */

/** @template T
 * @param {PreparedItem} item @param {number} bareTokens @param {Budget} budget
 * @param {(body: string, sources: Source[]) => { result: { used: number, fits: boolean }, value: T } | null} trySuffix */
export function fitCardAmendments(item, bareTokens, budget, trySuffix) {
  const selected = { value: /** @type {T | null} */ (null) };
  renderCardAmendments({
    amendments: item.evidence.amendments,
    maxTokens: budget.maxTokens - bareTokens,
    countTokens(suffix, amendments) {
      const sources = amendments.map(({ date, quote }, i) => ({
        index: item.sources.length + i, role: /** @type {const} */ ("user"), excerpt: quote, date,
      }));
      const trial = trySuffix(item.body + "\n\n" + suffix, sources);
      if (!trial?.result.fits) return Infinity;
      selected.value = trial.value;
      return Math.max(0, trial.result.used - bareTokens);
    },
  });
  return selected.value;
}

/** @param {object} value */
function freezeTree(value) {
  for (const inner of Object.values(value)) if (inner && typeof inner === "object" && !Object.isFrozen(inner)) freezeTree(inner);
  return Object.freeze(value);
}

/** @param {PackOptions} options */
export function meter({ budget, now, deadline, format, count, fitsBytes }) {
  const started = now(), stops = { budget: false, items: false, deadline: false };
  let counterCalls = 0;
  const expired = () => stops.deadline ||= now() >= deadline;
  /** @param {string} text */
  function tokens(text) {
    counterCalls++;
    try {
      /** @type {unknown} */
      const total = count(text);
      if (typeof total === "number" && Number.isSafeInteger(total) && total >= 0) return total;
      if (total instanceof Promise) void total.catch(() => {});
    } catch {
      // Keep host error details out of the service error.
    } finally {
      expired();
    }
    throw new CoreError("token_count_unavailable");
  }
  /** @param {ContextAssemblyValue} value */
  function block(value) {
    try {
      freezeTree(value);
      /** @type {unknown} */
      const text = format(value);
      if (isWellFormedText(text)) return text;
      if (text instanceof Promise) void text.catch(() => {});
    } catch {
      // Format is a synchronous part of the same metering boundary.
    }
    throw new CoreError("token_count_unavailable");
  }
  const trace = () => ({ timings: { assemblyMs: now() - started }, counterCalls });
  /** @param {Projection} projection @param {(projection: Projection) => PackDiagnostics} diagnostics
   * @param {{ required?: boolean, reusedCount?: number }} [options] */
  function check(projection, diagnostics, { required = false, reusedCount } = {}) {
    if (expired() && !required) return null;
    const text = block(projection.value);
    if (expired() && !required) return null;
    const used = reusedCount ?? tokens(text);
    const bytes = fitsBytes(projection.value, text, diagnostics(projection), projection.selected, used);
    return { used, fits: used <= budget.maxTokens && bytes };
  }
  return { stops, expired, tokens, trace, check };
}

/** @param {ContextLedgerDigest | undefined} ledger @param {Projection} empty
 * @param {(projection: Projection) => PackDiagnostics} diagnostics @param {ReturnType<typeof meter>} metering */
export function fitLedgerDigest(ledger, empty, diagnostics, { check, expired, stops }) {
  if (!ledger) return;
  const trial = { ...empty, value: { framing: empty.value.framing, ledgerDigest: ledger, items: empty.value.items } };
  const measured = check(trial, diagnostics);
  if (!measured || expired()) return;
  if (measured.fits) return ledger;
  stops.budget = true;
}

/** @param {readonly PreparedItem[]} items @param {PackOptions} options
 * @param {ReturnType<typeof meter>} metering */
export function packContext(items, options, metering) {
  const { budget, policy, representation } = options;
  const { stops, expired, tokens, trace, check } = metering;
  const dated = representation === "representation-v2-dated";
  const hits = cardHits(items, budget.maxItems);
  // Legacy context-read-assembly.mjs:146–155. Only the packing position changes.
  const prepared = items.filter(item => !hits.has(item)).flatMap(item =>
    [...[...hits].filter(([, memory]) => memory === item).map(([card]) => card), item]);
  /** @type {Map<PreparedItem, Choice>} */
  let chosen = new Map();
  let oversized = 0;
  /** @type {ContextLedgerDigest | undefined} */
  let ledger;
  const totalSources = prepared.reduce((total, item) => total + item.sources.length, 0);

  /** @param {ReadonlyMap<PreparedItem, Choice>} selection @returns {Projection} */
  function project(selection) {
    const selected = prepared.filter(item => selection.has(item));
    const rendered = dated ? selected.slice().sort((a, b) => compareDates(a.sortDate, b.sortDate)) : selected;
    /** @type {Map<string, {item: number, source: number}>} */
    const concrete = new Map();
    /** @type {PackDiagnostics["items"][number][]} */
    const details = [];
    const wire = rendered.map((item, itemIndex) => {
      const { tokens, sources: included, body = item.body, amendmentSources = [] } = /** @type {Choice} */ (selection.get(item));
      const eligibleSources = [...item.sources, ...amendmentSources];
      /** @type {NonNullable<PackDiagnostics["items"][number]["sources"]>[number][]} */
      const sourceDetails = [];
      // Legacy context-read-assembly.mjs:179–199. Dedup pointers use the
      // rendered slots after sorting, including slots occupied by dates alone.
      /** @type {{ source: Source, tokens?: number }[]} */
      const projected = [];
      for (const source of eligibleSources) {
        const chosenSource = included.find(value => value.source === source);
        if (chosenSource) projected.push(chosenSource);
        else if (dated && (source.date || source.dates?.length)) projected.push({ source });
      }
      /** @type {ContextAssemblySource[]} */
      const sources = projected.map(({ source, tokens }, sourceIndex) => {
        const { index, excerpt, role } = source;
        const fields = { index, ...sourceDate(source, representation) };
        if (tokens === undefined) return { ...fields, role };
        if (excerpt === body) {
          sourceDetails.push({ index, kind: "sameAsBody", tokens });
          return { ...fields, role, sameAsBody: true };
        }
        const key = JSON.stringify([role, excerpt]), previous = concrete.get(key);
        if (previous) {
          sourceDetails.push({ index, kind: "sameAs", ...previous });
          return { ...fields, sameAs: previous };
        }
        concrete.set(key, { item: itemIndex, source: sourceIndex });
        sourceDetails.push({ index, kind: "concrete", tokens });
        return { ...fields, role, excerpt };
      });
      details.push({ ref: item.evidence.item.ref, metadata: item.metadata, body: { tokens }, sources: sourceDetails });
      return wireItem(item, representation, sources, item.sourcesComplete && included.length === eligibleSources.length, body);
    });
    return { value: { framing: FRAMING, ...(ledger && { ledgerDigest: ledger }), items: wire }, details, selected,
      amendmentSourceCount: selected.reduce((n, item) => n + (selection.get(item)?.amendmentSources?.length ?? 0), 0) };
  }

  /** @param {Projection} projection @returns {PackDiagnostics} */
  function diagnostics({ details, selected, amendmentSourceCount = 0 }) {
    const rendered = details.flatMap(item => item.sources ?? []);
    const absent = prepared.length - selected.length;
    return { items: details, omitted: { items: absent, bodies: absent, sources: totalSources + amendmentSourceCount - rendered.length, unavailable: 0, oversized },
      dedup: { sources: rendered.filter(source => source.kind === "sameAs").length,
        body: rendered.filter(source => source.kind === "sameAsBody").length }, stops, trace: trace() };
  }

  let accepted = project(chosen);
  if (!check(accepted, diagnostics, { required: true })?.fits) throw new CoreError("context_item_too_large");
  ledger = fitLedgerDigest(options.ledger, accepted, diagnostics, metering);
  if (ledger) accepted = project(chosen);
  const availableItems = budget.maxItems - Number(!!ledger);
  if (!availableItems) stops.items = true;

  /** @param {PreparedItem} item @param {Source} [source] */
  function visit(item, source) {
    if (expired()) return;
    if (!source && item.engine && !hits.has(item) && [...chosen.keys()].some(memory =>
      memory.rank < item.rank && citesMemory(item, memory))) return;
    if (!source && item.compact.type === "memory" && [...chosen.keys()].some(card => citesMemory(card, item))) return;
    const mayReplace = canReplaceCitedMemory(item);
    if (!source && chosen.size >= availableItems && !mayReplace) { stops.items = true; return; }
    const current = chosen.get(item);
    if (source && !current) return;
    const unitTokens = tokens(source ? source.excerpt : item.body);
    if (expired()) return;
    const trial = new Map(chosen);
    const choice = source && current ? { ...current, sources: [...current.sources, { source, tokens: unitTokens }] }
      : { tokens: unitTokens, sources: [] };
    trial.set(item, choice);
    if (!source && mayReplace) {
      for (const memory of trial.keys()) if (citesMemory(item, memory)) trial.delete(memory);
      if (trial.size > availableItems) { stops.items = true; return; }
    }
    const projection = project(trial);
    const result = check(projection, diagnostics);
    if (!result || expired()) return;
    if (result.fits) {
      const amended = !source && item.evidence.amendments.length ? fitCardAmendments(item, result.used, budget,
        (body, amendmentSources) => {
          if (expired()) return null;
          const revised = new Map(trial);
          revised.set(item, { body, amendmentSources, tokens: tokens(body),
            sources: amendmentSources.map(source => ({ source, tokens: tokens(source.excerpt) })) });
          const amendedProjection = project(revised);
          const measured = check(amendedProjection, diagnostics);
          return measured && !expired() ? { result: measured, value: { revised, amendedProjection } } : null;
        }) : null;
      chosen = amended?.revised ?? trial;
      accepted = amended?.amendedProjection ?? projection;
      if (chosen.size >= availableItems) stops.items = true;
      return;
    }

    // Legacy context-read-assembly.mjs:268–275. A byte-only rejection uses
    // the earlier count and never spends a tokenizer call on the minimal pack.
    stops.budget = true;
    const minimumChoice = source && current ? { tokens: current.tokens, sources: [{ source, tokens: unitTokens }] } : choice;
    const minimum = check(project(new Map([[item, minimumChoice]])), diagnostics,
      result.used <= budget.maxTokens ? { reusedCount: result.used } : undefined);
    if (minimum && !minimum.fits) oversized++;
  }

  /** @param {PreparedItem} item */
  const visitSources = item => {
    if (!chosen.has(item)) return;
    const sources = policy === "rank-first-first-source-v1" ? item.sources.slice(0, 1) : item.sources;
    for (const source of sources) { if (expired()) break; visit(item, source); }
  };
  // Legacy context-read-assembly.mjs:276–293. Required empty and final counts
  // remain authoritative when the deadline interrupts optional trials.
  for (const item of prepared) {
    if (expired()) break;
    visit(item);
    if (policy !== "coverage-first-v1") visitSources(item);
  }
  if (policy === "coverage-first-v1") for (const item of prepared) {
    if (expired()) break;
    visitSources(item);
  }
  const final = check(accepted, diagnostics, { required: true });
  if (!final?.fits) throw new CoreError("context_item_too_large");
  return { ...accepted, used: final.used, diagnostics: diagnostics(accepted) };
}
