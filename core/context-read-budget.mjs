import { performance } from 'node:perf_hooks';

// One ledger per embedder identity in this process. Limits and representation
// options constrain shared totals; changing them never creates a new allowance.
const ledgers = new Map();
// A one-use, synchronous handoff lets the local port use this same ledger
// for direct calls without charging again when core already reserved it.
const reservations = new WeakMap();
export function consumeLocalReservation(token, port) {
  if (!token || reservations.get(token) !== JSON.stringify([port.id, port.revision])) return false;
  reservations.delete(token); return true;
}
const refused = code => Object.assign(new Error(code), { code });
export function contextBudget(options) {
  if (!options.budgetConfigured) return null;
  const { policy } = options;
  const local = policy.family === 'local' && policy.maxBatchDocuments === 1;
  const port = options.embedder;
  const binding = JSON.stringify([port?.id, port?.revision]);
  let ledger = ledgers.get(binding);
  if (!ledger) { ledger = { requests: 0, usd: 0, active: 0 }; ledgers.set(binding, ledger); }
  return async function dispatch(port, texts, { signal, deadlineAt, guard }) {
    const beforeDispatch = () => {
      guard();
      if (signal.aborted || performance.now() >= deadlineAt) throw refused('timeout');
    };
    guard();
    const usd = local ? 0 : policy.estimateUsd(Object.freeze([...texts]));
    guard();
    if (!Number.isFinite(usd) || usd < 0 || ledger.requests >= policy.maxRequests ||
        (!local && ledger.usd + usd > policy.maxUsd) || ledger.active >= policy.maxConcurrent) throw refused('budget_denied');
    if (signal.aborted || performance.now() >= deadlineAt) throw refused('timeout');
    // Reserve synchronously, immediately before invoking the port. Unknown
    // usage keeps the conservative full charge. Every invocation reserves anew.
    ledger.requests++; ledger.usd += usd; ledger.active++;
    let operation, invoked = false, actualUsd;
    // A trusted adapter may report validated usage. Hold the reservation until
    // the underlying attempt settles; unknown usage retains its full charge.
    const settleUsd = value => {
      if (!Number.isFinite(value) || value < 0 || actualUsd !== undefined) throw refused('provider_error');
      actualUsd = value;
    };
    try {
      beforeDispatch();
      // Adapters with internal awaits must call beforeDispatch immediately
      // before HTTP transmission. Core also fences every await/settlement.
      invoked = true;
      if (local) {
        const localReservation = {}; reservations.set(localReservation, binding);
        try { operation = Promise.resolve(port.embed(texts, { signal, beforeDispatch, deadlineAt, localReservation })); }
        finally { reservations.delete(localReservation); }
      } else operation = Promise.resolve(port.embed(texts, { signal, beforeDispatch, deadlineAt, settleUsd }));
    } catch (error) {
      ledger.active--;
      if (!invoked) { ledger.requests--; ledger.usd -= usd; }
      else if (actualUsd !== undefined) ledger.usd += actualUsd - usd;
      throw error;
    }
    const settled = () => { ledger.active--; if (actualUsd !== undefined) ledger.usd += actualUsd - usd; };
    operation.then(settled, settled);
    let timer, aborted;
    const timeout = new Promise((resolve, reject) => {
      aborted = () => reject(refused('timeout'));
      signal.addEventListener('abort', aborted, { once: true });
      timer = setTimeout(aborted, Math.max(0, deadlineAt - performance.now()));
    });
    try { const result = await Promise.race([operation, timeout]); beforeDispatch(); return result; }
    catch (error) { guard(); throw error; }
    finally { clearTimeout(timer); signal.removeEventListener('abort', aborted); }
  };
}
