import { sourceRef, snapshot as authoritySnapshot } from './private-card-input.mjs';
import { withContentWriteOperation, contentWriteMethodClass, contentWriteBoundaryConnection } from './content-write-context.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { contentReadSafety, sourceReadSafety } from './content-safety.mjs';
import { types } from 'node:util';
import { cachedContentLayout, installedContentLayout } from './content-safety-schema.mjs';
import { contentSuppressionFenceInside, contentSuppressionReasonInside, contentSuppressionMayMatchInside, contentSuppressionRequestFenceInside, cachedContentSuppressionRequestInside, hasContentSuppressionRequestInside, contentSuppressionRequestInside, withoutContentSuppressionReadCacheInside, withContentSuppressionRequest } from './content-suppression-storage.mjs';
import { fail, MemoryStoreError } from './validation.mjs';
// This boundary is in the CLI's static import closure. Keep error framing free
// of the database module so help/configuration never links node:sqlite.
const isStorageBusy = error => error?.code === 'ERR_SQLITE_ERROR' &&
  Number.isInteger(error.errcode) && [5, 6].includes(error.errcode & 0xff);

/** Capture primitive scope bindings before any caller callback or await. Never
 * inspect credentials, invoke accessors, or infer a namespace from current rows. */
export function contentScopes(input) {
  const result = new Map(), seen = new Set();
  let remaining = 65536;
  function visit(value, depth = 0) {
    if (!value || typeof value !== 'object' || ArrayBuffer.isView(value) || seen.has(value)) return;
    if (depth > 32 || types.isProxy(value) || --remaining < 0) fail('invalid_input');
    seen.add(value);
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Object.values(fields).some(field => !Object.hasOwn(field,'value'))) fail('invalid_input');
    const ownerId = fields.ownerId?.value;
    if (typeof ownerId === 'string') {
      const scope = fields.scope?.value, projectId = fields.projectId?.value ?? '';
      const scoped = ['personal','project'].includes(scope);
      if (scoped && typeof projectId !== 'string') fail('invalid_input');
      const ns = { ownerId, scope: scoped ? scope : 'owner', projectId: scoped ? projectId : '' };
      result.set(JSON.stringify(ns), ns);
    }
    for (const field of Object.values(fields)) if (Object.hasOwn(field, 'value')) visit(field.value, depth + 1);
  }
  visit(input);
  return [...result.values()];
}
export function assertContentScopes(db, scopes, code = 'evidence_unavailable') {
  if (!db || !(cachedContentLayout(db) ?? installedContentLayout(db)).suppressionRevision) return;
  // installedContentLayout reattests changed metadata and shares native refusal.
  if (scopes.length && hasContentSuppressionRequestInside(db)) contentSuppressionRequestInside(db, scopes);
  else if (!cachedContentSuppressionRequestInside(db)) installedContentLayout(db);
  for (const ns of scopes) {
    if (contentSuppressionReasonInside(db, ns)) fail(code);
    // Owner-only APIs aggregate namespaces: any erased namespace makes an
    // unfiltered owner aggregate unavailable as well.
    if(ns.scope==='owner'){
      const facts=db.prepare(`SELECT kind,match_mode FROM content_suppressions INDEXED BY content_suppression_window
        WHERE owner_id=? ORDER BY epoch_hi,epoch_lo LIMIT 4097`).all(ns.ownerId);
      if(facts.length>4096||facts.some(f=>f.kind==='namespace'&&f.match_mode==='namespace'))fail(code);
    }
  }
}
// Only this private, deeply frozen control result may cross a closed capture
// boundary. Its identity survives nested facades without certifying caller data.
const closedCaptureControl = Object.freeze({ok:true,value:Object.freeze({classification:Object.freeze({status:'failed'})})});

const activeReadBoundaries = new AsyncLocalStorage();
const callerPortReads = new AsyncLocalStorage();

/** One entry/delivery boundary, shared by synchronous and asynchronous facades.
 * New methods are gated by default; the independently frozen test inventory
 * requires an explicit classification whenever the public method set changes. */
export function contentSafetyFacade(api, { check, noOwner = [], failure, select = args => args[0], asyncMethods = [], validate, portGuard, requestScope, isFailedCapture, writeBoundary = check }) {
  const exempt = new Set(noOwner), facadeToken = {};
  return Object.freeze(Object.fromEntries(Object.entries(api).map(([method, value]) => {
    if (typeof value !== 'function' || exempt.has(method)) return [method, value];
    const asynchronous = types.isAsyncFunction(value) || asyncMethods.includes(method);
    return [method, function(...args) {
      const native = contentWriteBoundaryConnection(writeBoundary);
      const enclosing = activeReadBoundaries.getStore();
      const reentered = native && enclosing?.get(native)?.has(facadeToken);
      const nestedRead = native && enclosing?.has(native) && !reentered && contentWriteMethodClass(method) === 'read';
      const execute = () => {
        let scopes, delivering = false;
        const rejected = error => {
          // A deferred scope proof must also cover a method that fails before
          // reaching its ordinary snapshot. No protected result is delivered.
          if (scopes && !delivering) {
            delivering = true;
            try { check(scopes,{delivery:true}); } catch (denial) { error = denial; }
          }
          if (failure) return failure(error,method);
          throw error;
        };
        try {
          // An engine snapshot held by a synchronous host callback cannot
          // certify a new caller read after another connection commits a fact.
          if(callerPortReads.getStore()&&native?.isOpen!==false&&native?.isTransaction&&contentWriteMethodClass(method)==='read')fail('evidence_unavailable');
          scopes = contentScopes(select(args, method));
          check(scopes,{delivery:false});
          const deliver = result => {
            delivering = true;
            try { if (!nestedRead) check(scopes,{delivery:true}); }
            catch(error) {
              if(method==='capture'&&error.code==='store_closed'&&
                  (result===closedCaptureControl||isFailedCapture?.(result)))return closedCaptureControl;
              throw error;
            }
            validate?.(method,args,result,scopes); return result;
          };
          const invoke = () => withContentWriteOperation(method,scopes,()=>Reflect.apply(value,api,args),writeBoundary);
          const result = portGuard ? contentPorts.run(portGuard(scopes),invoke) : invoke();
          return types.isPromise(result) ? result.then(deliver).catch(rejected) : deliver(result);
        } catch (error) {
          if (failure) { const result = rejected(error); return asynchronous ? Promise.resolve(result) : result; }
          if (scopes && !delivering) { delivering = true; check(scopes,{delivery:true}); }
          if (asynchronous) return Promise.reject(error);
          throw error;
        }
      };
      const scoped = () => {
        if (!native) return execute();
        const boundaries = new Map(enclosing);
        boundaries.set(native,new Set([...(enclosing?.get(native) ?? []),facadeToken]));
        return activeReadBoundaries.run(boundaries,execute);
      };
      const begin = () => requestScope ? requestScope(scoped, method) : contentWriteMethodClass(method) === 'read' ? withContentSuppressionRequest(scoped) : scoped();
      // A caller port may issue multiple independent reads. Its fresh callback
      // context is not itself a read request: each outermost facade invocation
      // must obtain a new proof, even when that callback is still awaiting.
      const start = () => reentered || callerPortReads.getStore() && native && !enclosing?.has(native) && contentWriteMethodClass(method)==='read'
        ? withContentSuppressionRequest(begin,{fresh:true}) : begin();
      const connection = contentWriteMethodClass(method) === 'write' && contentWriteBoundaryConnection(writeBoundary);
      return connection ? withoutContentSuppressionReadCacheInside(connection, start) : start();
    }];
  })));
}

// Counter callbacks can commit a fact while a bounded assembly is shrinking.
// Preserve the entry fence through awaits; do not dispatch retained text again
// after any fact advanced. Legacy stores acquire no additional SQL statements.
const contentPorts = new AsyncLocalStorage();
export const hasContentPortBoundary = () => Boolean(contentPorts.getStore());
// Only an attested legacy facade may use its original model freshness order.
// A standalone helper call has no such proof and keeps the pre-counter check.
export const hasLegacyContentReadBoundary = () => {
  const boundaries = activeReadBoundaries.getStore();
  return Boolean(boundaries?.size && [...boundaries.keys()].every(db =>
    cachedContentLayout(db)?.suppressionRevision === 0));
};
export function assertContentPort(phase) {
  // Caller re-entry is a new read request, not trusted facade forwarding.
  if (phase?.invoke) return callerPortReads.run(true,()=>activeReadBoundaries.exit(() => withContentSuppressionRequest(phase.invoke,{fresh:true})));
  contentPorts.getStore()?.(phase);
}
// Materialize caller data while still inside its port boundary. Property,
// Proxy and iterator hooks run here, before the single epoch observation. No
// caller prototype, accessor, iterator or coercion hook survives the copy.
export function inertContentPortValue(value, code = 'invalid_input') {
  let remaining = 3_000_000;
  const active = new Set();
  function copy(input, depth = 0) {
    if (--remaining < 0 || depth > 32) fail(code);
    if (input === null || ['undefined','string','number','boolean','bigint'].includes(typeof input)) return input;
    if (typeof input !== 'object' || active.has(input)) fail(code);
    active.add(input);
    try {
      if (Array.isArray(input) || ArrayBuffer.isView(input)) {
        const length = input.length;
        if (!Number.isSafeInteger(length) || length < 0 || length > remaining) fail(code);
        const result = [];
        for (const item of input) {
          if (result.length >= length) fail(code);
          result.push(copy(item, depth + 1));
        }
        if (result.length !== length) fail(code);
        // Keep enumerable non-index fields so downstream shape validation
        // does not accidentally accept an array it previously refused.
        for (const key of Object.keys(input)) {
          const index=Number(key);
          if (Number.isInteger(index) && index>=0 && index<length && String(index)===key) continue;
          Object.defineProperty(result,key,{value:copy(input[key],depth+1),enumerable:true,writable:true,configurable:true});
        }
        return result;
      }
      const result = {};
      for (const key of Object.keys(input)) Object.defineProperty(result, key, {
        value: copy(input[key], depth + 1), enumerable: true, writable: true, configurable: true,
      });
      return result;
    } finally { active.delete(input); }
  }
  try { return copy(value); }
  catch { fail(code); }
}

// Preserve opaque grant identity only inside the next host invocation. Engine
// checks receive plain snapshots; no host getter or Proxy survives that return.
const authorityPorts=new WeakMap(),promiseThen=Promise.prototype.then;
export function contentAuthorityPort(port, snapshotValue = authoritySnapshot) {
  if(!port||!['object','function'].includes(typeof port))fail('authority_required');
  let ports=authorityPorts.get(snapshotValue);if(!ports){ports=new WeakMap();authorityPorts.set(snapshotValue,ports);}
  if(ports.has(port))return ports.get(port);
  const grants=new WeakMap(),methods={};
  for(const name of ['authorize','isCurrent']){
    let method;
    for(let value=port;value;value=Object.getPrototypeOf(value)){
      if(types.isProxy(value))fail('authority_required');
      const descriptor=Object.getOwnPropertyDescriptor(value,name);
      if(descriptor){if(!Object.hasOwn(descriptor,'value'))fail('authority_required');method=descriptor.value;break;}
    }
    if(typeof method!=='function'||types.isAsyncFunction(method))fail('authority_required');
    methods[name]=(...input)=>assertContentPort({invoke:()=>{
      try{
        const args=[...input];if(name==='isCurrent'&&grants.has(args[0]))args[0]=grants.get(args[0]);
        const value=Reflect.apply(method,port,args);
        if(types.isPromise(value)){Reflect.apply(promiseThen,value,[undefined,()=>{}]);fail('authority_required');}
        let snapshot;try{snapshot=snapshotValue(value);}catch{fail('authority_required');}
        if(snapshot&&typeof snapshot==='object')grants.set(snapshot,value);
        return snapshot;
      }catch(error){
        let code='storage_error';
        try{if(isStorageBusy(error))code='storage_busy';else{const candidate=error instanceof MemoryStoreError?error.code:undefined;if(typeof candidate==='string')code=candidate;}}catch{}
        throw new MemoryStoreError(code);
      }
    }});
  }
  const bound=Object.freeze(methods);ports.set(port,bound);ports.set(bound,bound);return bound;
}
export function contentScopeEpochGuard(db, scopes) {
  if (!db || !(cachedContentLayout(db) ?? installedContentLayout(db)).suppressionRevision) return undefined;
  const owners = [...new Set(scopes.map(ns => ns.ownerId))];
  let expected = hasContentSuppressionRequestInside(db) ? null : owners.map(owner => contentSuppressionRequestFenceInside(db,owner));
  return ({ before = false } = {}) => {
    if (before) { expected ??= owners.map(owner => contentSuppressionRequestFenceInside(db,owner)); return; }
    if (db.isOpen === false) fail('store_closed');
    if (db.isTransaction) fail('storage_error');
    for (const [i,owner] of owners.entries()) {
      const before = expected?.[i] ?? contentSuppressionRequestFenceInside(db,owner);
      // E1: this autocommit SELECT runs after the caller returns, before its
      // result is inspected or another protected payload reaches a caller port.
      const row = db.prepare('SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs WHERE owner_id=?').get(owner);
      if ((row ? `${row.epoch_hi}:${row.epoch_lo}` : '0:0') !== before) fail('evidence_unavailable');
    }
  };
}

/** Count only retained readable receipt identities. The target index proves
 * unrelated rows have no receipt fact; bounded candidates use the same predicate
 * as excerpt delivery. Refuse rather than materializing an unbounded denial set. */
export function contentReceiptCount(db, namespace, memory, total) {
  if (!(cachedContentLayout(db) ?? installedContentLayout(db)).suppressionRevision) return total;
  const request = cachedContentSuppressionRequestInside(db, namespace.ownerId);
  const covered = request?.epoch === '0:0' || request?.readSet.some(selected => selected.scope === 'owner' ||
    selected.scope === namespace.scope && (selected.projectId ?? '') === (namespace.projectId ?? ''));
  if (request?.owner === namespace.ownerId && covered && request.facts && !request.facts.some(f =>
      f.kind === 'receipt' && f.scope === namespace.scope && f.project_id === (namespace.projectId ?? ''))) return total;
  const rows = db.prepare(`SELECT r.* FROM receipts r WHERE r.memory_id=? AND EXISTS(
    SELECT 1 FROM content_suppressions f INDEXED BY content_suppression_target WHERE
    f.owner_id=? AND f.scope=? AND f.project_id=? AND f.kind='receipt' AND f.stable_key=r.id AND f.incarnation=r.id) LIMIT 129`)
    .all(memory.id,namespace.ownerId,namespace.scope,namespace.projectId ?? '');
  if (rows.length > 128) fail('evidence_unavailable');
  const denied = rows.filter(receipt => !contentReadSafety(db,{namespace,intent:'history',ref:{type:'memory',namespace,
    memoryId:memory.id,revision:memory.revision},receipts:[receipt]}).allowed).length;
  return total - denied;
}

/** Metadata references contribute to the output too. Source refs use S1's
 * predicate; historical audit refs use its shared fact matcher without
 * inventing a missing revision or rebinding them to the current version. */
export function assertContentOutput(db, identity, value, scopes = [], { factsOnly = false } = {}) {
  if (!(cachedContentLayout(db) ?? installedContentLayout(db)).suppressionRevision) return;
  const fallback = scopes.filter(ns=>['personal','project'].includes(ns.scope));
  const seen = new Set();
  const fact = (namespace,kind,key,revision,extra={}) => {
    if(typeof key!=='string'||!namespace)return;
    const state = cachedContentSuppressionRequestInside(db, namespace.ownerId);
    if (state?.completed?.has(JSON.stringify([namespace.ownerId,namespace.scope,namespace.projectId??'',kind,key,revision]))) return;
    const tag={memory:'memory-revision-v1','submitted-note':'note-v1'}[kind];
    const version=tag&&Number.isSafeInteger(revision)?JSON.stringify([tag,revision]):undefined;
    if(contentSuppressionReasonInside(db,namespace,{kind,key,revision,version,...extra}))fail('evidence_unavailable');
    if (kind==='raw' && contentSuppressionMayMatchInside(db,namespace,{kind,key}) && (!extra.messageId || !Number.isSafeInteger(extra.start) || !Number.isSafeInteger(extra.end)) &&
        db.prepare(`SELECT 1 FROM content_suppressions INDEXED BY content_suppression_target
          WHERE owner_id=? AND scope=? AND project_id=? AND kind='raw' AND stable_key=? AND incarnation=? AND match_mode='span' LIMIT 1`)
          .get(namespace.ownerId,namespace.scope,namespace.projectId??'',key,key)) fail('evidence_unavailable');
  };
  function visit(node, inherited = fallback.length===1?fallback[0]:null) {
    if(!node||typeof node!=='object'||ArrayBuffer.isView(node)||seen.has(node))return;
    seen.add(node);
    const namespace=node.namespace??inherited;
    if(namespace&&['memory','card'].includes(node.type)&&node[node.type==='memory'?'memoryId':'cardId']) {
      // Metadata can intentionally retain an older canonical revision (for
      // example a confirmed Card's superseded contributor). Do not turn a
      // historical reference into a current-version lookup.
      fact(namespace,node.type,node.memoryId??node.cardId,node.revision);
    } else if(namespace&&['receipt','submitted-note','raw'].includes(node.type)&&
      (node.receiptId||node.sourceId||node.conversationId)) {
      if(factsOnly)fact(namespace,node.type,node.receiptId??node.sourceId??node.conversationId,node.revision,
        {messageId:node.messageId,start:node.span?.start,end:node.span?.end});
      else if(!cachedContentSuppressionRequestInside(db,namespace.ownerId)?.sourcesChecked?.has(JSON.stringify(node)) && !cachedContentSuppressionRequestInside(db,namespace.ownerId)?.sourcesChecked?.has(JSON.stringify(sourceRef(node,namespace,true))) && !sourceReadSafety(db,{identity,namespace,ref:node}).allowed)fail('evidence_unavailable');
    }
    if(namespace) {
      if(node.id && node.revision) {
        if(node.kind && node.origin) fact(namespace,'memory',node.id,node.revision);
        if(node.bodyRevision) fact(namespace,'card',node.id,node.revision);
        if(typeof node.excerpt==='string') fact(namespace,'receipt',node.id);
      }
      for(const [field,key]of Object.entries(node)) {
        if(/(?:^memoryId$|MemoryId$)/.test(field))fact(namespace,'memory',key,node.memoryRevision??node.revision);
        if(field==='receiptId')fact(namespace,'receipt',key);
        if(field==='conversationId')fact(namespace,'raw',key,undefined,{messageId:node.messageId,start:node.span?.start,end:node.span?.end});
        if(field==='receiptIds'&&Array.isArray(key))for(const id of key)fact(namespace,'receipt',id);
      }
      if(node.entity?.id&&['memory','card','submitted-note','raw','conversation'].includes(node.entity.type))fact(namespace,node.entity.type==='conversation'?'raw':node.entity.type,node.entity.id,node.entity.revision);
      if(node.childType==='memory'&&node.childId)fact(namespace,'memory',node.childId,node.childRevision);
      if(node.childType==='card'&&node.childId)fact(namespace,'card',node.childId,node.childRevision);
      if(node.source?.type==='conversation')fact(namespace,'raw',node.source.id);
      if(Array.isArray(node.conversations))for(const conversation of node.conversations)fact(namespace,'raw',conversation.id);
      if(node.cardId)fact(namespace,'card',node.cardId,node.revision??node.expectedRevision);
      if(node.memoryId&&node.targetId)fact(namespace,'memory',node.targetId,node.targetRevision);
      if(node.targetId&&typeof node.method==='string'&&/Card|SourceNote/.test(node.method))fact(namespace,/SourceNote/.test(node.method)?'submitted-note':'card',node.targetId);
    }
    for(const child of Object.values(node))visit(child,namespace);
  }
  visit(value);
}
