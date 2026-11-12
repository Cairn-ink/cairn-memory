import { AsyncLocalStorage } from 'node:async_hooks';
import { assertContentPort, inertContentPortValue, hasContentPortBoundary } from './content-safety-boundary.mjs';
import { performance } from 'node:perf_hooks';

// One ledger per embedder identity in this process. Limits and representation
// options constrain shared totals; changing them never creates a new allowance.
// Keep AsyncResource private: exposing a bound callback's .asyncResource
// would let a caller execute arbitrary work in the engine's request context.
function engineGuard(work) {
  const bound = AsyncLocalStorage.bind(work);
  return function beforeDispatch(...args) { return Reflect.apply(bound,undefined,args); };
}
const ledgers = new Map();
const enginePorts = new WeakSet();
export const isBudgetEmbeddingPort = port => enginePorts.has(port);
// A one-use, synchronous handoff lets the local port use this same ledger
// for direct calls without charging again when core already reserved it.
const reservations = new WeakMap();
export function consumeLocalReservation(token, port) {
  if (!token || reservations.get(token) !== JSON.stringify([port.id, port.revision])) return false;
  reservations.delete(token); return true;
}
const refused = code => Object.assign(new Error(code), { code });
const signalAborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const signalAdd=EventTarget.prototype.addEventListener,signalRemove=EventTarget.prototype.removeEventListener;
// A host receives this signal and may taint its properties or internal slots.
// Engine signal work has no E1 allowance; finish any hooks in caller scope
// before the embed invocation's existing, outer epoch observation.
const signalWork=work=>assertContentPort({invoke:()=>{try{return work();}catch(error){if(!hasContentPortBoundary())throw error;throw refused('timeout');}}});
const isSignalAborted=signal=>signalWork(()=>Boolean(hasContentPortBoundary()?Reflect.apply(signalAborted,signal,[]):signal.aborted));
const listenSignal=(signal,add,handler)=>signalWork(()=>{Reflect.apply(hasContentPortBoundary()?(add?signalAdd:signalRemove):(add?signal.addEventListener:signal.removeEventListener),signal,add?['abort',handler,{once:true}]:['abort',handler]);});
function portError(error) {
  if(!hasContentPortBoundary())return error;
  let frame;
  try { frame=inertContentPortValue({code:error?.code,name:error?.name,status:error?.status,reason:error?.reason},'provider_error'); } catch { return refused('provider_error'); }
  const safe=refused(typeof frame.code==='string'?frame.code:'provider_error');
  for(const key of ['name','reason'])if(typeof frame[key]==='string')safe[key]=frame[key];
  if(typeof frame.status==='number')safe.status=frame.status;
  return safe;
}

export function contextBudget(options) {
  if (!options.budgetConfigured) return null;
  const { policy } = options;
  const local = policy.family === 'local' && policy.maxBatchDocuments === 1;
  const port = options.embedder;
  const binding = JSON.stringify([port?.id, port?.revision]);
  let ledger = ledgers.get(binding);
  if (!ledger) { ledger = { requests: 0, usd: 0, active: 0 }; ledgers.set(binding, ledger); }
  async function dispatch(port, texts, { signal, deadlineAt, guard, onInvoke }) {
    // Hosts may call this engine guard before transmitting. Resume its own
    // request proof; a host callback itself still gets a fresh caller scope.
    // The final canonical guard must follow every mutable signal hook.
    const checkDispatch = engineGuard(function checkDispatch(phase) {
      if (isSignalAborted(signal) || performance.now() >= deadlineAt) throw refused('timeout');
      guard(phase);
    });
    const beforeDispatch = () => checkDispatch('pre-send');
    guard();
    const usd = local ? 0 : assertContentPort({invoke:()=>{try{const value=policy.estimateUsd(Object.freeze([...texts]));return typeof value==='number'?value:NaN;}catch(error){throw portError(error);}}});
    guard();
    if (!Number.isFinite(usd) || usd < 0 || ledger.requests >= policy.maxRequests ||
        (!local && ledger.usd + usd > policy.maxUsd) || ledger.active >= policy.maxConcurrent) throw refused('budget_denied');
    if (isSignalAborted(signal) || performance.now() >= deadlineAt) throw refused('timeout');
    // Reserve synchronously, immediately before invoking the port. Unknown
    // usage keeps the conservative full charge. Every invocation reserves anew.
    ledger.requests++; ledger.usd += usd; ledger.active++;
    let operation, invoked = false, actualUsd;
    const invoke = controls => assertContentPort({invoke:async()=>{
      try { return inertContentPortValue(await port.embed(texts, controls), 'provider_error', { rejectProxies: true }); }
      catch (error) {
        throw portError(error);
      }
    }});
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
      invoked = true; onInvoke?.();
      if (local) {
        const localReservation = {}; reservations.set(localReservation, binding);
        try { operation = invoke({ signal, beforeDispatch, deadlineAt, localReservation }); }
        finally { reservations.delete(localReservation); }
      } else operation = invoke({ signal, beforeDispatch, deadlineAt, settleUsd });
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
      listenSignal(signal,true,aborted);
      timer = setTimeout(aborted, Math.max(0, deadlineAt - performance.now()));
    });
    try { const result = await Promise.race([operation, timeout]); checkDispatch('post-send'); return result; }
    catch (error) { guard('post-send'); throw error; }
    finally { clearTimeout(timer); listenSignal(signal,false,aborted); }
  }
  // The only marked ports execute this ledger's fixed dispatch implementation.
  // Public configuration validation creates fresh objects, so a caller cannot
  // attach the provenance to its own callback.
  dispatch.port = (port, controls) => {
    let invoked=false;
    const wrapper=Object.freeze({didInvoke:()=>invoked,id:port.id,revision:port.revision,dimensions:port.dimensions,
      normalization:port.normalization,embed:(texts, extra)=>{invoked=false;return dispatch(port,texts,{...controls,
        onInvoke:()=>{invoked=true;},guard:phase=>{controls.guard(phase);extra.beforeDispatch(phase);}});}});
    enginePorts.add(wrapper);return wrapper;
  };
  return dispatch;
}
