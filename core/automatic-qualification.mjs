import { readFileSync } from 'node:fs';
import { qualificationInput, qualificationSources } from './claim-qualification-input.mjs';
import { callModel } from './model-call.mjs';
import { emitDiagnostic } from './model-diagnostics.mjs';
import { fittingCap, prefixUnits, requestFits } from './model-packing.mjs';
import { denseArray, fail, object } from './validation.mjs';

const system = readFileSync(new URL('./prompts/qualify-memories.md', import.meta.url), 'utf8');

// The item's receipts as the model sees them: identity whole, each excerpt a
// prefix of at most `cap` units, so every anchor it can cite is an offset into
// the stored excerpt too.
const shownReceipts = (item, cap) => item.receipts.map((receipt) =>
  ({ ...receipt, excerpt: prefixUnits(receipt.excerpt, cap) }));
const request = (entries) => ({ items: entries.map(({ item, cap }, itemIndex) => ({ itemIndex,
  content: item.content, kind: item.kind, sources: item.receipts.map(({ role, excerpt }, receiptIndex) => {
    const shown = prefixUnits(excerpt, cap);
    return { receiptIndex, role, excerpt: shown, ...(shown === excerpt ? {} : { excerptShortened: true }) };
  }) })) });

/**
 * Plan requests that fit: all items together, else one request per item. An
 * item that cannot fit alone is sent with its excerpts cut to a common prefix
 * of at least 120 units; if even that cannot fit it stays unqualified. Nothing
 * here fails the capture for size.
 */
function plan(model, items, deadline) {
  const fits = requestFits(model, 'qualify', deadline);
  const all = items.map((item, index) => ({ index, item, cap: Infinity }));
  // A missing or misconfigured port is left to the guarded call's own errors.
  if (typeof model?.qualify !== 'function' || !Number.isSafeInteger(model.contextWindow) ||
      model.contextWindow < 8192 || fits(system, request(all))) return { groups: [all], unqualified: [] };
  const groups = [];
  const unqualified = [];
  for (const entry of all) {
    if (fits(system, request([entry]))) { groups.push([entry]); continue; }
    const longest = Math.max(...entry.item.receipts.map((receipt) => receipt.excerpt.length));
    const cap = fittingCap(longest, (units) => fits(system, request([{ ...entry, cap: units }])));
    if (cap !== null) { groups.push([{ ...entry, cap }]); continue; }
    // Observable, but this item alone stays unqualified; the capture continues.
    emitDiagnostic(model, 'qualify', 'core_call', 'context_budget_exceeded');
    unqualified.push(entry.index);
  }
  return { groups, unqualified };
}

/**
 * Produce inspectable model assertions, never trusted identity or retirement
 * authority. `report` receives how many items were shortened or left unqualified.
 */
export async function qualifyExtractedItems(model, items, deadline, report = {}, modelCallTimeoutMs) {
  deadline?.check();
  const { groups, unqualified } = plan(model, items, deadline);
  const qualifications = new Map();
  for (const group of groups) {
    const output = await callModel(model, 'qualify', system, request(group),
      { failureCode: 'qualification_failed', deadline, modelCallTimeoutMs });
    try {
      object(output, ['qualifications']);
      const entries = denseArray(output.qualifications, group.length, group.length);
      const seen = new Set();
      for (const entry of entries) {
        object(entry, ['itemIndex', 'qualification']);
        if (!Number.isSafeInteger(entry.itemIndex) || entry.itemIndex < 0 || entry.itemIndex >= group.length ||
            seen.has(entry.itemIndex)) fail('invalid_model_output');
        seen.add(entry.itemIndex);
        const { index, item, cap } = group[entry.itemIndex];
        qualificationSources(item.content, item.receipts);
        qualifications.set(index, qualificationInput(entry.qualification, shownReceipts(item, cap)));
      }
      deadline?.check();
    } catch {
      deadline?.check();
      emitDiagnostic(model, 'qualify', 'core_validation', 'invalid_qualification');
      fail('invalid_model_output');
    }
  }
  report.itemsShortened = groups.flat().filter((entry) => entry.cap !== Infinity).length;
  report.itemsUnqualified = unqualified.length;
  return items.map((item, index) => qualifications.has(index)
    ? { ...item, qualification: qualifications.get(index) } : item);
}
