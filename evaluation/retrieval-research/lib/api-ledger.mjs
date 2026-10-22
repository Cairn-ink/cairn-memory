import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, openSync, writeSync, fsyncSync, closeSync, rmdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Integer nano-USD avoids fractional-dollar cap comparisons. Every dispatch,
// including retries, reserves separately. A crashed/unknown attempt stays held.
export const PRICES = Object.freeze({ 'text-embedding-3-small': 20, 'text-embedding-3-large': 130 });
export function createApiLedger(path, { capUsd = 1 } = {}) {
  if (!path || !Number.isFinite(capUsd) || capUsd <= 0 || capUsd > 1) throw new Error('invalid_hr1_ledger');
  path = resolve(path);
  mkdirSync(dirname(path), { recursive: true });
  const cap = Math.floor(capUsd * 1e9);
  const locked = work => {
    // Fail closed on contention or a crash-left lock. Never steal a live lock.
    mkdirSync(`${path}.lock`);
    try { return work(); } finally { rmdirSync(`${path}.lock`); }
  };
  function read() {
    let text;
    try { text = readFileSync(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    if (text && !text.endsWith('\n')) throw new Error('incomplete_hr1_ledger');
    return text.split('\n').filter(Boolean).map(line => JSON.parse(line));
  }
  function state(rows) {
    const held = new Map();
    let tokens = 0, spend = 0;
    for (const row of rows) {
      if (row.format !== 'hr1-api-ledger-v1' || !Object.hasOwn(PRICES, row.model) || !Number.isSafeInteger(row.tokens) || row.tokens < 0 ||
          row.nanoUsd !== row.tokens * PRICES[row.model]) throw new Error('invalid_hr1_ledger_entry');
      if (row.type === 'reserve' && !held.has(row.id)) held.set(row.id, { ...row, settled: false });
      else if (row.type === 'settle' && held.has(row.id) && !held.get(row.id).settled && held.get(row.id).model === row.model) {
        if (row.tokens > held.get(row.id).tokens) throw new Error('usage_exceeds_reservation');
        held.set(row.id, { ...row, settled: true }); tokens += row.tokens; spend += row.nanoUsd;
      } else throw new Error('invalid_hr1_ledger_sequence');
    }
    return { held, tokens, spend, committed: [...held.values()].reduce((sum, row) => sum + row.nanoUsd, 0) };
  }
  function append(row) {
    const fd = openSync(path, 'a', 0o600);
    try { writeSync(fd, JSON.stringify({ format: 'hr1-api-ledger-v1', ...row, at: new Date().toISOString() }) + '\n'); fsyncSync(fd); }
    finally { closeSync(fd); }
  }
  return {
    reserve(model, texts) {
      if (!Object.hasOwn(PRICES, model) || !Array.isArray(texts) || !texts.length || texts.some(t => typeof t !== 'string' || !t.length))
        throw new Error('invalid_reservation');
      const tokens = texts.reduce((sum, text) => sum + Buffer.byteLength(text, 'utf8'), 0);
      const nanoUsd = tokens * PRICES[model];
      return locked(() => {
        const previous = state(read());
        if (previous.committed + nanoUsd > cap) throw new Error('hr1_api_cap_exceeded');
        const id = randomUUID();
        append({ type: 'reserve', id, model, tokens, nanoUsd });
        return id;
      });
    },
    settle(id, totalTokens) {
      if (!Number.isSafeInteger(totalTokens) || totalTokens < 0) throw new Error('invalid_usage');
      return locked(() => {
        const previous = state(read()), reservation = previous.held.get(id);
        if (!reservation || reservation.settled || totalTokens > reservation.tokens) throw new Error('invalid_settlement');
        append({ type: 'settle', id, model: reservation.model, tokens: totalTokens, nanoUsd: totalTokens * PRICES[reservation.model] });
      });
    },
    summary() {
      return locked(() => {
        const s = state(read());
        return { apiTokens: s.tokens, apiSpendUsd: s.spend / 1e9, committedUsd: s.committed / 1e9,
          outstandingReservations: [...s.held.values()].filter(row => !row.settled).length, capUsd: cap / 1e9 };
      });
    },
  };
}
