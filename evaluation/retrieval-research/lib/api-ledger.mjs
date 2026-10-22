import { randomUUID } from 'node:crypto';
import * as filesystem from 'node:fs';
import { dirname, resolve } from 'node:path';

// Integer nano-USD avoids fractional-dollar cap comparisons. Every dispatch,
// including retries, reserves separately. A crashed/unknown attempt stays held.
export const PRICES = Object.freeze({ 'text-embedding-3-small': 20, 'text-embedding-3-large': 130 });
export function createApiLedger(path, { capUsd = 1, fs = filesystem } = {}) {
  if (!path || !Number.isFinite(capUsd) || capUsd <= 0 || capUsd > 1) throw new Error('invalid_hr1_ledger');
  const io = { ...filesystem, ...fs };
  path = resolve(path);
  const parent = dirname(path);
  function syncDirectory(directory) {
    const fd = io.openSync(directory, 'r');
    try { io.fsyncSync(fd); } finally { io.closeSync(fd); }
  }
  function ensureDirectory(directory) {
    const ancestor = dirname(directory);
    try { io.mkdirSync(directory); }
    catch (error) {
      if (error.code === 'ENOENT' && ancestor !== directory) {
        ensureDirectory(ancestor);
        io.mkdirSync(directory);
      } else if (error.code !== 'EEXIST' || !io.statSync(directory).isDirectory()) throw error;
    }
    // Persist each new directory and its entry in its parent before creating
    // descendants. Re-sync existing directories too: a prior failed attempt
    // may have created one without completing its durability fence.
    syncDirectory(directory);
    if (ancestor !== directory) syncDirectory(ancestor);
  }
  ensureDirectory(parent);
  const cap = Math.floor(capUsd * 1e9);
  const locked = work => {
    // Fail closed on contention or a crash-left lock. Never steal a live lock.
    io.mkdirSync(`${path}.lock`);
    try {
      syncDirectory(`${path}.lock`);
      syncDirectory(parent);
      return work();
    } finally { io.rmdirSync(`${path}.lock`); syncDirectory(parent); }
  };
  function read() {
    let text;
    try { text = io.readFileSync(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
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
    const fd = io.openSync(path, 'a', 0o600);
    try {
      const bytes = Buffer.from(JSON.stringify({ format: 'hr1-api-ledger-v1', ...row, at: new Date().toISOString() }) + '\n');
      let offset = 0;
      while (offset < bytes.length) {
        const written = io.writeSync(fd, bytes, offset, bytes.length - offset);
        if (written <= 0) throw new Error('hr1_ledger_write_failed');
        offset += written;
      }
      io.fsyncSync(fd);
    } finally { io.closeSync(fd); }
    // File fsync alone does not persist a newly created ledger's name. No
    // reservation may return (and hence dispatch) until this entry is durable.
    syncDirectory(parent);
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
