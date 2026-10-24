export const DICTIONARY_VERSION = 'hr3-scorer-dictionary-v1';
export const normalizeText = value => value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
export const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export const unique = values => [...new Map(values.map(v => [stable(v), v])).values()].sort((a, b) => stable(a) < stable(b) ? -1 : stable(a) > stable(b) ? 1 : 0);
// A deliberately small, inspectable dictionary. Unlisted words are never
// semantically guessed. These are representation aliases, not adjudications.
const groups = [
  ['TW', 'Taiwan', '台灣', '臺灣'], ['JP', 'Japan', '日本'], ['US', 'United States', '美國'],
  ['free', '免費'], ['pro', '專業'], ['web', '網頁'], ['app', '應用程式'],
];
const aliases = new Map(groups.flatMap(g => g.map(s => [normalizeText(s), g[0]])));
export const atom = s => aliases.get(normalizeText(s)) ?? normalizeText(s);
export const knownAtom = s => groups.some(g => g[0] === s);
const domains = { country: ['TW', 'JP', 'US'], plan: ['free', 'pro'], channel: ['web', 'app'] };
export const CELLS = domains.country.flatMap(country => domains.plan.flatMap(plan => domains.channel.map(channel => ({ country, plan, channel }))));
export class UnknownEquivalence extends Error {}
export function scope(value) {
  for (const clause of value.any) for (const term of clause.all) for (const v of term.values) {
    if (!domains[term.field].includes(atom(v))) throw new UnknownEquivalence(`Unknown scope ${term.field} value: ${v}`);
  }
  const cells = CELLS.filter(c => value.any.some(clause => clause.all.every(t => t.values.map(atom).includes(c[t.field])))).map(c => `${c.country}/${c.plan}/${c.channel}`).sort();
  if (!cells.length) throw new RangeError('Empty scope is invalid (§2)');
  return cells;
}
const gcd = (a, b) => b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b);
const rat = (n, d = 1n) => { const g = gcd(n, d); return [n / g, d / g]; };
export function rational(s) {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) throw new RangeError('Invalid decimal');
  const sign = s.startsWith('-') ? -1n : 1n;
  const [whole, frac = ''] = s.replace(/^[+-]/, '').split('.');
  return rat(sign * BigInt((whole || '0') + frac), 10n ** BigInt(frac.length));
}
// dimension, numerator, denominator. No floating-point unit conversion.
const units = new Map([
  ['m', ['length', 1n, 1n]], ['公尺', ['length', 1n, 1n]], ['cm', ['length', 1n, 100n]], ['公分', ['length', 1n, 100n]], ['km', ['length', 1000n, 1n]],
  ['s', ['duration', 1n, 1n]], ['秒', ['duration', 1n, 1n]], ['min', ['duration', 60n, 1n]], ['分鐘', ['duration', 60n, 1n]], ['h', ['duration', 3600n, 1n]], ['小時', ['duration', 3600n, 1n]], ['day', ['duration', 86400n, 1n]], ['天', ['duration', 86400n, 1n]],
  ['1', ['ratio', 1n, 1n]], ['%', ['ratio', 1n, 100n]], ['百分比', ['ratio', 1n, 100n]],
  ['TWD', ['TWD', 1n, 1n]], ['新台幣', ['TWD', 1n, 1n]], ['USD', ['USD', 1n, 1n]], ['美元', ['USD', 1n, 1n]], ['JPY', ['JPY', 1n, 1n]], ['日圓', ['JPY', 1n, 1n]],
]);
function measure(decimal, unit) {
  const normalized = normalizeText(unit);
  const [dimension, n, d] = units.get(normalized) ?? [`unknown:${normalized}`, 1n, 1n];
  const [a, b] = rational(decimal);
  const [num, den] = rat(a * n, b * d);
  return { dimension, rational: `${num}/${den}` };
}
const taipei = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Taipei', era: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function localEpoch(timestamp) {
  const fields = Object.fromEntries(taipei.formatToParts(new Date(timestamp)).map(p => [p.type, p.value]));
  const result = new Date(0);
  result.setUTCFullYear(fields.era === 'BC' ? 1 - +fields.year : +fields.year, +fields.month - 1, +fields.day);
  result.setUTCHours(+fields.hour, +fields.minute, +fields.second, 0);
  return result.valueOf();
}
function localMidnight(date) {
  const target = Date.parse(`${date}T00:00:00Z`);
  const candidates = new Set();
  for (const delta of [-129600000, 0, 129600000]) {
    const sample = target + delta;
    const offset = localEpoch(sample) - sample;
    const candidate = target - offset;
    if (localEpoch(candidate) === target) candidates.add(candidate);
  }
  if (candidates.size !== 1) throw new UnknownEquivalence('Ambiguous or nonexistent Asia/Taipei midnight');
  return [...candidates][0];
}
export function instant(input) {
  const s = normalizeText(input);
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const full = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i.exec(s);
  if (!bare && !full) throw new UnknownEquivalence(`Unrecognized instant: ${input}`);
  const date = s.slice(0, 10);
  const day = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(day.valueOf()) || day.toISOString().slice(0, 10) !== date) throw new RangeError('Invalid calendar date');
  if (full && (+full[2] > 23 || +full[3] > 59 || +full[4] > 59 || (full[6] !== 'Z' && full[6] !== 'z' && (+full[6].slice(1, 3) > 23 || +full[6].slice(4) > 59)))) throw new RangeError('Invalid time');
  // Keep arbitrary fractional precision; Date is used only for whole seconds.
  const seconds = BigInt(bare ? localMidnight(date) : Date.parse(s.replace(/\.\d+/, '')));
  const fraction = full?.[5]?.slice(1).replace(/0+$/, '') ?? '';
  return { milliseconds: seconds.toString(), fraction };
}
function compareInstant(a, b) {
  const first = BigInt(a.milliseconds) - BigInt(b.milliseconds);
  if (first) return first < 0n ? -1 : 1;
  const n = Math.max(a.fraction.length, b.fraction.length);
  return a.fraction.padEnd(n, '0') < b.fraction.padEnd(n, '0') ? -1 : a.fraction === b.fraction ? 0 : 1;
}
export function interval(v) {
  const result = { from: v.from === null ? null : instant(v.from), to: v.to === null ? null : instant(v.to) };
  if (result.from && result.to && compareInstant(result.from, result.to) >= 0) throw new RangeError('Invalid half-open interval');
  return result;
}
export function value(v) {
  switch (v.type) {
    case 'Text': return { type: v.type, text: atom(v.text) };
    case 'Boolean': return v;
    case 'Quantity': return { type: v.type, ...measure(v.decimal, v.unit) };
    case 'Instant': return { type: v.type, instant: instant(v.iso) };
    case 'Range': {
      const lower = v.lower === null ? null : measure(v.lower, v.unit);
      const upper = v.upper === null ? null : measure(v.upper, v.unit);
      if (lower && upper) {
        const [ln, ld] = lower.rational.split('/').map(BigInt), [un, ud] = upper.rational.split('/').map(BigInt);
        if (ln * ud > un * ld || (ln * ud === un * ld && (!v.lowerClosed || !v.upperClosed))) throw new RangeError('Empty range');
      }
      return { type: v.type, dimension: measure('0', v.unit).dimension, lower: lower?.rational ?? null, upper: upper?.rational ?? null, lowerClosed: v.lower === null ? false : v.lowerClosed, upperClosed: v.upper === null ? false : v.upperClosed };
    }
    default: throw new RangeError('Invalid value type');
  }
}
export function claim(c) {
  return { subject: atom(c.subject), predicate: atom(c.predicate), value: value(c.value), scope: scope(c.scope), valid: interval(c.valid), qualifiers: unique(c.qualifiers.map(q => ({ key: atom(q.key), value: value(q.value) }))) };
}
