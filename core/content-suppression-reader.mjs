import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { types } from 'node:util';
import { isAbsolute } from 'node:path';
import { boundedData, requestRecord, deadline, mono } from './context-product-control.mjs';
import { requestAuthority } from './context-product-authority.mjs';
import { suppressionServiceIssuance } from './context-product-service.mjs';
import { canonicalJson, digest } from './context-product-validation.mjs';
import { installedContentLayout } from './content-safety-schema.mjs';
import { suppressionEpoch } from './content-suppression-storage.mjs';
import { createSuppressionEvidence } from './content-suppression-evidence.mjs';
import { SUPPRESSION_VERSION, SUPPRESSION_REASONS, SUPPRESSION_LIMITS as L, exact, bootstrap,
  pullOptions, sourceIdentities, identityKey, denialKeyFromFact, denialKeyMatches } from './content-suppression-input.mjs';
import { ownData } from './local-authority-input.mjs';
import { fail, identifier } from './validation.mjs';

const codes = new Set(['invalid_input','authority_required','scope_changed','invalid_cursor','cursor_stale',
  'invalid_snapshot','evidence_unavailable','context_item_too_large','read_timeout','read_in_progress',
  'store_closed','unsupported_database','unsafe_database_file','storage_busy','storage_error']);
const failure = error => {
  let code = error?.code;
  if ([5,6].includes(Number(error?.errcode) & 255)) code = 'storage_busy';
  if (['source_unavailable','source_excluded','raw_crypto_unavailable','revision_conflict','raw_lineage_unavailable'].includes(code)) code = 'evidence_unavailable';
  if (code === 'source_budget_exceeded') code = 'context_item_too_large';
  if (['invalid_identifier','invalid_read_set'].includes(code)) code = 'invalid_input';
  return { ok:false,error:{ code:codes.has(code) ? code : 'storage_error',retryable:code === 'storage_busy' } };
};
const limbs = epoch => [Number(epoch >> 32n),Number(epoch & 0xffffffffn)];
const typed = row => [row.scope,row.project_id,row.kind,row.stable_key,row.incarnation,row.match_mode,
  row.source_version,row.message_key,row.span_start,row.span_end,row.reason];

/** D-15: a separate reconciliation handle. No product reader lifecycle,
 * sidecar, content facade, or ordinary content-access authority is extended. */
export async function openContentSuppressionReader(value) {
  const o = ownData(value,['version','path','expected','serviceBinding','suppression','host','requestMaxMs']);
  if (o.version !== SUPPRESSION_VERSION) fail('invalid_input');
  if (typeof o.path !== 'string' || !o.path.isWellFormed() || !isAbsolute(o.path) || o.path.includes('\0')) fail('invalid_path');
  const expected = bootstrap(o.expected), binding = suppressionServiceIssuance(o.serviceBinding,o.suppression);
  if (canonicalJson(binding.suppression.expected) !== canonicalJson(expected)) fail('scope_changed');
  const host = exact(o.host,['authorize','isCurrent']);
  if (Object.values(host).some(fn => typeof fn !== 'function' || types.isAsyncFunction(fn))) fail('authority_required');
  const requestMaxMs = deadline(o.requestMaxMs), handleId = randomUUID();
  const [{ openReadDatabase },{ readTransaction }] = await Promise.all([import('./read-database.mjs'),import('./database.mjs')]);
  const opened = openReadDatabase(o.path,{ contextRead:true }), db = opened.db;
  let identity;
  try {
    db.exec('PRAGMA busy_timeout=0');
    readTransaction(db,() => {
      const layout = installedContentLayout(db);
      if (!layout.suppressionRevision) fail('unsupported_database');
      const row = db.prepare('SELECT store_id,cursor_secret FROM store_metadata WHERE singleton=1').get();
      const domain = db.prepare('SELECT suppression_domain FROM content_safety_control WHERE singleton=1').get();
      if (row?.store_id !== expected.storeId || domain?.suppression_domain !== expected.suppressionDomain) fail('scope_changed');
      identity = { storeId:row.store_id,cursorSecret:row.cursor_secret };
    });
  } catch (error) { db.close(); throw error; }
  const access = digest({ profile:SUPPRESSION_VERSION,binding }), cache = new Map();
  let closed = false, busy = false, invalidated = false, retained = 0, highest = 0n, utc = Date.now();
  const now = () => utc = Math.max(utc,Date.now());
  const clear = () => { cache.clear(); retained = 0; };
  const mac = (purpose, data) => createHmac('sha256',Buffer.from(identity.cursorSecret,'hex'))
    .update(SUPPRESSION_VERSION + '/' + purpose + '\n' + canonicalJson(data)).digest('base64url');
  const encode = body => {
    const cursor = Buffer.from(canonicalJson(body)).toString('base64url') + '.' + mac('cursor',body);
    if (Buffer.byteLength(cursor) > L.cursor) fail('context_item_too_large');
    return cursor;
  };
  function decode(text) {
    try {
      if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(text)) fail('invalid_cursor');
      const [raw,signature] = text.split('.'), body = JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
      if (Buffer.from(canonicalJson(body)).toString('base64url') !== raw ||
          !timingSafeEqual(Buffer.from(signature),Buffer.from(mac('cursor',body)))) fail('invalid_cursor');
      if (!Number.isSafeInteger(body.issued) || !Number.isSafeInteger(body.expires) || body.expires !== body.issued + L.lifetime ||
          body.issued > now() || body.expires <= now()) fail('cursor_stale');
      return body;
    } catch (error) { if (error.code === 'cursor_stale') throw error; fail('invalid_cursor'); }
  }
  const keyMac = row => mac('typed-key',typed(row));
  function remove(id) { const entry = cache.get(id); if (entry) { retained -= entry.charge; cache.delete(id); } }
  function prune() { for (const [id,entry] of cache) if (entry.expires <= now()) remove(id); }
  function retain(entry) {
    prune(); entry.charge = 0;
    for (let i = 0; i < 3; i++) entry.charge = Buffer.byteLength(canonicalJson(entry));
    if (entry.charge > L.cacheBytes) fail('context_item_too_large');
    while (cache.size >= L.batches || retained + entry.charge > L.cacheBytes) remove(cache.keys().next().value);
    cache.set(entry.id,entry); retained += entry.charge;
  }
  function checkpointSnapshot(owner, options, check) {
    opened.assertFile(); check(); check.charge(8);
    const layout = installedContentLayout(db);
    if (!layout.suppressionRevision) fail('unsupported_database');
    const row = db.prepare('SELECT store_id,cursor_secret FROM store_metadata WHERE singleton=1').get();
    const control = db.prepare('SELECT suppression_domain FROM content_safety_control WHERE singleton=1').get();
    if (row?.store_id !== expected.storeId || row.cursor_secret !== identity.cursorSecret || control?.suppression_domain !== expected.suppressionDomain) fail('scope_changed');
    // Authorization and all four checkpoint bindings precede this epoch query.
    const counter = db.prepare('SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs WHERE owner_id=?').get(owner);
    const epoch = counter ? suppressionEpoch(counter) : 0n;
    if (epoch < highest) {
      // Observed regression is uncertain origin, not a new zero checkpoint.
      // Do not resurrect cached snapshots if a later counter catches up.
      invalidated = true; clear(); fail('invalid_snapshot');
    }
    if (mono(options.expected.epoch) > epoch) fail('invalid_snapshot');
    const last = db.prepare('SELECT epoch_hi,epoch_lo FROM content_suppressions INDEXED BY content_suppression_window WHERE owner_id=? ORDER BY epoch_hi DESC,epoch_lo DESC LIMIT 1').get(owner);
    if ((last ? suppressionEpoch(last) : 0n) !== epoch) fail('unsupported_database');
    const checkpoint = mono(options.expected.epoch);
    if (checkpoint > 0n && !db.prepare('SELECT 1 FROM content_suppressions INDEXED BY content_suppression_window WHERE owner_id=? AND epoch_hi=? AND epoch_lo=?')
      .get(owner,...limbs(checkpoint))) fail('unsupported_database');
    check();
    const erasures = db.prepare(`SELECT reason FROM content_suppressions INDEXED BY content_suppression_target
      WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,'owner','','owner','','')
      AND match_mode='owner' LIMIT 4097`).all(owner);
    // Reason is not indexed. Visit a bounded target range and charge every row,
    // including purge facts rejected by the erasure-reason test.
    check.charge(erasures.length);
    if(erasures.length>4096)fail('source_budget_exceeded');
    if(erasures.some(fact=>['privacy_erase','account_erasure'].includes(fact.reason))&&
      !binding.suppression.permissions.erasureReconciliation)fail('authority_required');
    highest = epoch; check();
    return { epoch,layout };
  }
  // Batches reconcile at most 2048 new epochs from the authenticated checkpoint.
  // Two proofs leave room in the 8192-row account for identity matching.
  // Catch up via bounded list pages first; cached pages repeat this same proof.
  function contiguous(owner, start, through, check) {
    if(through-start>2048n)fail('source_budget_exceeded');
    if(start===through)return;
    const rows=db.prepare(`SELECT epoch_hi,epoch_lo FROM content_suppressions INDEXED BY content_suppression_window
      WHERE owner_id=? AND (epoch_hi,epoch_lo)>(?,?) AND (epoch_hi,epoch_lo)<=(?,?) ORDER BY epoch_hi,epoch_lo LIMIT 2049`)
      .all(owner,...limbs(start),...limbs(through));
    let epoch=start;
    for(const row of rows){check.charge();if(suppressionEpoch(row)!==++epoch)fail('unsupported_database');}
    if(epoch!==through)fail('unsupported_database');
  }
  function common(method, owner, input, options, credential, execute) {
    if (closed) return Promise.resolve(failure({ code:'store_closed' }));
    if (busy) return Promise.resolve(failure({ code:'read_in_progress' }));
    busy = true;
    try {
      identifier(owner);
      if (owner !== binding.ownerId) fail('authority_required');
      if (credential === undefined || credential === null) fail('authority_required');
      boundedData({ method,input,credential },L.bytes);
      const control = requestRecord({ requestId:randomUUID(),handleId,credentialBindingId:binding.credentialBindingId,
        credentialExpiresUtcMs:binding.credentialExpiresUtcMs,requestMaxMs },process.hrtime.bigint(),now());
      let rowsRemaining = L.rows;
      const check = () => {
        if (closed) fail('store_closed');
        if (process.hrtime.bigint() >= mono(control.requestCutoffMonoNs)) fail('read_timeout');
        if (binding.credentialExpiresUtcMs !== null && now() >= binding.credentialExpiresUtcMs) fail('authority_required');
      };
      check.charge = (n = 1) => { check(); if ((rowsRemaining -= n) < 0) fail('source_budget_exceeded'); };
      const authority = requestAuthority(host,binding,control)(method,input,credential);
      check();
      const value = execute(check);
      check(); authority.check(); check();
      // A synchronous host callback may itself commit erasure or replace
      // metadata. Recheck the delivery gate without recomputing a fixed window.
      readTransaction(db,() => { const snapshot=checkpointSnapshot(owner,options,check); if(method==='isSuppressed'){const observed=mono(value.observedEpoch);if(observed>snapshot.epoch)fail('cursor_stale');contiguous(owner,mono(options.expected.epoch),observed,check);} });
      check();
      if (Buffer.byteLength(JSON.stringify({ ok:true,value })) > L.bytes) fail('context_item_too_large');
      return Promise.resolve({ ok:true,value });
    } catch (error) {
      if (['authority_required','scope_changed','store_closed'].includes(error.code)) clear();
      return Promise.resolve(failure(error));
    } finally { busy = false; }
  }
  function invoke(method, owner, supplied, options, credential) {
    if (closed) return Promise.resolve(failure({ code:'store_closed' }));
    if (invalidated) return Promise.resolve(failure({ code:'invalid_snapshot' }));
    try {
      // Closed, frozen input is also the exact trusted authority request input.
      const opts = pullOptions(boundedData(options,L.bytes),owner,expected);
      let input;
      if (method === 'listSuppressionsSince') {
        mono(supplied);
        if (supplied !== opts.expected.epoch) fail('invalid_snapshot');
        if (binding.suppression.scope.kind !== 'owner') fail('authority_required');
        input = boundedData({ owner,epoch:supplied,options:opts },L.bytes);
      } else input = boundedData({ owner,sourceIdentities:sourceIdentities(supplied,owner,expected,binding.suppression),options:opts },L.bytes);
      return common(method,owner,input,opts,credential,check => method === 'listSuppressionsSince'
        ? list(owner,supplied,opts,check) : batch(owner,input.sourceIdentities,opts,check));
    } catch (error) {
      if (['authority_required','scope_changed'].includes(error.code)) clear();
      return Promise.resolve(failure(error));
    }
  }
  function list(owner, epochText, options, check) {
    const base = { operation:'list',owner,...expected,access,checkpoint:options.expected,epoch:epochText,limit:options.limit };
    let cursor = options.cursor && decode(options.cursor);
    if (cursor) {
      try {
        exact(cursor,[...Object.keys(base),'through','last','key','issued','expires']);
        mono(cursor.through); mono(cursor.last);
        if (Object.keys(base).some(k => canonicalJson(cursor[k]) !== canonicalJson(base[k]))) fail('invalid_cursor');
      } catch { fail('invalid_cursor'); }
    }
    return readTransaction(db,() => {
      const snapshot = checkpointSnapshot(owner,options,check), through = cursor ? mono(cursor.through) : snapshot.epoch;
      const after = cursor ? mono(cursor.last) : mono(epochText);
      if (through > snapshot.epoch || after < mono(epochText) || after >= through && cursor) fail('cursor_stale');
      if (cursor) {
        check.charge();
        const previous = db.prepare('SELECT * FROM content_suppressions INDEXED BY content_suppression_window WHERE owner_id=? AND epoch_hi=? AND epoch_lo=?').get(owner,...limbs(after));
        if (!previous || keyMac(previous) !== cursor.key) fail('cursor_stale');
      }
      const rows = db.prepare(`SELECT * FROM content_suppressions INDEXED BY content_suppression_window
        WHERE owner_id=? AND (epoch_hi,epoch_lo)>(?,?) AND (epoch_hi,epoch_lo)<=(?,?)
        ORDER BY epoch_hi,epoch_lo,scope,project_id,kind,stable_key,incarnation LIMIT ?`)
        .all(owner,...limbs(after),...limbs(through),options.limit + 1);
      if (!rows.length && mono(epochText) !== through) fail('unsupported_database');
      check();
      const charge = () => check.charge();
      let next = after;
      for (const row of rows) { charge(); if (suppressionEpoch(row) !== ++next) fail('unsupported_database'); }
      const issued = cursor?.issued ?? now(), expires = cursor?.expires ?? issued + L.lifetime;
      const items = [];
      for (const row of rows.slice(0,options.limit)) {
        check();
        if (!SUPPRESSION_REASONS.includes(row.reason)) fail('unsupported_database');
        const candidate = [...items,{ key:denialKeyFromFact(row),reason:row.reason,epoch:String(suppressionEpoch(row)) }];
        const nextCursor = suppressionEpoch(row) < through ? encode({ ...base,through:String(through),last:String(suppressionEpoch(row)),key:keyMac(row),issued,expires }) : null;
        if (Buffer.byteLength(JSON.stringify({ ok:true,value:{ items:candidate,throughEpoch:String(through),nextCursor } })) > L.bytes) break;
        items.push(candidate.at(-1));
      }
      if (rows.length && !items.length) fail('context_item_too_large');
      const last = items.at(-1), terminal = !last ? through === mono(epochText) : mono(last.epoch) === through;
      return { items,throughEpoch:String(through),nextCursor:terminal ? null : encode({ ...base,through:String(through),last:last.epoch,
        key:keyMac(rows[items.length-1]),issued,expires }) };
    });
  }
  function batch(owner, inputs, options, check) {
    prune();
    const inputDigest = digest(inputs), base = { operation:'batch',owner,...expected,access,checkpoint:options.expected,
      limit:options.limit,inputDigest,handle:handleId };
    let entry, after = -1;
    if (options.cursor) {
      const cursor = decode(options.cursor);
      try {
        exact(cursor,[...Object.keys(base),'id','observed','last','issued','expires']);
        mono(cursor.observed);
        if (Object.keys(base).some(k => canonicalJson(cursor[k]) !== canonicalJson(base[k]))) fail('invalid_cursor');
      } catch { fail('invalid_cursor'); }
      entry = cache.get(cursor.id); after = cursor.last;
      if (!entry || entry.expires !== cursor.expires || entry.issued !== cursor.issued || entry.observed !== cursor.observed ||
          entry.inputDigest !== inputDigest || !Number.isSafeInteger(after) || after < 0 || after >= inputs.length-1) fail('cursor_stale');
      readTransaction(db,() => { const snapshot=checkpointSnapshot(owner,options,check); if (snapshot.epoch < mono(entry.observed)) fail('cursor_stale'); contiguous(owner,mono(options.expected.epoch),mono(entry.observed),check); });
      cache.delete(entry.id); cache.set(entry.id,entry);
    } else {
      entry = readTransaction(db,() => {
        const snapshot = checkpointSnapshot(owner,options,check);
        contiguous(owner,mono(options.expected.epoch),snapshot.epoch,check);
        let remaining = L.rows;
        const charge = (n = 1) => { check.charge(n); if ((remaining -= n) < 0) fail('source_budget_exceeded'); };
        const evidence = createSuppressionEvidence(db,snapshot.layout,identity,charge), matches = new Map();
        function facts(c) {
          const id = identityKey(c);
          if (matches.has(id)) return matches.get(id);
          const rows = db.prepare(`SELECT * FROM content_suppressions INDEXED BY content_suppression_target
            WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,'owner','','owner','','')
            UNION ALL SELECT * FROM content_suppressions INDEXED BY content_suppression_target
            WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,'namespace','','')
            UNION ALL SELECT * FROM content_suppressions INDEXED BY content_suppression_target
            WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,?,?,?)
            LIMIT ?`).all(owner,owner,c.namespace.scope,c.namespace.projectId ?? '',
              owner,c.namespace.scope,c.namespace.projectId ?? '',c.kind,c.key,c.incarnation,remaining + 1);
          charge(rows.length + 1);
          if (rows.some(row => !SUPPRESSION_REASONS.includes(row.reason))) fail('unsupported_database');
          const keys = rows.map(row => ({ row,key:denialKeyFromFact(row) })); matches.set(id,keys); return keys;
        }
        function evaluate(c) {
          const closure = new Map();
          const visit = node => { charge(); const key = identityKey(node); if (closure.has(key)) return; closure.set(key,node); node.ancestors.forEach(visit); };
          visit(c);
          const found = [], unresolved = [];
          // Known facts can deny a removed source before canonical closure
          // validation. Unknown evidence can never manufacture a negative.
          for (const node of closure.values()) for (const item of facts(node)) {
            if (item.key.matchMode === 'version' && !['memory','submitted-note'].includes(node.kind)) { unresolved.push({ node,item }); continue; }
            if (denialKeyMatches(item.key,node,undefined,owner)) found.push(item.row);
          }
          for (const { node,item } of unresolved)
            if (denialKeyMatches(item.key,node,evidence.verify(node),owner)) found.push(item.row);
          if (!found.length) evidence.verify(c);
          const reasons = SUPPRESSION_REASONS.filter(reason => found.some(row => row.reason === reason));
          const matched = found.reduce((highest,row) => suppressionEpoch(row) > highest ? suppressionEpoch(row) : highest,0n);
          return { suppressed:found.length > 0,reasons,matchedEpoch:found.length ? String(matched) : null };
        }
        const results = inputs.map((c,inputIndex) => ({ inputIndex,...evaluate(c) }));
        if (Buffer.byteLength(canonicalJson(results)) > L.bytes) fail('context_item_too_large');
        return { ...base,id:randomUUID(),observed:String(snapshot.epoch),issued:now(),results:boundedData(results,L.bytes) };
      });
      entry.expires = entry.issued + L.lifetime; retain(entry);
    }
    const results = [];
    for (const result of entry.results.slice(after+1,after+1+options.limit)) {
      check(); const last = result.inputIndex, nextCursor = last === inputs.length-1 ? null : encode({ ...base,id:entry.id,
        observed:entry.observed,last,issued:entry.issued,expires:entry.expires });
      const publicResult = { ...result,reasons:[...result.reasons] }, candidate = [...results,publicResult];
      if (Buffer.byteLength(JSON.stringify({ ok:true,value:{ results:candidate,observedEpoch:entry.observed,nextCursor } })) > L.bytes) break;
      results.push(publicResult);
    }
    if (!results.length) fail('context_item_too_large');
    const last = results.at(-1).inputIndex;
    return { results,observedEpoch:entry.observed,nextCursor:last === inputs.length-1 ? null : encode({ ...base,id:entry.id,
      observed:entry.observed,last,issued:entry.issued,expires:entry.expires }) };
  }
  return Object.freeze({
    listSuppressionsSince:(owner,epoch,options,credential) => invoke('listSuppressionsSince',owner,epoch,options,credential),
    isSuppressed:(owner,inputs,options,credential) => invoke('isSuppressed',owner,inputs,options,credential),
    close() { if (!closed) { closed = true; clear(); db.close(); } return Promise.resolve(); },
  });
}
