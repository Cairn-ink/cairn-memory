import { performance } from 'node:perf_hooks';

// One ledger per frozen embedder/family/cap profile in this process. Rebuilding
// a handle or copying its constructor policy cannot reset requests or charges.
const ledgers = new Map();
const refused = code => Object.assign(new Error(code), { code });
export function contextBudget(options) {
  if (!options.budgetConfigured) return null;
  const { policy } = options;
  const port = options.embedder;
  const binding = JSON.stringify([port?.id, port?.revision, port?.dimensions, port?.normalization, options.family,
    policy.maxRequests, policy.maxUsd, policy.maxConcurrent]);
  let ledger = ledgers.get(binding);
  if (!ledger) { ledger = { requests: 0, usd: 0, active: 0 }; ledgers.set(binding, ledger); }
  return async function dispatch(port, texts, { signal, deadlineAt, guard }) {
    const beforeDispatch = () => {
      guard();
      if (signal.aborted || performance.now() >= deadlineAt) throw refused('timeout');
    };
    guard();
    const usd = policy.estimateUsd(Object.freeze([...texts]));
    guard();
    if (!Number.isFinite(usd) || usd < 0 || ledger.requests >= policy.maxRequests ||
        ledger.usd + usd > policy.maxUsd || ledger.active >= policy.maxConcurrent) throw refused('budget_denied');
    if (signal.aborted || performance.now() >= deadlineAt) throw refused('timeout');
    // Reserve synchronously, immediately before invoking the port. Unknown
    // usage keeps the conservative full charge. Every invocation reserves anew.
    ledger.requests++; ledger.usd += usd; ledger.active++;
    let operation, invoked = false;
    try {
      beforeDispatch();
      // Adapters with internal awaits must call beforeDispatch immediately
      // before HTTP transmission. Core also fences every await/settlement.
      invoked = true;
      operation = Promise.resolve(port.embed(texts, { signal, beforeDispatch }));
    } catch (error) {
      ledger.active--;
      if (!invoked) { ledger.requests--; ledger.usd -= usd; }
      throw error;
    }
    operation.then(() => { ledger.active--; }, () => { ledger.active--; });
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
