import { timingSafeEqual } from 'node:crypto';
import { keyed, cardNamespace } from './private-card-input.mjs';
import { methodReadSet, sameNamespace } from './method-package-input.mjs';
import { identifier, fail } from './validation.mjs';

export const TASK_RECEIPT_VERSION = 'task-receipt-v1';
export const canonicalObject = value => Array.isArray(value) ? value.map(canonicalObject) : value && typeof value === 'object' ?
  Object.fromEntries(Object.keys(value).sort((a,b) => Buffer.compare(Buffer.from(a),Buffer.from(b))).map(key => [key,canonicalObject(value[key])])) : value;
export const canonicalJSON = value => JSON.stringify(canonicalObject(value));
// Compare only well-formed full MAC strings, with a fixed-width byte comparison.
// Receipt and role-cursor callers choose their own closed failure code.
export function authenticatedMAC(expected,supplied) {
  if(typeof expected!=='string'||typeof supplied!=='string'||
    !/^[A-Za-z0-9_-]{43}$/.test(expected)||!/^[A-Za-z0-9_-]{43}$/.test(supplied))return false;
  const a=Buffer.from(expected),b=Buffer.from(supplied);
  return a.length===b.length&&timingSafeEqual(a,b);
}
const bad = () => fail('invalid_receipt');
const isId = value => { try { identifier(value); } catch { bad(); } };
const mac = value => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) bad(); };
const uint = (value, positive = false) => { if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) bad(); };
const tuple = (value, n) => { if (!Array.isArray(value) || value.length !== n) bad(); };
const list = (value, n, min = 0) => { if (!Array.isArray(value) || value.length < min || value.length > n) bad(); };
const closed = (value, keys) => { if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).length !== keys.split(' ').length || Object.keys(value).sort().join() !== keys.split(' ').sort().join()) bad(); };
const distinct = values => { if (new Set(values.map(value=>JSON.stringify(value))).size !== values.length) bad(); };

// A bounded lexical pass precedes JSON.parse and every recursive traversal.
// Object-key sets are per container; escaped duplicates compare decoded keys.
function preflight(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text,'utf8') > 32768 || !text.isWellFormed()) bad();
  const stack = []; let nodes = 0, i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '{' || ch === '[') {
      if (++nodes > 8192 || stack.length >= 12) bad();
      stack.push({ object:ch === '{', keys:new Set(), key:ch === '{' }); i++; continue;
    }
    if (ch === '}' || ch === ']') { if (!stack.length) bad(); stack.pop(); i++; continue; }
    if (ch === ',') { if (stack.at(-1)?.object) stack.at(-1).key = true; i++; continue; }
    if (ch === ':') { if (stack.at(-1)) stack.at(-1).key = false; i++; continue; }
    if (++nodes > 8192) bad();
    if (ch === '"') {
      const start = i++;
      while (i < text.length && text[i] !== '"') { if (text[i] === '\\') i++; i++; }
      if (i >= text.length) bad();
      let scalar; try { scalar = JSON.parse(text.slice(start,++i)); } catch { bad(); }
      if (scalar.length > 200 || !scalar.isWellFormed() || scalar.includes('\0')) bad();
      const top = stack.at(-1);
      if (top?.object && top.key) { if (top.keys.has(scalar)) bad(); top.keys.add(scalar); }
    } else {
      const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
      if (!match) bad(); i += match[0].length;
    }
  }
  if (stack.length) bad();
}
export function validateTaskReceiptPayload(p) {
  closed(p,'id readSet roleKey profiles heads methods evidence'); isId(p.id);
  if (typeof p.roleKey !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(p.roleKey)) bad();
  let readSet; try { readSet = methodReadSet(p.readSet); } catch { bad(); }
  if (readSet.some((ns,index)=>!sameNamespace(ns,p.readSet[index]))) bad();
  const nsIndex = value => { uint(value); if (value >= readSet.length) bad(); };
  list(p.profiles,21);
  for (const row of p.profiles) { tuple(row,5); nsIndex(row[0]); isId(row[1]); isId(row[2]); mac(row[3]); if (![1,2].includes(row[4])) bad(); }
  distinct(p.profiles.map(v=>v.slice(0,3)));
  list(p.heads,2,1);
  const precedence = readSet.map((_,i) => i).reverse();
  for (let i=0;i<p.heads.length;i++) {
    const h=p.heads[i]; tuple(h,5); if (h[0] !== precedence[i]) bad();
    if (h[1] === null) { if (h.slice(2).some(v => v !== null)) bad(); }
    else {
      isId(h[1]); uint(h[2],true); if (!['active','disabled'].includes(h[3]) || i !== p.heads.length-1) bad();
      if (h[4] !== null) { uint(h[4]); const r=p.profiles[h[4]]; if (!r || r[0] !== h[0] || r[1] !== h[1]) bad(); }
      else if (h[3] === 'active') bad();
    }
  }
  if (p.heads.at(-1)[1] === null && p.heads.length !== readSet.length) bad();
  list(p.methods,16);
  const levels=readSet.flatMap(ns => ns.scope === 'project' ? [0,1] : [2,3]).sort((a,b)=>a-b);
  for (const m of p.methods) {
    tuple(m,7); const [scope,pkg,status,version,winner,bindings,life]=m;
    const inaccessible = typeof scope === 'object' && scope !== null;
    if (inaccessible) {
      try { cardNamespace(scope); } catch { bad(); }
      if (readSet.some(ns => sameNamespace(ns,scope)) || scope.ownerId !== readSet[0].ownerId || status === 'current' || life !== null) bad();
    } else nsIndex(scope);
    isId(pkg); if (!['current','disabled','unavailable','no-active-version'].includes(status)) bad();
    if (version !== null) { tuple(version,2); isId(version[0]); mac(version[1]); }
    list(bindings,4,1);
    for (let i=0;i<bindings.length;i++) {
      const b=bindings[i]; tuple(b,3); if (b[0] !== levels[i]) bad();
      if (b[1] === null) { if (b[2] !== null) bad(); }
      else { uint(b[1],true); if (!['active','disabled'].includes(b[2]) || i !== bindings.length-1 || winner !== b[0]) bad(); }
    }
    const last=bindings.at(-1);
    if (last[1] === null && (winner !== null || bindings.length !== levels.length || status !== 'no-active-version')) bad();
    if (status === 'current' && (!version || last[2] !== 'active') || status === 'disabled' && (version !== null || last[2] !== 'disabled') || status === 'no-active-version' && version !== null) bad();
    if (last[2] === 'disabled' && status !== 'disabled' || last[2] === 'active' && !['current','unavailable'].includes(status)) bad();
    if (!inaccessible) {
      tuple(life,4); uint(life[0],true); if (!['available','deleted'].includes(life[1])) bad();
      if (life[2] === null) { if (life[3] !== null) bad(); }
      else if (!(life[2] === 1 && life[3] === 'available' || life[2] === 2 && life[3] === 'deleted')) bad();
      if (status === 'current' && (life[1] !== 'available' || life[2] !== 1)) bad();
      if (status === 'unavailable' && life[1] === 'available' && life[2] === 1 || ['disabled','no-active-version'].includes(status) && life[2] !== null || version !== null && life[2] === null) bad();
    }
  }
  distinct(p.methods.map(m=>[Number.isInteger(m[0])?m[0]:[m[0].ownerId,m[0].scope,m[0].projectId],m[1]]));
  list(p.evidence,24);
  for (let i=0;i<p.evidence.length;i++) {
    const e=p.evidence[i]; tuple(e,3); const [r,f,sources]=e;
    if (!Array.isArray(r) || ![0,1].includes(r[1])) bad(); tuple(r,r[1] === 0 ? 4 : 5);
    nsIndex(r[0]); isId(r[2]); uint(r[3],true); if (r[1] === 1) uint(r[4],true); mac(f); list(sources,r[1] === 1 ? 0 : 16);
    let previous=-1;
    for (const [sourcePosition,s] of sources.entries()) {
      tuple(s,4); uint(s[0]); if (s[0] > 15 || s[0] <= previous) bad(); previous=s[0]; isId(s[1]); mac(s[2]);
      if (s[3] !== null && s[3] !== 'body') {
        tuple(s[3],2); const [item,source]=s[3]; uint(item); uint(source);
        if (item > i || item === i && source >= sourcePosition || p.evidence[item]?.[2]?.[source]?.[3] !== null) bad();
      }
    }
  }
  distinct(p.evidence.map(e=>e[0]));
  return p;
}
export function encodeTaskReceipt(identity,payload,measureOversize = false) {
  // Apply the same wire/parser bounds to internally issued receipts.
  const p=canonicalObject(payload), mac=keyed(identity.cursorSecret,TASK_RECEIPT_VERSION,[identity.storeId,p]);
  const text=canonicalJSON({v:TASK_RECEIPT_VERSION,p,mac}); if(!measureOversize || Buffer.byteLength(text)<=32768)preflight(text); validateTaskReceiptPayload(p); return text;
}
export function parseTaskReceipt(identity,text) {
  try {
    preflight(text); const envelope=JSON.parse(text); closed(envelope,'v p mac');
    if (envelope.v !== TASK_RECEIPT_VERSION) bad(); mac(envelope.mac); validateTaskReceiptPayload(envelope.p);
    if (canonicalJSON(envelope) !== text) bad();
    const expected=keyed(identity.cursorSecret,TASK_RECEIPT_VERSION,[identity.storeId,canonicalObject(envelope.p)]);
    if (!authenticatedMAC(expected,envelope.mac)) bad();
    return envelope.p;
  } catch { bad(); }
}
