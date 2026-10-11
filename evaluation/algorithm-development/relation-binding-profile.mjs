// Source-only diagnostic profile. Never load the evaluator rubric here.
import { readFileSync } from 'node:fs';
import { dense, exact, fail, freeze, snapshotJson, wellFormed } from '../longmemeval/mixed-validation.mjs';

export const RELATION_BINDING_VERSION = 'relation-binding-probe-v1';
export const relationBindingArms = Object.freeze(['baseline', 'relation']);
export const relationBindingLimits = Object.freeze({ cases: 12, answersPerCase: 2,
  httpRequests: 24, reservationMicroUsd: 5000, reservedMicroUsd: 120_000,
  localCeilingMicroUsd: 1_000_000, protectedMicroUsd: 30_000_000,
  inputTokens: 6000, providerInputTokens: 7024, answerOutputTokens: 512,
  callMs: 200_000, caseMs: 1_200_000, runMs: 28_800_000 });
export const relationBindingId = ordinal => `R${String(ordinal).padStart(2, '0')}`;
const string = value => {
  if (!wellFormed(value) || !value.trim()) fail('invalid_relation_binding_source');
};
function date(value, event = false) {
  if (typeof value !== 'string' || !(event ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u
    : /^\d{4}-\d{2}-\d{2}$/u).test(value) || !Number.isFinite(Date.parse(value))
    || (event ? (value.includes('.') ? new Date(value).toISOString() : new Date(value).toISOString().replace('.000Z', 'Z'))
      : new Date(value).toISOString().slice(0, 10)) !== value) fail('invalid_relation_binding_source');
}
export function validateRelationBindingInputs(value) {
  const code = 'invalid_relation_binding_source';
  const data = JSON.parse(JSON.stringify(snapshotJson(value, { bytes: 256_000, nodes: 4000, depth: 7 }, code)));
  exact(data, ['schemaVersion', 'cases'], code);
  if (data.schemaVersion !== RELATION_BINDING_VERSION) fail(code);
  dense(data.cases, 12, 12, code);
  for (const [index, row] of data.cases.entries()) {
    exact(row, ['id', 'family', 'question', 'sourceUnits'], code);
    if (row.id !== relationBindingId(index + 1)) fail(code);
    string(row.family); exact(row.question, ['text', 'date'], code);
    string(row.question.text); date(row.question.date);
    dense(row.sourceUnits, 1, 6, code); let characters = 0;
    for (const unit of row.sourceUnits) {
      exact(unit, ['recordedRole', 'eventAt', 'text'], code);
      if (!['user', 'assistant'].includes(unit.recordedRole)) fail(code);
      date(unit.eventAt, true); string(unit.text);
      characters += [...unit.text].length;
    }
    if (characters > 4000) fail(code);
  }
  return freeze(data);
}
export function loadRelationBindingInputs() {
  return validateRelationBindingInputs(JSON.parse(readFileSync(new URL('./relation-binding-cases.json', import.meta.url), 'utf8')));
}
export function renderRelationBindingUnits(row) {
  return freeze(row.sourceUnits.map(unit => ({ text: JSON.stringify({ format: 'source-role-evidence-v1',
    sources: [{ recordedRole: unit.recordedRole, text: `[event-at: ${unit.eventAt}] ${unit.text}` }] }) })));
}
