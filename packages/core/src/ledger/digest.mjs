import { compareUtf8 } from '../utf8.mjs';
import { DAY_MS, dayLabel, dayStart, ledgerRowInRange, monthStart, weekStart, yearStart } from './window.mjs';

/** @import { LedgerDigest, LedgerWindow, ParsedLedgerWindow, QuantityLedgerRow } from './index.mjs' */

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
 * @param {string[]} parts @param {readonly QuantityLedgerRow[]} rows @param {string} unit
 * @param {LedgerWindow} window @param {(ms: number) => number} bucket @param {string} label
 */
function appendSubtotals(parts, rows, unit, window, bucket, label) {
  if (bucket(window.fromMs) === bucket(window.toMs - 1)) return;
  const groups = [...groupBy(rows, row => bucket(row.date))].sort(([a], [b]) => a - b);
  const subtotals = groups.map(([start, entries]) => `${dayLabel(start)}: ${amount(total(entries), unit)}`);
  parts.push(`${label} subtotals: ${subtotals.join(', ')}.`);
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
 * @returns {LedgerDigest | null}
 */
export function digest(rows, goals, window, calendarReading = false) {
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
  const sources = new Set([...used, ...targets].map(row => row.memoryId));

  const parts = [`Computed ledger for ${dayLabel(window.fromMs)} to ${dayLabel(window.toMs - 1)} (${window.label}), from the dated records you mentioned.`];
  if (calendar) {
    parts.push(`${title(calendar.label)}: ${dayLabel(calendar.fromMs)} to ${dayLabel(calendar.toMs - 1)}.`);
  }
  for (const [key, entries] of groupBy(used, measureKey)) {
    const { measure, unit } = entries[0];
    const stepDays = measure === 'steps';
    const calendarRows = calendarGroups?.get(key) ?? [];
    /** @param {string} label @param {QuantityLedgerRow[]} rollingRows @param {QuantityLedgerRow[]} comparisonRows */
    function appendSummary(label, rollingRows, comparisonRows) {
      parts.push(summary(label, rollingRows, unit, stepDays ? rollingRows.length : daysIn(window)));
      if (calendar) {
        parts.push(summary(`${label}, ${calendar.label}`, comparisonRows, unit,
          stepDays ? Math.max(1, comparisonRows.length) : daysIn(calendar)));
      }
    }
    appendSummary(title(measure), entries, calendarRows);
    for (const row of calendarRows) sources.add(row.memoryId);
    if (measure === 'spend') {
      for (const [group, purchases] of groupBy(entries, row => row.group)) {
        appendSummary(`${title(group)} spending`, purchases, calendarRows.filter(row => row.group === group));
      }
    }
    const categories = [...groupBy(entries.filter(row => row.category), row => row.category)];
    for (const [category, records] of categories.sort(([, a], [, b]) => total(b) - total(a))) {
      appendSummary(title(category), records, calendarRows.filter(row => row.category === category));
    }
    appendSubtotals(parts, entries, unit, window, weekStart, 'Weekly');
    appendSubtotals(parts, entries, unit, window, monthStart, 'Monthly');
  }
  const comparisons = targets.map(goal => compareGoal(goal, distinct, window));
  if (comparisons.length) parts.push('Goals: ' + comparisons.map(result => result.text).join(' '));
  for (const { rows } of comparisons) for (const row of rows) sources.add(row.memoryId);
  return { body: parts.join(' '), sources: [...sources].sort(compareUtf8) };
}
