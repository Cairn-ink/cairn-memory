import { isWellFormedText } from "../capture/validate.mjs";
import { renderCardAmendments } from "../routing/amendment-read.mjs";
import { CoreError } from "../errors.mjs";
import { COMPACT_MEMORY_REPRESENTATION } from "./context-read-input.mjs";
import { canReplaceCitedMemory, cardHits, citesMemory, compareDates, FRAMING, sourceDate, wireItem } from "./context-read-projection.mjs";

/** @import { ContextAssemblyDiagnostics, ContextAssemblyItem, ContextAssemblyPolicy,
  ContextAssemblySource, ContextAssemblyValue, ContextCompactAssemblyItem, ContextLedgerDiagnostics, ContextLedgerDigest } from "../ports/index.d.ts" */
/** @import { LedgerReading } from "./context-read-assembly-evidence.mjs" */
/** @import { LedgerLine } from "../ledger/digest.mjs" */
/** @import { PreparedItem, Source } from "./context-read-projection.mjs" */
/** @typedef {Pick<ContextAssemblyDiagnostics, "items" | "omitted" | "dedup" | "stops" | "trace">} PackDiagnostics */
/** @typedef {{ maxTokens: number, maxItems: number }} Budget */
/** @typedef {ContextAssemblyValue<ContextAssemblyItem | ContextCompactAssemblyItem>} AssemblyValue */
/** @typedef {{ value: AssemblyValue, details: PackDiagnostics["items"], selected: PreparedItem[], amendmentSourceCount?: number }} Projection */
/** @typedef {{ budget: Budget, policy: ContextAssemblyPolicy, representation: ContextAssemblyDiagnostics["representation"],
 * now: () => number, deadline: number, ledger?: ContextLedgerDigest,
 * format: (value: AssemblyValue) => string, count: (text: string) => number,
 * fitsBytes: (value: AssemblyValue, text: string, details: PackDiagnostics, selected: PreparedItem[], used: number) => boolean }} PackOptions */
/** @typedef {{ tokens: number, sources: { source: Source, tokens: number }[],
 * body?: string, amendmentSources?: Source[] }} Choice */

const LEDGER_OTHER_SHARE = 0.30;
const LEDGER_ANSWER_CEILING = 0.60;
const ledgerDropOrder = { subtotal: 0, category: 1, group: 2, measure: 2, goal: 3 };

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
  /** @param {AssemblyValue} value */
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
  return { stops, expired, tokens, block, trace, check };
}

/**
 * @template T
 * @param {LedgerReading} reading @param {number} maxTokens @param {ReturnType<typeof meter>} metering
 * @param {() => void} active @param {ContextLedgerDiagnostics} diagnostics
 * @param {(digest: ContextLedgerDigest) => T | undefined} tryPack
 */
export function fitLedgerDigest(reading, maxTokens, { block, tokens }, active, diagnostics, tryPack) {
  const framing = FRAMING;
  const emptyCost = tokens(block({ framing, items: [] }));
  /** @param {ContextLedgerDigest} ledgerDigest */
  function cost(ledgerDigest) {
    active();
    return tokens(block({ framing, ledgerDigest, items: [] })) - emptyCost;
  }
  const answerLimit = maxTokens * LEDGER_ANSWER_CEILING;
  const otherLimit = maxTokens * LEDGER_OTHER_SHARE;
  /** @type {LedgerLine[]} */
  const eligibleAnswers = [];
  /** @type {Set<LedgerLine>} */
  const answers = new Set();
  const answering = reading.lines.filter(line => line.answering);
  // Prefer the question's rolling answer if separately useful lines cannot fit together.
  answering.sort((a, b) => Number(!!a.calendar) - Number(!!b.calendar));
  for (const line of answering) {
    if (cost(reading.project([line], false).value) > answerLimit) {
      diagnostics.digest_line_too_large = (diagnostics.digest_line_too_large ?? 0) + 1;
      continue;
    }
    eligibleAnswers.push(line);
    answers.add(line);
    if (answers.size > 1 && cost(reading.project(reading.lines.filter(item => answers.has(item)), false).value) > answerLimit) {
      answers.delete(line);
    }
  }

  const optional = reading.lines.filter(line => !line.answering).sort((a, b) =>
    ledgerDropOrder[a.kind] - ledgerDropOrder[b.kind] || (a.total ?? 0) - (b.total ?? 0));
  const answerCost = optional.length && answers.size
    ? cost(reading.project(reading.lines.filter(line => answers.has(line)), false).value)
    : 0;
  const selected = new Set([...answers, ...optional]);
  /** @param {LedgerLine[]} lines @param {boolean} includesOptional */
  function trial(lines, includesOptional) {
    const dropped = reading.lines.length - lines.length;
    const untrimmed = reading.project(lines, false);
    // The formatted difference counts shared citations only in the answer.
    if (includesOptional && cost(untrimmed.value) - answerCost > otherLimit) return;
    const projection = dropped ? reading.project(lines, true) : untrimmed;
    if (dropped) diagnostics.ledger_digest_trimmed = dropped;
    const packed = tryPack(projection.value);
    active();
    if (packed) return { packed, witness: projection.witness(), selection: { keys: lines.map(line => line.key), trimmed: dropped > 0 } };
  }
  for (let next = 0; selected.size; next++) {
    const lines = reading.lines.filter(line => selected.has(line));
    const fitted = trial(lines, lines.length > answers.size);
    if (fitted) return fitted;
    const drop = optional[next];
    if (!drop || lines.length === answers.size) break;
    selected.delete(drop);
  }
  // A whole answer may still fit beside normal context when the answers together cannot.
  for (const line of eligibleAnswers) {
    if (answers.size === 1 && answers.has(line)) continue;
    const fitted = trial([line], false);
    if (fitted) return fitted;
  }
  diagnostics.ledger_digest_trimmed = reading.lines.length;
  diagnostics.ledger_digest_omitted = 1;
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
  const { ledger } = options;
  const totalSources = prepared.reduce((total, item) => total + item.sources.length, 0);

  /** @param {ReadonlyMap<PreparedItem, Choice>} selection @returns {Projection} */
  function project(selection) {
    const selected = prepared.filter(item => selection.has(item));
    const rendered = dated || representation === COMPACT_MEMORY_REPRESENTATION
      ? selected.slice().sort((a, b) => compareDates(a.sortDate, b.sortDate)) : selected;
    /** @type {Map<string, {item: number, source: number}>} */
    const concrete = new Map();
    /** @type {PackDiagnostics["items"][number][]} */
    const details = [];
    const wire = rendered.map((item, itemIndex) => {
      const { tokens, sources: included, body = item.body, amendmentSources = [] } = /** @type {Choice} */ (selection.get(item));
      if (representation === COMPACT_MEMORY_REPRESENTATION) {
        details.push({ ref: item.evidence.item.ref, metadata: item.metadata, body: { tokens }, sources: [],
          sourceAccess: item.sourceAccess, sourcesComplete: item.sourcesComplete, fence: item.evidence.fence, f: item.compact.f });
        return { date: item.date ?? null, body };
      }
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
    if (representation === COMPACT_MEMORY_REPRESENTATION || !chosen.has(item)) return;
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
  if (representation !== COMPACT_MEMORY_REPRESENTATION && policy === "coverage-first-v1") for (const item of prepared) {
    if (expired()) break;
    visitSources(item);
  }
  const final = check(accepted, diagnostics, { required: true });
  if (!final?.fits) throw new CoreError("context_item_too_large");
  return { ...accepted, used: final.used, diagnostics: diagnostics(accepted) };
}
