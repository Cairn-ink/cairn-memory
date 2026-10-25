import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { normalizeText, stable, UnknownEquivalence } from './canonical.mjs';

// Derived from A-4 §2, before consulting the concurrently published artifact.
export const SLOT_INTERFACE = Object.freeze({
  route: { labels: ['route', '路線'], legacyField: 'value', type: 'string' },
  approval: { labels: ['approval', 'approval required', '需經核准'], legacyField: 'approval', type: 'boolean' },
  cap: { labels: ['cap', 'daily request cap', '每日請求上限'], legacyField: 'cap', type: 'quantity', unit: 'requests/day' },
});
export const ALIAS_INTERFACE = 'category -> [{canonical:string, aliases:string[]}]';
const categories = ['subjects', 'predicates', 'routes', 'fields'];
export function namingAliases(table = {}) {
  const maps = Object.fromEntries(categories.map(category => [category, new Map()]));
  for (const [category, entries] of Object.entries(table)) {
    if (!categories.includes(category) || !Array.isArray(entries)) throw new TypeError('Invalid naming alias category');
    for (const entry of entries) {
      if (typeof entry.canonical !== 'string' || !Array.isArray(entry.aliases) || entry.aliases.some(a => typeof a !== 'string')) throw new TypeError('Invalid naming alias entry');
      for (const label of [entry.canonical, ...entry.aliases]) {
        const key = normalizeText(label), previous = maps[category].get(key);
        if (previous !== undefined && previous !== normalizeText(entry.canonical)) throw new TypeError('Conflicting naming alias');
        maps[category].set(key, normalizeText(entry.canonical));
      }
    }
  }
  const canonicalName = (category, label) => maps[category]?.get(normalizeText(label)) ?? normalizeText(label);
  canonicalName.has = (category, label) => maps[category]?.has(normalizeText(label)) ?? false;
  return canonicalName;
}

export function slotLabel(label, canonicalName = namingAliases()) {
  const normalized = canonicalName('fields', label);
  for (const [slot, spec] of Object.entries(SLOT_INTERFACE)) if ([...spec.labels, spec.legacyField].includes(normalized)) return slot;
  throw new UnknownEquivalence(`Unknown slot correspondence: ${label}`);
}

// Trusted compatibility utility, never applied to a reader answer. It accepts
// bundled qualifiers and decomposed fields; unknown keys/types must refer at
// the caller, never become an empty/shorter slot set or a count-mismatch zero.
export function projectFields(fields, canonicalName = namingAliases()) {
  const slots = { route: [], approval: [], cap: [] };
  for (const { key, value } of fields) {
    const slot = slotLabel(key, canonicalName);
    let projected;
    if (slot === 'route' && value.type === 'Text') projected = canonicalName('routes', value.text);
    else if (slot === 'approval' && value.type === 'Boolean') projected = value.value;
    else if (slot === 'cap' && value.type === 'Quantity') projected = { decimal: value.decimal, unit: value.unit };
    else throw new UnknownEquivalence(`Unknown ${slot}/${value.type} correspondence`);
    slots[slot].push(projected);
  }
  return Object.fromEntries(Object.entries(slots).map(([key, values]) => [key, [...new Map(values.map(v => [stable(v), v])).values()].sort((a, b) => stable(a) < stable(b) ? -1 : stable(a) > stable(b) ? 1 : 0)]));
}
export function projectClaimFields(claims, canonicalName) {
  return projectFields(claims.flatMap(c => [{ key: c.predicate === 'value' || canonicalName?.has?.('predicates', c.predicate) ? 'route' : c.predicate, value: c.value }, ...c.qualifiers]), canonicalName);
}

// Adapt the publisher's language-indexed tables to the text-derived naming
// interface. This is a wire projection, not a semantic equivalence invention.
export function contractProjection(contract) {
  const aliases = {};
  for (const [category, rows] of Object.entries(contract.aliases ?? {})) {
    if (!Array.isArray(rows)) throw new TypeError('Invalid naming alias table');
    aliases[category] = rows.map(row => {
      const labels = row.aliases ?? ['zh-Hant', 'en', 'mixed'].flatMap(language => {
        if (!Array.isArray(row[language])) throw new TypeError('Missing bilingual naming aliases');
        return row[language];
      });
      return { canonical: row.canonical, aliases: labels };
    });
  }
  const slots = Array.isArray(contract.slots) ? Object.fromEntries(contract.slots.map(slot => [slot.name, {
    labels: slot.aliases?.filter(label => label !== slot.legacy_field || slot.name !== 'route'),
    legacyField: slot.legacy_field, type: slot.type, ...(slot.name === 'cap' ? { unit: slot.unit } : {}),
  }])) : contract.slots;
  return { slots, aliases, units: contract.values?.units ?? [{ alias: 'requests/day', canonical: 'requests/day', numerator: '1', denominator: '1' }],
    booleanAliases: contract.values?.boolean_aliases ?? { true: ['true'], false: ['false'] } };
}
export function validateContract(contract) {
  const errors = [];
  if (!contract || typeof contract.version !== 'string') return ['Missing contract version'];
  let projection;
  try { projection = contractProjection(contract); } catch (error) { return [error.message]; }
  if (Array.isArray(contract.slots) && (contract.slots.length !== 3 || new Set(contract.slots.map(slot => slot.name)).size !== 3)) errors.push('Duplicate/missing contract slots');
  if (stable(projection.slots) !== stable(SLOT_INTERFACE)) errors.push('Slot interface mismatch with A-4 §2');
  try { namingAliases(projection.aliases); } catch (error) { errors.push(error.message); }
  if (!projection.aliases.subjects?.length || !projection.aliases.predicates?.length) errors.push('Missing public fictional subject/predicate aliases');
  for (const row of projection.aliases.fields ?? []) if (!Object.hasOwn(SLOT_INTERFACE, row.canonical)) errors.push('Unknown canonical slot alias');
  for (const category of categories) if (!Object.hasOwn(projection.aliases, category)) errors.push(`Missing alias category: ${category}`);
  if (!contract.values || !Array.isArray(contract.values.units) || !contract.values.boolean_aliases) errors.push('Missing unit/Boolean value interface');
  if (contract.values && stable(contract.values.slot_states) !== stable(['value', 'not_specified', 'unavailable', 'unresolved'])) errors.push('Slot state mismatch');
  const expectedStatuses = { current_statuses: ['active', 'no_active_decision', 'unresolved'], old_statuses: ['available', 'unavailable', 'none'], reason_statuses: ['stated', 'not_stated', 'unavailable'] };
  for (const [key, values] of Object.entries(expectedStatuses)) if (stable(contract.answer?.[key]) !== stable(values)) errors.push(`Answer status mismatch: ${key}`);
  if (stable(contract.historical_labels?.map(row => row.canonical)) !== stable(['previously_adopted', 'erroneous', 'expired', 'unavailable', 'unresolved'])) errors.push('Historical label mismatch');
  if (!Array.isArray(projection.units)) return [...errors, 'Invalid cap unit table'];
  const units = new Map();
  for (const unit of projection.units) {
    if (!unit || typeof unit.alias !== 'string') { errors.push('Invalid cap unit entry'); continue; }
    if (typeof unit.alias !== 'string' || unit.canonical !== 'requests/day' || typeof unit.numerator !== 'string' || typeof unit.denominator !== 'string' || !/^[1-9][0-9]*$/.test(unit.numerator) || !/^[1-9][0-9]*$/.test(unit.denominator)) errors.push('Invalid exact cap unit ratio');
    const key = normalizeText(unit.alias);
    if (units.has(key)) errors.push('Duplicate cap unit alias');
    units.set(key, unit);
  }
  const canonical = units.get('requests/day');
  if (!canonical || canonical.numerator !== canonical.denominator) errors.push('Canonical requests/day ratio mismatch');
  const bool = projection.booleanAliases;
  if (!bool || typeof bool !== 'object') return [...errors, 'Invalid Boolean aliases'];
  if (!Array.isArray(bool.true) || !Array.isArray(bool.false) || [...(bool.true ?? []), ...(bool.false ?? [])].some(s => typeof s !== 'string') || (bool.true ?? []).some(s => (bool.false ?? []).map(normalizeText).includes(normalizeText(s)))) errors.push('Invalid Boolean aliases');
  if (!contract.scope || (contract.scope.time_zone !== 'Asia/Taipei' || stable(contract.scope.domain) !== stable({ country: ['TW', 'JP', 'US'], plan: ['free', 'pro'], channel: ['web', 'app'] }))) errors.push('Scope/time interface mismatch');
  return errors;
}
export function consumeContract(path = new URL('../generator/public-contract.json', import.meta.url)) {
  let bytes;
  try { bytes = readFileSync(path); } catch (error) {
    if (error.code === 'ENOENT') return { status: 'absent', canonicalName: namingAliases(), units: [{ alias: 'requests/day', canonical: 'requests/day', numerator: '1', denominator: '1' }] };
    throw error;
  }
  let contract;
  try { contract = JSON.parse(bytes); } catch { throw new TypeError('Public contract mismatch: malformed JSON'); }
  const errors = validateContract(contract);
  if (errors.length) throw new TypeError('Public contract mismatch: ' + errors.join('; '));
  const projection = contractProjection(contract);
  return { status: 'validated', version: contract.version, sha256: createHash('sha256').update(bytes).digest('hex'),
    canonicalName: namingAliases(projection.aliases), units: projection.units, booleanAliases: projection.booleanAliases };
}
