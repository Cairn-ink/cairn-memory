const dayMs = 86_400_000;
const asDay = time => new Date(time).toISOString().slice(0, 10);
const dayAt = date => Date.parse(date + 'T00:00:00Z');
const shift = (date, days) => asDay(dayAt(date) + days * dayMs);
const daysIn = (from, to) => (dayAt(to) - dayAt(from)) / dayMs + 1;
const monday = date => shift(date, -((new Date(dayAt(date)).getUTCDay() + 6) % 7));
const month = (date, offset = 0) => {
  const first = new Date(dayAt(date));
  first.setUTCMonth(first.getUTCMonth() + offset, 1);
  return asDay(first);
};

const groups = ['food', 'transport', 'housing', 'shopping', 'bills', 'health', 'fitness', 'entertainment', 'work', 'other'];
const periods = ['none', 'day', 'week', 'month', 'year'];
const comparators = ['none', 'at_most', 'at_least'];
const kinds = ['record', 'goal'];
const fields = ['item', 'kind', 'measure', 'value', 'unit', 'group', 'category', 'period', 'comparator'];

export const quantitySchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: fields,
    properties: {
      item: { type: 'integer', minimum: 0 },
      kind: { type: 'string', enum: kinds },
      measure: { type: 'string' },
      value: { type: 'number' },
      unit: { type: 'string' },
      group: { type: 'string', enum: groups },
      category: { type: 'string' },
      period: { type: 'string', enum: periods },
      comparator: { type: 'string', enum: comparators },
    },
  },
};

export function validQuantity(quantity, itemCount) {
  return Number.isSafeInteger(quantity.item) && quantity.item >= 0 && quantity.item < itemCount &&
    kinds.includes(quantity.kind) && Number.isFinite(quantity.value) && groups.includes(quantity.group) &&
    ['measure', 'unit', 'category'].every(key => typeof quantity[key] === 'string' && quantity[key].isWellFormed()) &&
    (quantity.kind === 'record' ? quantity.period === 'none' && quantity.comparator === 'none' :
      periods.slice(1).includes(quantity.period) && comparators.slice(1).includes(quantity.comparator));
}

export function rowsFrom(memory, revision, quantity, eventTime) {
  const occurredAt = new Date(eventTime).toISOString();
  const { item, ...amount } = quantity;
  return [{ ...amount, memoryId: memory.id, revision, date: asDay(occurredAt), occurredAt }];
}

/** Inclusive UTC dates. Calendar weeks start on Monday. */
export function parseWindow(query, asOf) {
  const today = asDay(asOf);
  let from = shift(today, -6), to = today, label = 'last 7 days';
  const trailing = query.match(/\blast\s+(\d+)\s+days?\b|最近\s*(\d+)\s*天/iu);
  if (/\byesterday\b|昨天/iu.test(query)) {
    from = to = shift(today, -1); label = 'yesterday';
  } else if (/\btoday\b|今天/iu.test(query)) {
    from = today; label = 'today';
  } else if (/\blast week\b|上週/iu.test(query)) {
    from = shift(monday(today), -7); to = shift(monday(today), -1); label = 'last week';
  } else if (/\bthis week\b|這週|本週/iu.test(query)) from = monday(today), label = 'this week';
  else if (/\blast month\b|上個月/iu.test(query)) {
    from = month(today, -1); to = shift(month(today), -1); label = 'last month';
  } else if (/\bthis month\b|這個月/iu.test(query)) from = month(today), label = 'this month';
  else if (/\blast 3 months\b|最近\s*[三3]\s*個月/iu.test(query)) from = month(today, -2), label = 'last 3 months';
  else if (trailing) {
    const count = Number(trailing[1] ?? trailing[2]);
    if (Number.isSafeInteger(count) && count > 0 && count <= daysIn('0001-01-01', today)) {
      from = shift(today, 1 - count); label = `last ${count} days`;
    }
  }
  return { from, to, label };
}

const words = text => text.toLowerCase().match(/[a-z]+/g) ?? [];
const cues = /\b(?:total|how much|how many|spent|spend(?:ing)?|budget|goal|average|most|least|over|under|met)\b|花|元|步|預算|目標|總共|多少|平均|最多|超過/iu;
const aliases = [
  [/咖啡/u, 'coffee'], [/午餐/u, 'lunch'], [/早餐/u, 'breakfast'], [/晚餐/u, 'dinner'],
  [/飲食|餐費/u, 'food'], [/花費|花了|花多少|開銷|支出/u, 'spend'],
  [/步數|步行|(?:幾|多少)步|走[^。，！？]{0,8}步/u, 'steps'],
  [/睡眠|睡了/u, 'sleep'], [/體重/u, 'weight'], [/距離|公里/u, 'distance'],
  [/交通/u, 'transport'], [/房租/u, 'housing'], [/購物/u, 'shopping'], [/帳單/u, 'bills'],
  [/健康/u, 'health'], [/運動/u, 'fitness'], [/娛樂/u, 'entertainment'], [/工作/u, 'work'],
];

export function readIntent(query, rows) {
  if (!hasLedgerCue(query)) return false;
  return matchesTerms(query, new Set(rows.flatMap(rowTerms)));
}

const key = (...parts) => JSON.stringify(parts);
const total = rows => rows.reduce((sum, row) => sum + row.value, 0);
const by = (rows, getKey) => {
  const grouped = new Map();
  for (const row of rows) {
    const id = getKey(row), list = grouped.get(id);
    if (list) list.push(row);
    else grouped.set(id, [row]);
  }
  return grouped;
};
const money = /^[A-Z]{3}$/u;
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const amount = (value, unit) => money.test(unit) ?
  (unit === 'USD' ? '$' : unit + ' ') + numberWithCents.format(value) :
  number.format(value) + (unit === 'steps' ? '' : ' ' + unit);
const numberWithCents = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const title = text => text.charAt(0).toUpperCase() + text.slice(1).replaceAll('_', ' ');
const inWindow = (row, { from, to }) => row.date >= from && row.date <= to;
const newest = (left, right) => left.occurredAt > right.occurredAt || left.occurredAt === right.occurredAt &&
  (left.revision > right.revision || left.revision === right.revision && left.memoryId > right.memoryId);
const latest = (rows, getKey) => {
  const found = new Map();
  for (const row of rows) {
    const id = getKey(row), current = found.get(id);
    if (!current || newest(row, current)) found.set(id, row);
  }
  return [...found.values()];
};

export function digest(rows, goals, window) {
  const records = rows.filter(row => row.kind === 'record' && row.date <= window.to);
  const distinct = [...records.filter(row => row.measure !== 'steps'),
    ...latest(records.filter(row => row.measure === 'steps'), row => key(row.unit, row.date))];
  const used = distinct.filter(row => inWindow(row, window));
  const targets = latest(goals.filter(row => row.kind === 'goal' && row.date <= window.to),
    row => key(row.measure, row.unit, row.group, row.category, row.period, row.comparator));
  if (!used.length && !targets.length) return null;
  const parts = [`Computed ledger for ${window.from} to ${window.to} (${window.label}), from the dated records you mentioned.`];
  for (const records of by(used, row => key(row.measure, row.unit)).values()) {
    const { measure, unit } = records[0];
    if (measure === 'steps') {
      parts.push(`Steps: ${records.length} daily records, total ${amount(total(records), unit)}, average ${amount(total(records) / records.length, unit)} per day.`);
    } else {
      parts.push(summary(title(measure), records, unit, daysIn(window.from, window.to)));
      if (measure === 'spend') for (const [group, entries] of by(records, row => row.group))
        parts.push(summary(`${title(group)} spending`, entries, unit, daysIn(window.from, window.to), true));
    }
    const categories = [...by(records.filter(row => row.category), row => row.category)];
    for (const [category, entries] of categories.sort((a, b) => total(b[1]) - total(a[1])))
      parts.push(summary(title(category), entries, unit, measure === 'steps' ? entries.length : daysIn(window.from, window.to)));
    addSubtotals(parts, records, unit, window, monday, 'Weekly');
    addSubtotals(parts, records, unit, window, month, 'Monthly');
  }
  const comparisons = targets.map(goal => compareGoal(goal, distinct, window));
  if (comparisons.length) parts.push('Goals: ' + comparisons.map(({ text }) => text).join('; ') + '.');
  const sources = new Set([...used, ...targets, ...comparisons.flatMap(part => part.rows)].map(row => row.memoryId));
  return { body: parts.join(' '), sources: [...sources].sort() };
}

/**
 * A synchronous port is scoped by the exact namespace. Each put inserts a
 * source message's amounts once per receipt incarnation, retaining all earlier
 * writes across revisions and failures. Revision remains write metadata.
 * drop removes all sources for a memory. list accepts optional inclusive UTC
 * date bounds and returns detached rows, including each row's receiptId.
 * @typedef {{put(namespace: object, memoryId: string, revision: number, rows: object[]): void,
 *   drop(namespace: object, memoryId: string): void,
 *   list(namespace: object, window: {from?: string, to?: string}): object[]}} LedgerPort
 */

/** @returns {LedgerPort} */
export function createInMemoryLedgerPort() {
  const namespaces = new Map();
  return {
    put(namespace, memoryId, revision, rows) {
      const id = namespaceKey(namespace), memories = namespaces.get(id) ?? new Map();
      const sources = new Map(memories.get(memoryId));
      for (const [source, entries] of by(rows, row => key(row.sourceKey, row.receiptId))) {
        if (!sources.has(source)) sources.set(source, entries.map(row => ({ ...row, memoryId, revision })));
      }
      memories.set(memoryId, sources);
      namespaces.set(id, memories);
    },
    drop(namespace, memoryId) {
      const id = namespaceKey(namespace), memories = namespaces.get(id);
      memories?.delete(memoryId);
      if (memories?.size === 0) namespaces.delete(id);
    },
    list(namespace, { from = '', to = '9999-12-31' } = {}) {
      return [...(namespaces.get(namespaceKey(namespace))?.values() ?? [])]
        .flatMap(sources => [...sources.values()].flat()
          .filter(row => inWindow(row, { from, to })).map(row => ({ ...row })));
    },
  };
}

function summary(label, rows, unit, days, purchase = false) {
  const count = rows.length, sum = total(rows);
  const noun = purchase ? (count === 1 ? 'purchase' : 'purchases') : (count === 1 ? 'record' : 'records');
  return `${label}: ${amount(sum, unit)} in ${count} ${noun}, average ${amount(sum / days, unit)} per day.`;
}

function addSubtotals(parts, rows, unit, window, bucket, label) {
  if (bucket(window.from) === bucket(window.to)) return;
  const entries = [...by(rows, row => bucket(row.date))].sort(([a], [b]) => a.localeCompare(b));
  parts.push(`${label} subtotals: ${entries.map(([date, records]) => `${date}: ${amount(total(records), unit)}`).join(', ')}.`);
}

function compareGoal(goal, rows, window) {
  const { measure, unit, category, group, comparator, value, period } = goal;
  const start = period === 'week' ? monday(window.to) : period === 'month' ? month(window.to) :
    period === 'year' ? window.to.slice(0, 4) + '-01-01' : window.from;
  const matching = rows.filter(row => row.measure === measure && row.unit === unit && row.date >= start &&
    (measure === 'steps' || row.group === group && (!category || row.category === category)));
  const label = measure === 'spend' ? `${category || group} budget` : (category || measure).replaceAll('_', ' ');
  const target = `${label} goal ${amount(value, unit)} per ${period}`;
  if (!matching.some(row => inWindow(row, window))) return { rows: [], text: `${target}: no records in this window` };
  const actual = period === 'day' ? total(matching) / (measure === 'steps' ? matching.length : daysIn(window.from, window.to)) : total(matching);
  const difference = actual - value;
  const status = (comparator === 'at_least' ? difference >= 0 : difference <= 0) ? 'goal met' : 'goal missed';
  const delta = difference === 0 ? '' : `, ${difference > 0 ? 'over' : 'under'} by ${amount(Math.abs(difference), unit)}`;
  return { rows: matching, text: `${target}: actual ${amount(actual, unit)} per ${period}, ${status}${delta}` };
}

export const ledgerNamespace = ns => ({ ownerId: ns.ownerId, scope: ns.scope, projectId: ns.projectId || null });

export const hasLedgerCue = query => cues.test(query);

const namespaceKey = ns => key(ns.ownerId, ns.scope, ns.projectId ?? '');
const rowTerms = row => words([row.measure, row.category, row.group].join(' '));

function matchesTerms(query, terms) {
  return words(query).some(word => {
    if (terms.has(word)) return true;
    for (let length = 4; length < word.length; length++) {
      if (terms.has(word.slice(0, length))) return true;
    }
    return false;
  }) || aliases.some(([pattern, term]) => terms.has(term) && pattern.test(query));
}

export const ledgerSourceKey = receipt => key(receipt.client, receipt.sessionId, receipt.eventId);

const countTerms = new Set([...groups, 'spend', 'purchase', 'step', 'steps', 'sleep', 'hour', 'hours',
  'weight', 'distance', 'calorie', 'record']);

export function mayHaveLedgerIntent(query) {
  // A bare count question needs a ledger measure or group to justify a scan.
  return hasLedgerCue(query.replace(/\bhow many\b/giu, '')) ||
    /\bhow many\b/iu.test(query) && matchesTerms(query, countTerms);
}
