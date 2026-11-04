// Test-only census of every function supplied in host configuration, including
// authority, policy, diagnostics and crypto callbacks as well as E1 payload ports.
import { openMemoryCore } from '../index.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
let calls=0;
export const contentHostInvocations = () => calls;
export function trackContentHostOptions(input) {
 const seen=new WeakMap(),originals=new WeakMap();
 function copy(value){
  if(typeof value==='function'){
   if(!seen.has(value))seen.set(value,function(...args){calls++;return Reflect.apply(value,originals.get(this)??this,args);});
   return seen.get(value);
  }
  if(!value||typeof value!=='object'||ArrayBuffer.isView(value))return value;
  const proto=Object.getPrototypeOf(value);
  if(proto!==Object.prototype&&proto!==null&&!Array.isArray(value))return value;
  if(seen.has(value))return seen.get(value);
  const out=Array.isArray(value)?[]:Object.create(proto);seen.set(value,out);originals.set(out,value);
  const fields=Object.getOwnPropertyDescriptors(value);
  for(const key of Reflect.ownKeys(fields)){
   const field=fields[key];
   if(Array.isArray(value)&&key==='length')continue;
   if(Object.hasOwn(field,'value'))field.value=copy(field.value);
   Object.defineProperty(out,key,field);
  }
  return out;
 }
 return copy(input);
}
export const openCostMemoryCore = input => openMemoryCore(trackContentHostOptions(input));
export const openCostRawCaptureCore = (input,raw) => openRawCaptureCore(trackContentHostOptions(input),trackContentHostOptions(raw));
