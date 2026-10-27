import { hash, eligible, cells } from './fixtures.mjs';

// Exact integer trillionths, matching P2e's conservative reservation unit.
export function money(value, { positive = false } = {}) {
  if (typeof value !== 'string' || value.length > 20 || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,12})?$/.test(value)) throw Error('invalid_usd');
  const [whole, fraction = ''] = value.split('.');
  const units = BigInt(whole) * 1000000000000n + BigInt(fraction.padEnd(12, '0'));
  if (units > 1000000000000000000n || positive && units === 0n) throw Error('invalid_usd');
  return units;
}
export function usd(units) {
  return `${units / 1000000000000n}.${String(units % 1000000000000n).padStart(12, '0')}`.replace(/\.?0+$/, '');
}
export function charge(tokens, rate) { return (BigInt(tokens) * money(rate, { positive: true }) + 999999n) / 1000000n; }
export function estimateCost(fixture, tokenTable, rate, maxUsd, safetyFixture) {
  money(rate, { positive: true });
  const tokenCount = text => {
    const value = tokenTable.counts[hash(text)];
    if (!Number.isSafeInteger(value) || value < 0) throw Error('unregistered_embedding_input');
    return value;
  };
  const count = texts => ({ inputs: texts.length, tokens: texts.reduce((n, text) => n + tokenCount(text), 0),
    reservationTokens: texts.reduce((n, text) => n + Buffer.byteLength(text) + 16, 0),
    // Reserve singleton upper bounds; batching can only reduce overhead.
    reservationUnits: texts.reduce((n, text) => n + charge(Buffer.byteLength(text) + 16, rate), 0n) });
  const qualityDocuments = count(fixture.documents.map(d => d.text)), qualityQueries = count(fixture.queries.map(q => q.text));
  const safetyDocuments = count((safetyFixture?.canaries ?? []).map(d => d.text)), safetyQueries = count(safetyFixture ? [safetyFixture.query] : []);
  const documents = count([...fixture.documents.map(d => d.text), ...(safetyFixture?.canaries ?? []).map(d => d.text)]);
  const queries = count([...fixture.queries.map(q => q.text), ...(safetyFixture ? [safetyFixture.query] : [])]);
  const refreshTexts = [], queryTexts = [];
  // Four language cells share one projection; each schema/world/intent has
  // its own certified vectors. No cross-intent/schema cache saving is assumed.
  for (const cell of cells()) {
    if (cell.language === 'zh') refreshTexts.push(...fixture.documents.filter(d => eligible(d, cell)).map(d => d.text));
    queryTexts.push(...fixture.queries.filter(q => q.language === cell.language).map(q => q.text));
  }
  const refresh = count(refreshTexts), query = count(queryTexts), reservation = refresh.reservationUnits + query.reservationUnits;
  const expected = charge(refresh.tokens + query.tokens, rate);
  const clean = row => ({ inputs: row.inputs, tokens: row.tokens, reservationTokens: row.reservationTokens, reservationUsd: usd(row.reservationUnits) });
  const result = { counter: tokenTable.counter, priceUsdPerMillion: rate, documents: clean(documents), queries: clean(queries),
    qualityDocuments: clean(qualityDocuments), qualityQueries: clean(qualityQueries), safetyDocuments: clean(safetyDocuments), safetyQueries: clean(safetyQueries),
    schedule: { refresh: clean(refresh), query: clean(query), expectedUsd: usd(expected), reservationUsd: usd(reservation),
      safety: 'fake-only; separate authorization and sealed estimate required for hosted safety transmissions', retries: 0 },
    capUsd: maxUsd ?? null, overCap: maxUsd !== undefined && reservation > money(maxUsd) };
  if (result.overCap) throw Object.assign(Error('max_usd_exceeded_before_transmission'), { estimate: result });
  return result;
}

// Used by a hosted runtime binding in its supervised provider Worker. Unknown
// texts fail closed; failed/unknown sends retain their full reservation.
export function transmissionGuard({ tokenTable, rate, maxUsd, maxRequests }) {
  const cap = money(maxUsd); let reserved = 0n, requests = 0;
  return texts => {
    if (!Array.isArray(texts) || !texts.length || texts.some(text => !Object.hasOwn(tokenTable.counts, hash(text)))) throw Error('unregistered_embedding_input');
    const next = texts.reduce((sum, text) => sum + charge(Buffer.byteLength(text) + 16, rate), 0n);
    if (requests >= maxRequests || reserved + next > cap) throw Error('run_cap_exhausted');
    requests++; reserved += next;
    return { requests, reservedUsd: usd(reserved) };
  };
}
