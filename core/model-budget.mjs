import { types } from 'node:util';
import { assertContentPort } from './content-safety-boundary.mjs';
import { fail } from './validation.mjs';

// Only engine-created projection counters have this provenance. Caller IDs
// never grant it. The factory supplies the implementation, not a host callback.
const projectionCounters = new WeakSet();
const mapGet=Map.prototype.get,mapSet=Map.prototype.set,mapForEach=Map.prototype.forEach;
export function engineProjectionCounter(tokenCounts) {
  // Snapshot primitive values with intrinsic Map operations. Even importing
  // this internal factory cannot register an arbitrary host callback or .get.
  const values=new Map();
  try { mapForEach.call(tokenCounts,(count,text)=>{if(typeof text!=='string'||!Number.isSafeInteger(count)||count<0)fail('invalid_input');mapSet.call(values,text,count);}); }
  catch { fail('invalid_input'); }
  const counter = Object.freeze({ id: 'internal-projection', countTokens: text => mapGet.call(values,text) ?? 0 });
  projectionCounters.add(counter);
  return counter;
}

// Looking up a callback must not itself execute caller code between two
// dispatches. Accept inherited data methods, refuse accessors and Proxy chains.
export function modelPortValue(model, key, code) {
  if (!model || !['object','function'].includes(typeof model)) return undefined;
  for (let target=model;target;target=Object.getPrototypeOf(target)) {
    if (types.isProxy(target)) fail(code);
    const descriptor=Object.getOwnPropertyDescriptor(target,key);
    if (descriptor) {
      if (!Object.hasOwn(descriptor,'value')) fail(code);
      return descriptor.value;
    }
  }
}

// The host supplies the exact tokenizer for its model. No heuristic fallback.
export function countTokens(model, text, afterReturn) {
  const internal = projectionCounters.has(model);
  const counter = modelPortValue(model,'countTokens','token_count_unavailable');
  if (typeof counter !== 'function') fail('token_count_unavailable');
  if (!internal) assertContentPort({before:true});
  let count;
  try {
    // Resolve a caller getter within the boundary too. Counts must already be
    // primitive integers: never retain a caller coercion or thenable.
    const invoke = () => {
      const value = Reflect.apply(counter,model,[text]);
      if (typeof value !== 'number') fail('token_count_unavailable');
      return value;
    };
    count = internal ? invoke() : assertContentPort({invoke});
  } catch { fail('token_count_unavailable'); }
  finally {
    if (!internal) {
      // Synchronous authority work belongs before this invocation's sole E1
      // read. No caller code remains between that read and the next dispatch.
      try { if (afterReturn) assertContentPort({invoke:afterReturn}); }
      finally { assertContentPort(); }
    }
  }
  if (!Number.isSafeInteger(count) || count < 0) fail('token_count_unavailable');
  return count;
}
