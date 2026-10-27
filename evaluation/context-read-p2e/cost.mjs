import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
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

// Timestamps are required integers; the upper endpoint is exclusive.
export function validateAuthorizationWindow(authorization, now = Date.now()) {
  const { fromUtcMs, untilUtcMs } = authorization ?? {};
  if (!Number.isSafeInteger(fromUtcMs) || !Number.isSafeInteger(untilUtcMs)
    || fromUtcMs < 0 || untilUtcMs <= fromUtcMs || now < fromUtcMs || now >= untilUtcMs) throw Error('authorization_window_invalid_or_closed');
}

// Durable, fail-closed admission. SQLite serializes independent processes;
// COMMIT precedes dispatch. A crash/unknown send never releases exposure.
export function transmissionGuard({ tokenTable, rate, maxUsd, maxRequests, authorization,
  stateDirectory = join(homedir(), '.local', 'state', 'p2e-admission'), now = Date.now }) {
  const cap = money(maxUsd);
  authorization = structuredClone(authorization);
  validateAuthorizationWindow(authorization, now());
  if (typeof authorization.id !== 'string' || !authorization.id || !Number.isSafeInteger(maxRequests) || maxRequests < 1) throw Error('invalid_admission_identity');
  const policy = hash(JSON.stringify({ rate, maxUsd, maxRequests, authorization, counts: tokenTable.counts }));
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  const path = join(stateDirectory, 'admission.sqlite');
  return (texts, reservationId) => {
    if (!Array.isArray(texts) || !texts.length || texts.some(text => typeof text !== 'string' || !Object.hasOwn(tokenTable.counts, hash(text)))) throw Error('unregistered_embedding_input');
    if (typeof reservationId !== 'string' || !reservationId) throw Error('reservation_id_required');
    validateAuthorizationWindow(authorization, now());
    const next = texts.reduce((sum, text) => sum + charge(Buffer.byteLength(text) + 16, rate), 0n);
    const db = new DatabaseSync(path);
    try {
      db.exec('PRAGMA busy_timeout=10000; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS allowances (id TEXT PRIMARY KEY, policy TEXT NOT NULL, requests INTEGER NOT NULL, reserved TEXT NOT NULL); CREATE TABLE IF NOT EXISTS reservations (id TEXT NOT NULL, nonce TEXT NOT NULL, PRIMARY KEY(id,nonce)); BEGIN IMMEDIATE');
      let row = db.prepare('SELECT * FROM allowances WHERE id=?').get(authorization.id);
      if (!row) {
        db.prepare('INSERT INTO allowances VALUES (?,?,0,?)').run(authorization.id, policy, '0');
        row = { policy, requests: 0, reserved: '0' };
      }
      if (row.policy !== policy) throw Error('authorization_identity_rebound');
      if (db.prepare('SELECT 1 FROM reservations WHERE id=? AND nonce=?').get(authorization.id, reservationId)) throw Error('reservation_replay');
      const reserved = BigInt(row.reserved) + next, requests = row.requests + 1;
      if (requests > maxRequests || reserved > cap) throw Error('run_cap_exhausted');
      db.prepare('INSERT INTO reservations VALUES (?,?)').run(authorization.id, reservationId);
      db.prepare('UPDATE allowances SET requests=?,reserved=? WHERE id=?').run(requests, String(reserved), authorization.id);
      validateAuthorizationWindow(authorization, now());
      db.exec('COMMIT');
      return { requests, reservedUsd: usd(reserved) };
    } finally { db.close(); }
  };
}
