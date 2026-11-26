import { compareUtf8 } from '../utf8.mjs';
import { readIntent } from './terms.mjs';
import { DAY_MS, dayLabel, dayStart, ledgerRowInRange, monthStart, weekStart, yearStart } from './window.mjs';

/** @import { LedgerDigest, LedgerWindow, ParsedLedgerWindow, QuantityLedgerRow } from './index.mjs' */
/** @typedef {{ key: string, kind: 'measure' | 'group' | 'category' | 'subtotal' | 'goal',
 * text: string, rows: readonly QuantityLedgerRow[], answering: boolean, calendar?: boolean, total?: number }} LedgerLine */
/** @typedef {{ header: string, calendarHeader?: string, lines: LedgerLine[] }} LedgerPlan */

const numbers = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6 });
const currencyNumbers = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const currencyCodes = new Set(Intl.supportedValuesOf('currency'));

/** @param {number} value @param {boolean} currency */
function formatNumber(value, currency) {
  if (!currency) return numbers.format(value);
  const formatted = currencyNumbers.format(value);
  return value !== 0 && (formatted === '0.00' || formatted === '-0.00') ? numbers.format(value) : formatted;
}

/** @param {number} value @param {string} unit */
function amount(value, unit) {
  const currency = currencyCodes.has(unit);
  const formatted = formatNumber(value, currency);
  if (unit === 'USD') return '$' + formatted;
  if (currency) return unit + ' ' + formatted;
  return formatted + (unit && unit !== 'steps' ? ' ' + unit : '');
}

/** @param {number} value @param {string} unit */
function displayedValue(value, unit) {
  return Number.isFinite(value) ? Number(formatNumber(value, currencyCodes.has(unit)).replaceAll(',', '')) : value;
}

/** @param {string} text */
const title = text => (text.charAt(0).toUpperCase() + text.slice(1)).replaceAll('_', ' ');

/** @param {readonly QuantityLedgerRow[]} rows */
const total = rows => rows.reduce((sum, row) => sum + row.value, 0);

/** @template T @param {readonly QuantityLedgerRow[]} rows @param {(row: QuantityLedgerRow) => T} key */
function groupBy(rows, key) {
  /** @type {Map<T, QuantityLedgerRow[]>} */
  const groups = new Map();
  for (const row of rows) {
    const group = key(row);
    const entries = groups.get(group);
    if (entries) entries.push(row);
    else groups.set(group, [row]);
  }
  return groups;
}

/** @param {QuantityLedgerRow} a @param {QuantityLedgerRow} b */
function compareTime(a, b) {
  return a.date - b.date || compareUtf8(a.memoryId, b.memoryId) || compareUtf8(a.receiptId, b.receiptId) ||
    a.ordinal - b.ordinal || a.value - b.value;
}

/** @param {readonly QuantityLedgerRow[]} rows @param {(row: QuantityLedgerRow) => string} key */
function latest(rows, key) {
  /** @type {Map<string, QuantityLedgerRow>} */
  const groups = new Map();
  for (const row of rows) {
    const group = key(row);
    const previous = groups.get(group);
    if (!previous || compareTime(row, previous) > 0) groups.set(group, row);
  }
  return [...groups.values()];
}

/** @param {LedgerWindow} window */
function daysIn(window) {
  return (dayStart(window.toMs - 1) - dayStart(window.fromMs)) / DAY_MS + 1;
}

/** @param {string} label @param {readonly QuantityLedgerRow[]} rows @param {string} unit @param {number} days */
function summary(label, rows, unit, days) {
  const sum = total(rows);
  return `${label}: total ${amount(sum, unit)} in ${rows.length} ${rows.length === 1 ? 'record' : 'records'}, average ${amount(sum / days, unit)} per day.`;
}

/**
 * @param {readonly QuantityLedgerRow[]} rows @param {string} unit
 * @param {LedgerWindow} window @param {(ms: number) => number} bucket @param {string} label
 */
function subtotal(rows, unit, window, bucket, label) {
  if (bucket(window.fromMs) === bucket(window.toMs - 1)) return;
  const groups = [...groupBy(rows, row => bucket(row.date))].sort(([a], [b]) => a - b);
  const subtotals = groups.map(([start, entries]) => `${dayLabel(start)}: ${amount(total(entries), unit)}`);
  return `${label} subtotals: ${subtotals.join(', ')}.`;
}

/** @param {QuantityLedgerRow} goal @param {readonly QuantityLedgerRow[]} records @param {LedgerWindow} window */
function compareGoal(goal, records, window) {
  const { measure, unit, category, group, comparator, value, period } = goal;
  const end = window.toMs - 1;
  const start = period === 'week' ? weekStart(end) : period === 'month' ? monthStart(end) :
    period === 'year' ? yearStart(end) : window.fromMs;
  const matching = records.filter(row => row.date >= start && row.measure === measure && row.unit === unit &&
    (measure === 'steps' || row.group === group && (!category || row.category === category)));
  const label = measure === 'spend' ? `${category || group} budget` : (category || measure).replaceAll('_', ' ');
  const bound = comparator === 'at_least' ? 'at least' : 'at most';
  const target = `${label} goal ${bound} ${amount(value, unit)} per ${period}`;
  if (!matching.some(row => ledgerRowInRange(row, window))) {
    return { rows: [], text: `${target}: no records in this window.` };
  }
  const divisor = period === 'day' ? measure === 'steps' ? matching.length : daysIn(window) : 1;
  const actual = total(matching) / divisor;
  const difference = displayedValue(actual, unit) - displayedValue(value, unit);
  const met = comparator === 'at_least' ? difference >= 0 : difference <= 0;
  const delta = difference === 0 ? '' : `, ${difference > 0 ? 'over' : 'under'} by ${amount(Math.abs(difference), unit)}`;
  return { rows: matching, text: `${target}: actual ${amount(actual, unit)} per ${period}, goal ${met ? 'met' : 'missed'}${delta}.` };
}

/**
 * Summarize rows that have passed the delivery check in the read snapshot.
 * @param {readonly QuantityLedgerRow[]} rows
 * @param {readonly QuantityLedgerRow[]} goals
 * @param {ParsedLedgerWindow} window
 * @param {boolean} [calendarReading]
 * @param {string} [query]
 * @returns {LedgerPlan | null}
 */
export function planDigest(rows, goals, window, calendarReading = false, query) {
  if (window.fromMs >= window.toMs) return null;
  const asOf = rows.filter(row => row.kind === 'record' && row.date < window.toMs);
  const distinct = [...asOf.filter(row => row.measure !== 'steps'),
    ...latest(asOf.filter(row => row.measure === 'steps'), row => JSON.stringify([row.unit, dayStart(row.date)]))];
  const used = distinct.filter(row => ledgerRowInRange(row, window));
  const targets = latest(goals.filter(row => row.kind === 'goal' && row.date < window.toMs),
    row => JSON.stringify([row.measure, row.unit, row.group, row.category, row.period, row.comparator]));
  if (!used.length && !targets.length) return null;

  const calendar = calendarReading ? window.calendar : undefined;
  const measureKey = (/** @type {QuantityLedgerRow} */ row) => JSON.stringify([row.measure, row.unit]);
  const calendarGroups = calendar ? groupBy(distinct.filter(row => ledgerRowInRange(row, calendar)), measureKey) : undefined;
  const header = `Computed ledger for ${dayLabel(window.fromMs)} to ${dayLabel(window.toMs - 1)} (${window.label}), from the dated records you mentioned.`;
  const calendarHeader = calendar && `${title(calendar.label)}: ${dayLabel(calendar.fromMs)} to ${dayLabel(calendar.toMs - 1)}.`;
  /** @type {LedgerLine[]} */
  const lines = [];
  /** @type {Map<string, boolean>} */
  const termMatches = new Map();
  /** @param {string} term */
  function matches(term) {
    if (query === undefined || !term) return false;
    const cached = termMatches.get(term);
    if (cached !== undefined) return cached;
    const matched = readIntent(query, [term]);
    termMatches.set(term, matched);
    return matched;
  }
  const targeted = new Set([...used, ...targets].filter(row => matches(row.group) || matches(row.category)).map(row => row.measure));
  for (const [key, entries] of groupBy(used, measureKey)) {
    const { measure, unit } = entries[0];
    const stepDays = measure === 'steps';
    const calendarRows = calendarGroups?.get(key) ?? [];
    const measureMatch = matches(measure) && !targeted.has(measure);
    const categoryMatches = entries.some(row => matches(row.category));
    /** @param {LedgerLine['kind']} kind @param {string} term @param {string} label
     * @param {QuantityLedgerRow[]} rollingRows @param {QuantityLedgerRow[]} comparisonRows @param {boolean} answering */
    function appendSummary(kind, term, label, rollingRows, comparisonRows, answering) {
      lines.push({ key: JSON.stringify([kind, key, term, 'rolling']), kind, answering, rows: rollingRows,
        total: total(rollingRows), text: summary(label, rollingRows, unit, stepDays ? rollingRows.length : daysIn(window)) });
      if (calendar) {
        lines.push({ key: JSON.stringify([kind, key, term, 'calendar']), kind, answering, calendar: true, rows: comparisonRows,
          total: total(comparisonRows), text: summary(`${label}, ${calendar.label}`, comparisonRows, unit,
            stepDays ? Math.max(1, comparisonRows.length) : daysIn(calendar)) });
      }
    }
    if (query === undefined || measureMatch || categoryMatches) {
      appendSummary('measure', measure, title(measure), entries, calendarRows, matches(measure));
    }
    if (measure === 'spend' || query !== undefined) {
      for (const [group, purchases] of groupBy(entries, row => row.group)) {
        const direct = matches(group);
        if (query === undefined || measureMatch || direct || purchases.some(row => matches(row.category))) {
          appendSummary('group', group, measure === 'spend' ? `${title(group)} spending` : `${title(group)} ${measure.replaceAll('_', ' ')}`,
            purchases, calendarRows.filter(row => row.group === group), direct);
        }
      }
    }
    const categories = [...groupBy(entries.filter(row => row.category &&
      (query === undefined || matches(row.category) || matches(row.group))), row => row.category)];
    for (const [category, records] of categories.sort(([, a], [, b]) => total(b) - total(a))) {
      const direct = matches(category);
      appendSummary('category', category, title(category), records,
        calendarRows.filter(row => row.category === category && (query === undefined || direct || matches(row.group))), direct);
    }
    const subtotalRows = query === undefined || measureMatch ? entries :
      entries.filter(row => matches(row.group) || matches(row.category));
    if (subtotalRows.length) {
      for (const [label, bucket] of /** @type {const} */ ([['Weekly', weekStart], ['Monthly', monthStart]])) {
        const text = subtotal(subtotalRows, unit, window, bucket, label);
        if (text) lines.push({ key: JSON.stringify(['subtotal', key, label]), kind: 'subtotal', answering: false, rows: subtotalRows, text });
      }
    }
  }
  for (const goal of targets) {
    const { measure, unit, group, category, period, comparator } = goal;
    if (query !== undefined && !matches(group) && !matches(category) &&
      (!matches(measure) || targeted.has(measure))) continue;
    const comparison = compareGoal(goal, distinct, window);
    lines.push({ key: JSON.stringify(['goal', measure, unit, group, category, period, comparator]),
      kind: 'goal', answering: false, rows: [goal, ...comparison.rows], text: comparison.text });
  }
  return lines.length ? { header, calendarHeader, lines } : null;
}

/** @param {LedgerPlan} plan @param {readonly LedgerLine[]} lines @param {boolean} [trimmed] */
export function renderDigest(plan, lines, trimmed = false) {
  const parts = [plan.header];
  if (plan.calendarHeader && (lines.some(line => line.calendar) || plan.lines.every(line => line.kind === 'goal'))) {
    parts.push(plan.calendarHeader);
  }
  let goals = false;
  for (const line of lines) {
    if (line.kind === 'goal' && !goals) {
      parts.push('Goals:');
      goals = true;
    }
    parts.push(line.text);
  }
  if (trimmed) parts.push('More ledger rows not shown.');
  const rows = [...new Set(lines.flatMap(line => line.rows))];
  const sources = [...new Set(rows.map(row => row.memoryId))].sort(compareUtf8);
  return { body: parts.join(' '), rows, sources };
}

/** @param {readonly QuantityLedgerRow[]} rows @param {readonly QuantityLedgerRow[]} goals
 * @param {ParsedLedgerWindow} window @param {boolean} [calendarReading] @returns {LedgerDigest | null} */
export function digest(rows, goals, window, calendarReading = false) {
  const plan = planDigest(rows, goals, window, calendarReading);
  if (!plan) return null;
  const { body, sources } = renderDigest(plan, plan.lines);
  return { body, sources };
}
