import { interval, scope, rational, normalizeText, stable, unique, UnknownEquivalence } from './canonical.mjs';
import { namingAliases, projectClaimFields } from './contract.mjs';

export const conjunction = values => values.includes(0) ? 0 : values.includes(null) ? null : 1;
const unknown = raw => ({ unknown: raw });
const safely = fn => { try { return fn(); } catch (error) { if (error instanceof UnknownEquivalence) return unknown(error.message); throw error; } };
const uncertain = v => v && typeof v === 'object' && Object.hasOwn(v, 'unknown');
const compare = (a, b) => uncertain(a) || uncertain(b) ? null : stable(a) === stable(b) ? 1 : 0;
export function canonicalSlot(name, slot, publicInterface = {}) {
  const canonicalName = publicInterface.canonicalName ?? namingAliases();
  if (slot.state !== 'value') return { state: slot.state, value: null };
  let value = slot.value;
  if (name === 'route') value = canonicalName('routes', value);
  if (name === 'cap') {
    // Additional conversions must be independently declared in the public file.
    const unit = (publicInterface.units ?? [{ alias: 'requests/day', numerator: '1', denominator: '1' }]).find(u => normalizeText(u.alias) === normalizeText(value.unit));
    if (!unit) return { state: slot.state, value: unknown(`Unknown cap unit: ${value.unit}`) };
    const [n, d] = rational(value.decimal);
    const numerator = n * BigInt(unit.numerator), denominator = d * BigInt(unit.denominator);
    const gcd = (a, b) => b ? gcd(b, a % b) : a < 0n ? -a : a;
    const divisor = gcd(numerator, denominator);
    value = { rational: `${numerator / divisor}/${denominator / divisor}`, unit: 'requests/day' };
  }
  return { state: slot.state, value };
}
export function projectRows(rows, publicInterface) {
  return unique(rows.flatMap(row => {
    const cells = safely(() => scope(row.scope));
    const valid = safely(() => interval(row.valid));
    return ['route', 'approval', 'cap'].flatMap(slot => (Array.isArray(cells) ? cells : [cells]).map(cell => ({
      cell, valid, slot, assertion: safely(() => canonicalSlot(slot, row[slot], publicInterface)),
    })));
  }));
}
function canMatch(a, b, equal, allowUnknown) {
  if (a.length !== b.length) return false;
  const assigned = new Map();
  function augment(i, seen) {
    for (let j = 0; j < b.length; j++) {
      const verdict = equal(a[i], b[j]);
      if ((verdict !== 1 && !(allowUnknown && verdict === null)) || seen.has(j)) continue;
      seen.add(j);
      if (!assigned.has(j) || augment(assigned.get(j), seen)) { assigned.set(j, i); return true; }
    }
    return false;
  }
  return a.every((_, i) => augment(i, new Set()));
}
export function setEqual(a, b, equal) {
  a = unique(a); b = unique(b);
  if (canMatch(a, b, equal, false)) return 1;
  if (canMatch(a, b, equal, true)) return null;
  // Unknown aliases/partitions may collapse or expand. Count/type differences
  // dependent on that correspondence are never independent failure witnesses.
  const possible = (x, ys) => ys.some(y => equal(x, y) !== 0);
  if (a.length && b.length && a.every(x => possible(x, b)) && b.every(y => possible(y, a)) && a.some(x => b.some(y => equal(x, y) === null))) return null;
  return 0;
}
const assertionEqual = (a, b) => uncertain(a) || uncertain(b) ? null : conjunction([a.state === b.state ? 1 : 0, compare(a.value, b.value)]);
const atomEqual = (a, b) => conjunction([a.slot === b.slot ? 1 : 0, compare(a.cell, b.cell), compare(a.valid, b.valid), assertionEqual(a.assertion, b.assertion)]);
export const rowsEqual = (a, b, canonicalName) => setEqual(projectRows(a, canonicalName), projectRows(b, canonicalName), atomEqual);
export function currentCorrect(a, b, canonicalName) {
  if (a.status !== b.status || (a.status === 'no_active_decision' && a.rows.length)) return 0;
  return rowsEqual(a.rows, b.rows, canonicalName);
}
export function oldCorrect(a, b, canonicalName) {
  if (a.status !== b.status) return 0;
  // Public predecessor identities and status are independent omission witnesses.
  const records = xs => unique(xs.map(r => ({ predecessor_turn: normalizeText(r.predecessor_turn), status: r.status, rows: projectRows(r.rows, canonicalName) })));
  return setEqual(records(a.records), records(b.records), (x, y) => conjunction([
    x.predecessor_turn === y.predecessor_turn ? 1 : 0, x.status === y.status ? 1 : 0, setEqual(x.rows, y.rows, atomEqual),
  ]));
}

// Legacy authoring/import comparison only. It never broadens the closed reader
// wire or turns unknown field/type correspondence into a missing-field zero.
export function fieldRepresentationsEqual(left, right, publicInterface = {}) {
  let a, b;
  try {
    a = projectClaimFields(left, publicInterface.canonicalName);
    b = projectClaimFields(right, publicInterface.canonicalName);
  } catch (error) { if (error instanceof UnknownEquivalence) return null; throw error; }
  return conjunction(['route', 'approval', 'cap'].map(name => setEqual(
    a[name].map(value => canonicalSlot(name, { state: 'value', value }, publicInterface)),
    b[name].map(value => canonicalSlot(name, { state: 'value', value }, publicInterface)), assertionEqual)));
}
