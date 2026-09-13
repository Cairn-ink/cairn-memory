import { readFileSync } from 'node:fs';
import { qualificationInput, qualificationSources } from './claim-qualification-input.mjs';
import { callModel } from './model-call.mjs';
import { emitDiagnostic } from './model-diagnostics.mjs';
import { denseArray, fail, object } from './validation.mjs';

const system = readFileSync(new URL('./prompts/qualify-memories.md', import.meta.url), 'utf8');

/** Produce inspectable model assertions, never trusted identity or retirement authority. */
export async function qualifyExtractedItems(model, items) {
  const input = { items: items.map((item, itemIndex) => ({ itemIndex, content: item.content,
    kind: item.kind, sources: item.receipts.map(({ role, excerpt }, receiptIndex) =>
      ({ receiptIndex, role, excerpt })) })) };
  const output = await callModel(model, 'qualify', system, input, { failureCode: 'qualification_failed' });
  try {
    object(output, ['qualifications']);
    const entries = denseArray(output.qualifications, items.length, items.length);
    const qualifications = new Map();
    for (const entry of entries) {
      object(entry, ['itemIndex', 'qualification']);
      if (!Number.isSafeInteger(entry.itemIndex) || entry.itemIndex < 0 || entry.itemIndex >= items.length ||
          qualifications.has(entry.itemIndex)) fail('invalid_model_output');
      const item = items[entry.itemIndex];
      qualificationSources(item.content, item.receipts);
      qualifications.set(entry.itemIndex, qualificationInput(entry.qualification, item.receipts));
    }
    return items.map((item, index) => ({ ...item, qualification: qualifications.get(index) }));
  } catch {
    emitDiagnostic(model, 'qualify', 'core_validation', 'invalid_qualification');
    fail('invalid_model_output');
  }
}
