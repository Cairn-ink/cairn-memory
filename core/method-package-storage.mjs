import { randomUUID } from 'node:crypto';
import { createMethodBindingStorage } from './method-binding-storage.mjs';
import { createMethodAttachmentStorage } from './method-attachment-storage.mjs';
import { transaction, readTransaction } from './database.mjs';
import { fail, MemoryStoreError } from './validation.mjs';
import { keyed } from './private-card-input.mjs';
import { createCardReceiptSources } from './card-receipt-sources.mjs';
import { createCardRawSources } from './card-raw-sources.mjs';
import { createOperationLedger, createPrivateEffectWriter, createPrivateCursor,
  privateBoundary as boundary, privateWhere as where, envelopeBytes as size } from './private-operation-helpers.mjs';
import { methodPackageRef, methodVersionRef, methodFiles, methodChange, methodLabel, methodPageLimit,
  METHOD_LIMITS, sameNamespace, methodContext, includesNamespace, methodReasons } from './method-package-input.mjs';

const now = () => new Date().toISOString();
const completeCoverage = count => ({ status: 'complete', included: count, omitted: 0 });
/** One SQLite transaction per call; no host, model, filesystem or async work. */
export function createMethodPackageStorage({ db, identity, ready, cardDetailInside }) {
  const binding = (purpose, value) => keyed(identity.cursorSecret, purpose, [identity.storeId, value]);
  const ledger = createOperationLedger(db, 'method_operations');
  const effect = createPrivateEffectWriter(db, 'method_effects');
  const receipts = createCardReceiptSources(db, binding), raw = createCardRawSources(db, identity);
  const epoch = ns => Array.isArray(ns) ? binding('method-readset-generation-v1',ns.map(namespace=>epoch(namespace))) : binding('method-read-generation-v1', [
    ...['method_epochs','card_epochs'].map(table => db.prepare(`SELECT generation FROM ${table} WHERE ${where}`).get(...boundary(ns))?.generation ?? 1),
    db.prepare(`SELECT epoch FROM namespace_epochs WHERE ${where}`).get(...boundary(ns))?.epoch ?? 1,
    db.prepare(`SELECT generation FROM raw_exclusion_clocks WHERE ${where}`).get(...boundary(ns))?.generation ?? 1,
  ]);
  const cursors = createPrivateCursor({ binding, purpose: 'method-cursor-v1', epoch });
  function advance(ns) {
    db.prepare(`INSERT INTO method_epochs VALUES(?,?,?,2) ON CONFLICT(owner_id,scope,project_id)
      DO UPDATE SET generation=generation+1`).run(...boundary(ns));
  }
  const packageRow = (ns, id) => db.prepare(`SELECT * FROM method_packages WHERE ${where} AND id=?`).get(...boundary(ns), id);
  const versionRow = (packageId, id) => db.prepare('SELECT * FROM method_versions WHERE package_id=? AND id=?').get(packageId, id);
  const packageRef = (ns, id) => ({ type: 'method-package', namespace: ns, packageId: id });
  const versionRef = (ns, row) => ({ type: 'method-version', namespace: ns, packageId: row.package_id,
    versionId: row.id, manifestIdentity: row.manifest_identity });
  const fileColumns = 'version_id,position,path,byte_count,content_identity,media_type';
  const fileRows = id => db.prepare('SELECT '+fileColumns+' FROM method_files WHERE version_id=? ORDER BY position').all(id);
  const contentIdentity = (ns, text) => binding('method-file-content-v1', [ns, text]);
  const manifestIdentity = files => binding('method-manifest-v1', files.map(file => [file.path,file.contentIdentity,file.mediaType]));
  const manifest = rows => rows.map(row => ({ path: row.path, byteCount: row.byte_count,
    contentIdentity: row.content_identity, mediaType: row.media_type,...(row.kind?{kind:row.kind}:{}) }));
  const attachments=createMethodAttachmentStorage({db,identity,contentIdentity,enabled:db.prepare('PRAGMA user_version').get().user_version>=31});
  function targetLifecycle(ns,inputRef) {
    const ref = methodVersionRef(inputRef), pkg = packageRow(ns, ref.packageId);
    const row = pkg && versionRow(pkg.id, ref.versionId);
    if (!sameNamespace(ns, ref.namespace) || !row) fail('method_not_found');
    if (row.manifest_identity !== ref.manifestIdentity) fail('method_version_unavailable');
    return {pkg,row,available:pkg.state==='available'&&row.state==='available'};
  }
  function targetMetadata(ns, inputRef) {
    const found=targetLifecycle(ns,inputRef),{pkg,row}=found;
    if(!found.available)return found;
    const files = fileRows(row.id);
    if(attachments.mixed(row.id))return {...found,files:attachments.metadata(ns,row,files),mixed:true};
    const ref=methodVersionRef(inputRef);
    if (manifestIdentity(manifest(files)) !== ref.manifestIdentity) fail('method_version_unavailable');
    return { pkg, row, files, available: true };
  }
  function verifyFile(ns, file) {
    if (file.content_identity !== contentIdentity(ns,file.text) ||
        file.byte_count !== Buffer.byteLength(file.text,'utf8')) fail('method_version_unavailable');
    return file;
  }
  function target(ns, inputRef) {
    const found=targetMetadata(ns,inputRef);
    if (found.available) {
      const verified=db.prepare('SELECT '+fileColumns+',text FROM method_files WHERE version_id=? ORDER BY position').all(found.row.id).map(file=>verifyFile(ns,file));
      if(!found.mixed)found.files=verified;
    }
    return found;
  }
  function excludedReceipt(id) {
    return Boolean(db.prepare(`SELECT 1 FROM raw_receipt_lineage l JOIN raw_source_exclusions x
      ON x.conversation_id=l.conversation_id AND x.message_id=l.message_id AND x.start<l.end AND x.end>l.start
      WHERE l.receipt_id=?`).get(id));
  }
  function reasonAvailable(ns, ref) {
    try {
      if (!sameNamespace(ref.namespace, ns)) return false;
      if (ref.type === 'memory') {
        const row = db.prepare(`SELECT revision FROM memories WHERE ${where} AND id=? AND deleted=0
          AND currentness='current' AND review_state!='awaiting'`).get(...boundary(ns), ref.memoryId);
        return Boolean(row && row.revision === ref.revision && !db.prepare('SELECT id FROM receipts WHERE memory_id=?').all(ref.memoryId).some(r => excludedReceipt(r.id)));
      }
      if (ref.type === 'card') {
        const card = cardDetailInside(ns, ref.cardId);
        return Boolean(card && card.state === 'confirmed' && card.revision === ref.revision &&
          card.bodyRevision === ref.bodyRevision && card.support.status === 'eligible' &&
          card.bindings.every(item => item.source.type !== 'receipt' || !excludedReceipt(item.source.receiptId)));
      }
      if (ref.type === 'receipt') { receipts.resolve(ns, ref); return !excludedReceipt(ref.receiptId); }
      if (ref.type === 'raw') { raw.resolve(ns, ref); return true; }
      const row = db.prepare(`SELECT * FROM card_notes WHERE ${where} AND id=?`).get(...boundary(ns), ref.sourceId);
      return Boolean(row && row.state === 'available' && row.revision === ref.revision && ref.contentIdentity ===
        binding('submitted-note-content-v1', [ns,row.id,row.revision,row.text]));
    } catch (error) {
      if (error instanceof MemoryStoreError && ['source_unavailable','source_excluded','source_budget_exceeded',
        'raw_crypto_unavailable','revision_conflict'].includes(error.code)) return false;
      throw error;
    }
  }
  function metadata(ns, row) {
    return { ref: versionRef(ns,row), ordinal: row.ordinal,
      basedOn: row.based_on ? JSON.parse(row.based_on) : null, state: row.state, revision: row.revision,
      importedAt: row.imported_at, byteCount: row.byte_count,
      ...(row.state==='available'&&attachments.mixed(row.id)?{manifestFormat:'mixed-v1'}:{}),
      ...(row.state === 'available' ? { title: row.title, submittedBy: row.submitted_by } : {}),
      adoptionStatus: row.state === 'available' ? 'unassessed' : 'unavailable' };
  }
  function importVersion(ns, input, mixed) {
    let pkg, base = null;
    if (input.package !== undefined) {
      pkg = packageRow(ns, input.package.packageId);
      if (!pkg) fail('method_not_found');
      if (pkg.revision !== input.expectedPackageRevision) fail('revision_conflict');
      if (pkg.state !== 'available') fail('method_version_unavailable');
      // A mixed import consumes only the base's identity/lifecycle and paths;
      // it never reads or inherits its bytes. New input MACs were prepared
      // before the lock. Legacy imports retain their existing verification.
      const previous = mixed?targetLifecycle(ns,input.basedOn):target(ns, input.basedOn);
      if (!previous.available) fail('method_version_unavailable');
      base = methodVersionRef(input.basedOn);
    } else {
      if (db.prepare(`SELECT count(*) AS n FROM method_packages WHERE ${where}`).get(...boundary(ns)).n >= METHOD_LIMITS.packages) fail('package_limit_reached');
      const id = randomUUID(), timestamp = now();
      db.prepare("INSERT INTO method_packages VALUES(?,?,?,?,'available',1,1,?,?)").run(id,...boundary(ns),timestamp,timestamp);
      pkg = packageRow(ns,id);
    }
    if (pkg.next_ordinal > METHOD_LIMITS.versions) fail('package_limit_reached');
    const files = mixed?.entries??methodFiles(input.files), change = methodChange(input.change, ns);
    if (change) {
      const basePaths=base?(attachments.mixed(base.versionId)?db.prepare('SELECT path FROM method_mixed_entries WHERE version_id=?').all(base.versionId):fileRows(base.versionId)):[];
      const paths = new Set([...files.map(file => file.path), ...basePaths.map(file=>file.path)]);
      if (change.items.some(item => item.paths.some(path => !paths.has(path)))) fail('invalid_path');
      if (change.reasonRefs.some(ref => !reasonAvailable(ns, ref))) fail('method_not_found');
    }
    const prepared = mixed?.entries??files.map(file => ({ ...file, byteCount: Buffer.byteLength(file.text,'utf8'), contentIdentity: contentIdentity(ns,file.text) }));
    const textFiles=prepared.filter(file=>file.kind!=='binary');
    const bytes = textFiles.reduce((sum,file) => sum + file.byteCount, 0);
    db.prepare('INSERT OR IGNORE INTO method_owner_usage VALUES(?,0)').run(ns.ownerId);
    const reserved = db.prepare('UPDATE method_owner_usage SET byte_count=byte_count+? WHERE owner_id=? AND byte_count+?<=?')
      .run(bytes,ns.ownerId,bytes,METHOD_LIMITS.ownerBytes);
    if (reserved.changes !== 1) fail('quota_reached');
    if(mixed)attachments.reserve(ns,mixed);
    const id = mixed?.versionId??randomUUID(), ordinal = pkg.next_ordinal, timestamp = now();
    const manifestId = mixed?.manifestIdentity??manifestIdentity(prepared);
    db.prepare("INSERT INTO method_versions VALUES(?,?,?,?,?,'available',1,?,?,?,?)")
      .run(id,pkg.id,ordinal,base ? JSON.stringify(base) : null,manifestId,methodLabel(input.title,true),
        input.submittedBy === undefined ? null : methodLabel(input.submittedBy),timestamp,bytes);
    const insert = db.prepare('INSERT INTO method_files VALUES(?,?,?,?,?,?,?)');
    textFiles.forEach((file,index) => insert.run(id,file.position??index,file.path,file.text,file.byteCount,file.contentIdentity,file.mediaType));
    if(mixed)attachments.insert(ns,mixed);
    const ref = versionRef(ns,versionRow(pkg.id,id));
    if (change) db.prepare('INSERT INTO method_changes VALUES(?,?,?,?,?)').run(id,base ? JSON.stringify(base) : null,
      JSON.stringify(ref),JSON.stringify(change.items),JSON.stringify(change.reasonRefs));
    const packageRevision = input.package === undefined ? 1 : pkg.revision + 1;
    db.prepare('UPDATE method_packages SET revision=?,next_ordinal=next_ordinal+1,updated_at=? WHERE id=?')
      .run(packageRevision,timestamp,pkg.id);
    return { package: packageRef(ns,pkg.id), version: ref, ordinal, packageRevision };
  }
  function purge(ns, row) {
    db.prepare('DELETE FROM method_files WHERE version_id=?').run(row.id);
    db.prepare("DELETE FROM method_changes WHERE to_id=? OR json_extract(from_ref,'$.versionId')=?").run(row.id,row.id);
    db.prepare("UPDATE method_versions SET state='deleted',revision=revision+1,title=NULL,submitted_by=NULL,byte_count=0 WHERE id=?").run(row.id);
    db.prepare('UPDATE method_owner_usage SET byte_count=byte_count-? WHERE owner_id=?').run(row.byte_count,ns.ownerId);
  }
  function remove(method, ns, input) {
    if (method === 'deleteMethodVersion') {
      // Purge requires canonical identity/lifecycle/CAS, never readable text,
      // manifest rows, binary chunks or an enabled asset capability.
      const found = targetLifecycle(ns,input.ref), { pkg, row } = found;
      if (row.revision !== input.expectedRevision) fail('revision_conflict');
      if (!found.available) fail('method_version_unavailable');
      purge(ns,row);
      db.prepare('UPDATE method_packages SET revision=revision+1,updated_at=? WHERE id=?').run(now(),pkg.id);
      effect(ns,'method_version_deleted','method-version',row.id,row.revision+1,input.actionId);
      return { id: row.id, revision: row.revision+1, state: 'deleted', effectCount: 1 };
    }
    const ref = methodPackageRef(input.ref), pkg = packageRow(ns,ref.packageId);
    if (!pkg) fail('method_not_found');
    if (pkg.revision !== input.expectedRevision) fail('revision_conflict');
    if (pkg.state !== 'available') fail('method_version_unavailable');
    for (const row of db.prepare("SELECT * FROM method_versions WHERE package_id=? AND state='available'").all(pkg.id)) purge(ns,row);
    db.prepare("UPDATE method_packages SET state='deleted',revision=revision+1,updated_at=? WHERE id=?").run(now(),pkg.id);
    effect(ns,'method_package_deleted','method-package',pkg.id,pkg.revision+1,input.actionId);
    return { id: pkg.id, revision: pkg.revision+1, state: 'deleted', effectCount: 1 };
  }
  function page(ns, expected, input, entries, build) {
    const cursor = cursors.decode(input.cursor,expected,ns), start = cursor?.after ?? 0;
    if (!Number.isSafeInteger(start) || start < 0 || start > entries.length) fail('invalid_cursor');
    const count = methodPageLimit(input.limit);
    let end = Math.min(start+count,entries.length);
    while (true) {
      const complete = end === entries.length;
      const result = { ...build(entries.slice(start,end)), coverage: complete ? completeCoverage(end-start) :
        { status: 'budget_exhausted', included: end-start, omitted: null }, nextCursor: complete ? null :
        cursors.encode({ binding: expected, epoch: epoch(ns), after: end }) };
      if (size(result) <= 65536) return result;
      if (--end <= start) fail('context_item_too_large');
    }
  }
  const bindings=createMethodBindingStorage({db,binding,packageRow,packageRef,target,targetMetadata,reasonAvailable,effect,page});
  function read(method, ns, input, accessGeneration,access,binaryAccessGeneration) {
    const readSet=input.context!==undefined?methodContext(input.context).readSet:input.readSet;
    const cursorScope=readSet??ns;
    const streamInput=Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'cursor'));
    const expected = { store: identity.storeId, namespace: ns, method, accessGeneration,
      input: method==='readMethodAttachmentBytes'?attachments.streamBinding(streamInput,access):
        readSet || input.snapshot!==undefined ? binding('method-stream-v1',[streamInput,access]) : streamInput };
    if(method==='readMethodAttachmentBytes')return readAttachment(ns,input,access,{...expected,binaryAccessGeneration},cursorScope);
    // Validate cursor before mutable existence/availability checks on every stream.
    if (input.cursor !== undefined) cursors.decode(input.cursor,expected,cursorScope);
    if(method==='checkMethodReasonRefs')return {reasonRefs:methodReasons(input.reasonRefs,ns).map(ref=>({ref,status:reasonAvailable(ns,ref)?'available':'unavailable'}))};
    if(method==='resolveMethod')return bindings.resolve(input,access);
    if(method==='resolveMethodsForRole')return bindings.list(input,access,expected);
    if(method==='listMethodBindingEvents')return bindings.events(ns,input,expected);
    if (method === 'getMethodPackageUsage') return { version: 'method-package-usage-v1', namespace: ns,
      retainedFileBytes: db.prepare(`SELECT coalesce(sum(v.byte_count),0) AS n FROM method_versions v JOIN method_packages p ON p.id=v.package_id
        WHERE p.owner_id=? AND p.scope=? AND p.project_id=?`).get(...boundary(ns)).n,
      limitBytes: METHOD_LIMITS.ownerBytes, limitScope: 'owner', aggregate: 'not-requested' };
    if (method === 'listMethodEffects') {
      const entries = db.prepare(`SELECT * FROM method_effects WHERE ${where} ORDER BY ordinal`).all(...boundary(ns))
        .map(row => ({ effectId: row.effect_id, namespace: ns, kind: row.kind,
          entity: { type: row.entity_type, id: row.entity_id }, revision: row.revision, actionId: row.action_id, ordinal: row.ordinal }));
      return page(ns,expected,input,entries,effects => ({ effects }));
    }
    if (method === 'listMethodPackages') {
      const entries = db.prepare(`SELECT * FROM method_packages WHERE ${where} ORDER BY id`).all(...boundary(ns))
        .map(row => ({ ref: packageRef(ns,row.id), state: row.state, revision: row.revision,
          versionCount: row.next_ordinal-1, createdAt: row.created_at, updatedAt: row.updated_at }));
      return page(ns,expected,input,entries,packages => ({ packages }));
    }
    if (method === 'listMethodVersions') {
      const ref = methodPackageRef(input.package);
      if(readSet && !includesNamespace(readSet,ref.namespace))return {status:'unavailable',versions:[]};
      const pkg = packageRow(ref.namespace,ref.packageId);
      if (!pkg) fail('method_not_found');
      const entries = db.prepare('SELECT * FROM method_versions WHERE package_id=? ORDER BY ordinal').all(pkg.id).map(row => {
        const value=metadata(ref.namespace,row);
        if(input.context!==undefined && row.state==='available')value.adoptionStatus=bindings.adoption({row},{...input,version:value.ref,intent:'history'},access,null);
        return value;
      });
      return page(cursorScope,expected,input,entries,versions => ({ versions }));
    }
    if (method === 'compareMethodVersions') {
      const from = target(ns,input.from), to = target(ns,input.to);
      if (!from.available || !to.available) return { status: 'unavailable' };
      const left = new Map(manifest(from.files).map(file => [file.path,file])), right = new Map(manifest(to.files).map(file => [file.path,file]));
      const changes = [...new Set([...left.keys(),...right.keys()])].sort().map(path => ({ path,
        status: !left.has(path) ? 'added' : !right.has(path) ? 'removed' :
          left.get(path).contentIdentity === right.get(path).contentIdentity && (!(from.mixed||to.mixed)||
            (left.get(path).kind??'text')===(right.get(path).kind??'text')&&left.get(path).mediaType===right.get(path).mediaType) ? 'unchanged' : 'changed' }));
      const record = db.prepare('SELECT * FROM method_changes WHERE to_id=?').get(to.row.id);
      const matching = record?.from_ref === JSON.stringify(methodVersionRef(input.from)) && record?.to_ref === JSON.stringify(methodVersionRef(input.to));
      const items = matching ? JSON.parse(record.items) : [];
      const reasonRefs = matching ? JSON.parse(record.reason_refs).map(ref => ({ ref, status: reasonAvailable(ns,ref) ? 'available' : 'unavailable' })) : [];
      const reason = reasonRefs.length === 0 ? 'not-recorded' : reasonRefs.some(ref => ref.status === 'available') ? 'available' : 'recorded-unavailable';
      const entries = [...changes.map(value => ({ type: 'diff', value })), ...items.map(value => ({ type: 'item', value })),
        ...reasonRefs.map(value => ({ type: 'reason', value }))];
      return page(ns,expected,input,entries,selected => ({ from: methodVersionRef(input.from), to: methodVersionRef(input.to),
        status: 'available', reason, changes: selected.filter(e => e.type === 'diff').map(e => e.value),
        items: selected.filter(e => e.type === 'item').map(e => e.value), reasonRefs: selected.filter(e => e.type === 'reason').map(e => e.value) }));
    }
    const saved=bindings.decode(input.snapshot),ref=methodVersionRef(input.version);
    bindings.pinVersion(saved,ref);
    if(readSet && !includesNamespace(readSet,ref.namespace))return method==='getMethodVersion'?{version:null,status:'unavailable',adoptionStatus:'unavailable'}:{status:'unavailable',adoptionStatus:'unavailable'};
    const found = method==='readMethodFile'?targetMetadata(ref.namespace,input.version):target(ref.namespace,input.version);
    if (!found.available) return method === 'getMethodVersion' ? { version: null, status: 'unavailable', adoptionStatus: 'unavailable' } :
      { status: 'unavailable', adoptionStatus: 'unavailable' };
    const adoptionStatus=bindings.adoption(found,input,access,saved);
    if (method === 'getMethodVersion') return { version: {...metadata(ref.namespace,found.row),adoptionStatus} };
    if (method === 'listMethodManifest') return page(cursorScope,expected,input,manifest(found.files),files => ({ files, adoptionStatus }));
    const selected = found.files.find(row => row.path === input.path);
    if (!selected) fail('method_not_found');
    if(selected.kind==='binary')fail('unsupported_media');
    const file=verifyFile(ref.namespace,{...selected,...db.prepare('SELECT text FROM method_files WHERE version_id=? AND path=?').get(found.row.id,input.path)});
    const cursor = cursors.decode(input.cursor,expected,cursorScope), start = cursor?.after ?? 0;
    if (!Number.isSafeInteger(start) || start < 0 || start > file.text.length ||
        start > 0 && /[\uDC00-\uDFFF]/.test(file.text[start])) fail('invalid_cursor');
    let end = Math.min(start+4000,file.text.length);
    if (end < file.text.length && /[\uDC00-\uDFFF]/.test(file.text[end])) end--;
    const complete = end === file.text.length;
    const parts = end === start ? [] : [{ start,end,text: file.text.slice(start,end) }];
    return { parts, coverage: complete ? completeCoverage(parts.length) : { status: 'budget_exhausted',included: parts.length,omitted: null },
      nextCursor: complete ? null : cursors.encode({ binding: expected,epoch: epoch(cursorScope),after: end }), adoptionStatus };
  }
  function readAttachment(ns,input,access,expected,cursorScope) {
    const cursor=attachments.decode(input.cursor,expected),saved=bindings.decode(input.snapshot),ref=methodVersionRef(input.version);
    bindings.pinVersion(saved,ref);
    const readSet=input.context===undefined?null:methodContext(input.context).readSet;
    if(readSet&&!includesNamespace(readSet,ref.namespace))return {status:'unavailable',adoptionStatus:'unavailable'};
    const found=targetMetadata(ref.namespace,ref);
    if(!found.available)return {status:'unavailable',adoptionStatus:'unavailable'};
    if(cursor&&(cursor.packageRevision!==found.pkg.revision||cursor.versionRevision!==found.row.revision||
      input.intent==='current'&&cursor.epoch!==epoch(cursorScope)))fail('cursor_stale');
    const adoptionStatus=bindings.adoption(found,input,access,saved),selected=found.files.find(file=>file.path===input.path);
    if(!selected)fail('method_not_found');
    if(selected.kind!=='binary')fail('unsupported_media');
    const page=attachments.chunk(ref.namespace,found,selected,cursor?.after??0);
    return {version:ref,path:input.path,status:'available',adoptionStatus,...page,nextCursor:page.complete?null:
      attachments.encode({binding:expected,epoch:input.intent==='current'?epoch(cursorScope):null,after:page.index+1,
        packageRevision:found.pkg.revision,versionRevision:found.row.revision})};
  }
  return Object.freeze({
    payloadBinding: value => binding('method-action-v1',value),
    prepareMixed:(ns,input)=>attachments.prepare(ns,input),
    call(method,ns,input,payloadBinding,isRead,{ accessGeneration,access,binaryAccessGeneration },prepared) {
      ready();
      if (isRead) return readTransaction(db, () => read(method,ns,input,accessGeneration,access,binaryAccessGeneration));
      return transaction(db, () => {
        const replay = ledger.replay(ns,input.actionId,method,payloadBinding);
        if (replay !== undefined) return replay;
        const result = method === 'importMethodVersion' ? importVersion(ns,input,prepared) : ['adoptMethodVersion','disableMethodBinding'].includes(method) ? bindings.transition(method,ns,input) : remove(method,ns,input);
        if (size(result) > 65536) fail('context_item_too_large');
        ledger.record(ns,input.actionId,method,payloadBinding,result.binding?.package.packageId ?? result.version?.versionId ?? result.id,result,now());
        advance(ns);
        return result;
      });
    },
  });
}
