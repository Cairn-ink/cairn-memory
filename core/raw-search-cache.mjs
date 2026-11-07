import { performance } from 'node:perf_hooks';
import { reserveSharedVectors } from './context-read-embedder.mjs';

export const RAW_SEARCH_CADENCE_MS = 1000;
export const RAW_SEARCH_CACHE_IDLE_MS = 5000;

/** Private to one local reader. Hints and scores never establish eligibility.
 * Reservations survive eviction while an in-flight operation still borrows a
 * block; successors cannot reuse either that block or its reservation. */
export function createRawSearchCache({ enabled, checkKey, now = () => performance.now(),
  setTimer = setInterval, clearTimer = clearInterval }) {
  let entry = null, timer = null, closed = false;
  function drop() {
    const previous = entry; entry = null;
    if (previous) { previous.retired = true; release(previous); }
    if (timer !== null) { clearTimer(timer); timer = null; }
  }
  function release(value) {
    if (value.retired && !value.borrowers) {
      value.rows = null; value.vectors = null; value.residency.release();
    }
  }
  function borrow(value) {
    value.borrowers++; value.usedAt = now(); let released = false;
    return { rows:value.rows, vectors:value.vectors, release() {
      if (!released) { released = true; value.borrowers--; release(value); }
    } };
  }
  function acquire(key) {
    if (!enabled || closed) return null;
    if (entry && (entry.key !== key || now() - entry.usedAt >= RAW_SEARCH_CACHE_IDLE_MS)) drop();
    return entry ? borrow(entry) : null;
  }
  function maintain() {
    if (!entry) return;
    try {
      if (now() - entry.usedAt >= RAW_SEARCH_CACHE_IDLE_MS || checkKey() !== entry.key) drop();
    } catch { drop(); } // Unavailable authority drops private hints silently.
  }
  function install(key, rows, vectors, metadata, hintBytes,check=()=>{}) {
    if (!enabled || closed) return null;
    drop();
    // Account for the bounded hints and block indexing as well as fp32 payload.
    // Four times the encoded hint size reserves decoded hint overhead too.
    const overhead = hintBytes * 4 + (vectors?.offsets.byteLength ?? 0) + rows.length * 64;
    const residency = reserveSharedVectors(vectors?.count ?? 0, metadata, overhead);
    if (!residency) return null;
    let hints;
    try{hints=rows.map(row => {check();return {...row,chunks:row.chunks.map(({vector,...chunk}) => {
      check();return {...chunk,...(vector?{vector:true}:{})};})};});}
    catch(error){residency.release();throw error;}
    entry = { key, rows:hints, vectors, residency,
      usedAt:now(), borrowers:0, retired:false };
    timer = setTimer(maintain, RAW_SEARCH_CADENCE_MS); timer?.unref?.();
    return borrow(entry);
  }
  return { acquire, install, maintain, drop, close() { closed = true; drop(); } };
}
