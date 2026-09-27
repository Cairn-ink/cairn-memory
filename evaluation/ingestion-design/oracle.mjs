import { fields } from './combined.mjs';
import { createHash } from 'node:crypto';

// Scripted output-conditioned plumbing, never passed into model requests.
const labels = {
  'short-fact': ['Preferred editor is Vim.', 'fact', 'Vim', 'direct', 'adopted'],
  'uncertain-cause': ['DNS may have caused the outage; uncertain.', 'context', 'possible DNS cause', 'direct', 'unknown'],
  'proposal-adoption': ['SQLite was adopted for the local prototype.', 'decision', 'SQLite', 'direct', 'adopted'],
  'assistant-suggestion': ['Assistant suggested Redis.', 'context', 'Redis', 'proposed', 'unknown'],
  'reason-challenge': ['A was chosen for latency; later evidence challenges that reason without changing the decision.', 'decision', 'A', 'direct', 'adopted'],
  'older-imported-later': ['The source reports using Emacs on 2022-01-03.', 'context', 'Emacs', 'reported', 'unknown'],
};
export function scriptedExtraction(fixture, long = false) {
  const [content, kind] = labels[fixture.id] ?? [`Synthetic interpretation of ${fixture.id}.`, 'context'];
  const five = fixture.id.startsWith('five-');
  return { items: Array.from({ length: five ? 5 : 1 }, (_, i) => ({ content: long ? longText(`content-${fixture.id}-${i}`, 600) : five ? `${content} Item ${i}.` : content,
    kind, confidence: 0.5, sourceIndices: fixture.id === 'five-multi-source-medium' ? [i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 3]
      : fixture.id === 'proposal-adoption' || fixture.id === 'reason-challenge' ? [0, 1] : [i] })) };
}
export function scriptedFields(fixture, id, maximal = false) {
  const values = { value: labels[fixture.id]?.[2] ?? null,
    attribution: labels[fixture.id]?.[3] ?? 'unknown', commitment: labels[fixture.id]?.[4] ?? 'unknown',
    scope: fixture.id === 'proposal-adoption' ? 'local prototype' : null,
    applies: fixture.id === 'older-imported-later' ? '2022-01-03' : null };
  return Object.fromEntries(fields.map(f => [f, { value: maximal
    ? ['attribution', 'commitment'].includes(f) ? f === 'attribution' ? 'reported' : 'considered'
      : longText(`${fixture.id}-${f}-${id}`, ['scope', 'applies'].includes(f) ? 120 : 160) : values[f] ?? null,
    evidenceIndices: maximal || (values[f] !== undefined && values[f] !== null && values[f] !== 'unknown') || f === 'value' ? [id] : [] }]));
}
function longText(seed, length) {
  return Array.from({ length: Math.ceil(length / 64) }, (_, i) =>
    createHash('sha256').update(`${seed}-${i}`).digest('hex')).join('').slice(0, length);
}
export function scriptedCombined(fixture, prepared, maximal = false) {
  return { items: scriptedExtraction(fixture).items.map(item => ({ ...item,
    ...(maximal ? { content: longText(`content-${fixture.id}-${item.sourceIndices[0]}`, 600) } : {}),
    qualification: scriptedFields(fixture, prepared.candidates.filter(c => c.sourceIndex === item.sourceIndices.at(-1)).at(-1).candidateIndex, maximal) })) };
}
