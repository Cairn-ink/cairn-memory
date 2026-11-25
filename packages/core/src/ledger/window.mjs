import { CoreError } from '../errors.mjs';

/** @import { ParsedLedgerWindow, QuantityLedgerRange, QuantityLedgerRow } from './index.mjs' */

export const DAY_MS = 86_400_000;

/** @param {unknown} time @returns {time is number} */
export function validTime(time) {
  return typeof time === 'number' && Number.isSafeInteger(time) && Math.abs(time) <= 8_640_000_000_000_000;
}

/** @param {number} time */
export const dayStart = time => Math.floor(time / DAY_MS) * DAY_MS;

/** @param {number} time */
export function weekStart(time) {
  return dayStart(time) - ((new Date(time).getUTCDay() + 6) % 7) * DAY_MS;
}

/** @param {number} time */
export function monthStart(time, offset = 0) {
  const date = new Date(dayStart(time));
  return date.setUTCMonth(date.getUTCMonth() + offset, 1);
}

/** @param {number} time */
export function yearStart(time) {
  return new Date(dayStart(time)).setUTCMonth(0, 1);
}

/** @param {number} time */
export const dayLabel = time => new Date(time).toISOString().split('T')[0];

/** @param {Pick<QuantityLedgerRow, 'date'>} row @param {QuantityLedgerRange} range */
export function ledgerRowInRange(row, range) {
  return row.date >= range.fromMs && row.date < range.toMs;
}

/** UTC calendar days with an exclusive end. Calendar weeks start on Monday.
 * @param {string} query @param {number} asOfMs @returns {ParsedLedgerWindow}
 */
export function parseWindow(query, asOfMs) {
  if (!validTime(asOfMs)) throw new CoreError('invalid_input');
  const today = dayStart(asOfMs);
  let toMs = today + DAY_MS;
  let fromMs = today - 6 * DAY_MS;
  let label = 'last 7 days';
  /** @type {ParsedLedgerWindow['calendar']} */
  let calendar;
  const text = query.normalize('NFKC');
  const trailing = text.match(/\blast\s+(\d+)\s+days?\b|最近\s*(\d+)\s*天/iu);
  if (/\byesterday\b|昨天/iu.test(text)) {
    toMs = today;
    fromMs = today - DAY_MS;
    label = 'yesterday';
  } else if (/\btoday\b|今天/iu.test(text)) {
    fromMs = today;
    label = 'today';
  } else if (/\blast week\b|上週/iu.test(text)) {
    toMs = weekStart(today);
    fromMs = toMs - 7 * DAY_MS;
    label = 'last week';
  } else if (/\bthis week\b|這週|本週/iu.test(text)) {
    label = 'this week, read as the last 7 days';
    calendar = { fromMs: weekStart(today), toMs, label: 'calendar week so far' };
  } else if (/\blast month\b|上個月/iu.test(text)) {
    toMs = monthStart(today);
    fromMs = monthStart(today, -1);
    label = 'last month';
  } else if (/\bthis month\b|這個月/iu.test(text)) {
    fromMs = today - 29 * DAY_MS;
    label = 'this month, read as the last 30 days';
    calendar = { fromMs: monthStart(today), toMs, label: 'calendar month so far' };
  } else if (/\blast 3 months\b|最近\s*[三3]\s*個月/iu.test(text)) {
    fromMs = monthStart(today, -2);
    label = 'last 3 months';
  } else if (trailing) {
    const count = Number(trailing[1] ?? trailing[2]);
    const start = toMs - count * DAY_MS;
    if (count > 0 && validTime(start)) {
      fromMs = start;
      label = `last ${count} days`;
    }
  }
  if (!validTime(fromMs) || !validTime(toMs)) throw new CoreError('invalid_input');
  const window = { fromMs, toMs, label };
  if (calendar) Object.defineProperty(window, 'calendar', { value: calendar });
  return window;
}
