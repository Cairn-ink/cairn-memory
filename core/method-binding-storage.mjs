import { randomUUID } from 'node:crypto';
import { fail } from './validation.mjs';
import { privateBoundary as boundary, privateWhere as where } from './private-operation-helpers.mjs';
import { methodContext, methodRole, methodPackageRef, methodVersionRef,
  methodReasons, includesNamespace, sameNamespace, METHOD_LIMITS } from './method-package-input.mjs';

// No schema installation: all storage was frozen and allocated by U2a.
export function createMethodBindingStorage({db,binding,packageRow,packageRef,target,targetMetadata,reasonAvailable,effect,page}) {
  const rowNamespace=row=>({ownerId:row.owner_id,scope:row.scope,projectId:row.project_id||null});
  const bindingRow=(ns,id,role)=>db.prepare(`SELECT * FROM method_bindings WHERE ${where} AND package_id=? AND role_key=?`).get(...boundary(ns),id,role);
  const bindingRef=(ns,pkg,row)=>({type:'method-binding',bindingNamespace:ns,package:pkg,roleKey:row.role_key,revision:row.revision});
  // Reconstruct the identity component of a logical binding reference. This
  // reads no target content or lifecycle; those require the target read grant.
  function identity(id) {
    const row=db.prepare('SELECT id,owner_id,scope,project_id FROM method_packages WHERE id=?').get(id);
    if(!row)fail('method_not_found');return packageRef(rowNamespace(row),row.id);
  }
  function transition(method,ns,input) {
    const pkg=methodPackageRef(input.package),canonical=packageRow(pkg.namespace,pkg.packageId);
    if(!canonical)fail('method_not_found');
    const role=methodRole(input.roleId),old=bindingRow(ns,pkg.packageId,role);
    if((old?.revision??null)!==input.expectedRevision)fail('revision_conflict');
    if(!old && db.prepare(`SELECT count(*) n FROM method_bindings WHERE ${where}`).get(...boundary(ns)).n>=METHOD_LIMITS.bindings)fail('package_limit_reached');
    let version=null;
    if(method==='adoptMethodVersion') {
      const found=target(pkg.namespace,input.version);
      if(!found.available)fail('method_version_unavailable');version=methodVersionRef(input.version);
    }
    const reasons=methodReasons(input.reasonRefs,ns);
    if(reasons.some(ref=>!reasonAvailable(ns,ref)))fail('method_not_found');
    const generation=(db.prepare(`SELECT generation FROM method_binding_generations WHERE ${where} AND package_id=?`).get(...boundary(ns),pkg.packageId)?.generation??0)+1;
    db.prepare(`INSERT INTO method_binding_generations VALUES(?,?,?,?,?) ON CONFLICT(owner_id,scope,project_id,package_id) DO UPDATE SET generation=excluded.generation`).run(...boundary(ns),pkg.packageId,generation);
    const revision=(old?.revision??0)+1,state=version?'active':'disabled',timestamp=new Date().toISOString();
    db.prepare(`INSERT INTO method_bindings VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(owner_id,scope,project_id,package_id,role_key) DO UPDATE SET state=excluded.state,
      version_id=excluded.version_id,manifest_identity=excluded.manifest_identity,revision=excluded.revision,
      generation=excluded.generation,updated_at=excluded.updated_at`).run(...boundary(ns),pkg.packageId,role,state,
        version?.versionId??null,version?.manifestIdentity??null,revision,generation,old?.created_at??timestamp,timestamp);
    const ordinal=db.prepare('SELECT coalesce(max(ordinal),0)+1 n FROM method_binding_events').get().n;
    const eventId=randomUUID();
    db.prepare('INSERT INTO method_binding_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(eventId,...boundary(ns),pkg.packageId,role,
      'binding_changed',revision,generation,state,version?.versionId??null,version?.manifestIdentity??null,input.actionId,timestamp,JSON.stringify(reasons),ordinal);
    effect(ns,'binding_changed','method-binding',pkg.packageId,revision,input.actionId);
    return {binding:bindingRef(ns,pkg,{role_key:role,revision}),state,version};
  }
  function levels(context) {
    const roles=methodRole(context.roleId)==='*'?['*']:[methodRole(context.roleId),'*'];
    return [...context.readSet].reverse().flatMap(namespace=>roles.map(roleKey=>({namespace,roleKey})));
  }
  function stateFor(pkg,context,access) {
    const consulted=[];let row,winner;
    for(const level of levels(context)) {
      row=bindingRow(level.namespace,pkg.packageId,level.roleKey);
      if(row) {
        const canonical=identity(pkg.packageId);
        if(JSON.stringify(canonical)!==JSON.stringify(pkg))fail('method_not_found');
      }
      consulted.push({...level,revision:row?.revision??null,state:row?.state??null,
        version:row?.version_id?{type:'method-version',namespace:pkg.namespace,packageId:pkg.packageId,versionId:row.version_id,manifestIdentity:row.manifest_identity}:null});
      if(row){winner=level;break;}
    }
    const readable=includesNamespace(context.readSet,pkg.namespace);
    const canonical=readable?packageRow(pkg.namespace,pkg.packageId):null;
    if(readable && !canonical)fail('method_not_found');
    let status='no-active-version',version=null,lifecycle={packageRevision:canonical?.revision??null,packageState:canonical?.state??null,versionRevision:null,versionState:null};
    if(winner) {
      status=row.state==='disabled'?'disabled':'unavailable';
      if(row.state==='active' && readable) {
        const candidate=consulted.at(-1).version,found=targetMetadata(pkg.namespace,candidate);
        lifecycle={...lifecycle,versionRevision:found.row.revision,versionState:found.row.state};
        if(found.available){status='current';version=candidate;}
      }
    }
    const value={package:pkg,status,binding:winner?bindingRef(winner.namespace,pkg,row):null,version};
    const clocks=context.readSet.map(namespace=>({namespace,
      generation:db.prepare(`SELECT generation FROM method_binding_generations WHERE ${where} AND package_id=?`).get(...boundary(namespace),pkg.packageId)?.generation??0,
      event:db.prepare(`SELECT coalesce(max(ordinal),0) n FROM method_binding_events WHERE ${where}`).get(...boundary(namespace)).n}));
    return {value,state:{package:pkg,consulted,lifecycle,clocks,version},context,access};
  }
  const accessFor=(context,access)=>context.readSet.map(namespace=>access.find(grant=>sameNamespace(grant.namespace,namespace)));
  function pin(context,access,states) {
    const value={format:'method-pin-v1',context,access:accessFor(context,access),states};
    const body=Buffer.from(JSON.stringify(value)).toString('base64url');
    return body+'.'+binding('method-pin-v1',body);
  }
  function decode(snapshot) {
    if(snapshot===undefined)return null;
    const [body,signature,extra]=snapshot.split('.');
    if(!body || extra!==undefined || signature!==binding('method-pin-v1',body))fail('invalid_input');
    try {
      const value=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
      if(value.format!=='method-pin-v1' || !Array.isArray(value.states))fail('invalid_input');
      return value;
    } catch {fail('invalid_input');}
  }
  function pinVersion(saved,ref) {
    if(saved && !saved.states.some(state=>JSON.stringify(state.version)===JSON.stringify(ref)))fail('invalid_input');
  }
  function adoption(found,input,access,saved) {
    const ref=methodVersionRef(input.version);
    pinVersion(saved,ref);
    if(input.context===undefined)return 'unassessed';
    const context=methodContext(input.context),resolved=stateFor(methodPackageRef({type:'method-package',namespace:ref.namespace,packageId:ref.packageId}),context,access);
    if(input.intent==='current' && saved && (JSON.stringify(saved.context)!==JSON.stringify(context) ||
        JSON.stringify(saved.access)!==JSON.stringify(accessFor(context,access)) ||
        !saved.states.some(state=>JSON.stringify(state)===JSON.stringify(resolved.state))))fail('cursor_stale');
    if(input.intent==='current' && (resolved.value.status!=='current' || JSON.stringify(resolved.value.version)!==JSON.stringify(ref)))fail('method_version_unavailable');
    if(resolved.value.status==='current' && JSON.stringify(resolved.value.version)===JSON.stringify(ref))return 'current';
    const adopted=levels(context).some(({namespace,roleKey})=>db.prepare(`SELECT 1 FROM method_binding_events WHERE ${where} AND package_id=? AND role_key=? AND version_id=? AND manifest_identity=? LIMIT 1`).get(...boundary(namespace),ref.packageId,roleKey,ref.versionId,ref.manifestIdentity));
    if(!adopted)return 'never-adopted';
    if(resolved.value.status==='disabled')return 'withdrawn';
    if(resolved.value.status==='current')return 'newer-version-available';
    return 'historical';
  }
  function resolve(input,access) {
    const context=methodContext({readSet:input.readSet,roleId:input.roleId}),pkg=methodPackageRef(input.package);
    const selected=stateFor(pkg,context,access);
    return {...selected.value,snapshot:pin(context,access,[selected.state])};
  }
  function list(input,access,expected) {
    const context=methodContext({readSet:input.readSet,roleId:input.roleId}),packages=new Map();
    for(const ns of context.readSet)for(const row of db.prepare(`SELECT DISTINCT package_id FROM method_bindings WHERE ${where}`).all(...boundary(ns))) {
      const pkg=identity(row.package_id);packages.set(pkg.packageId,pkg);
    }
    const entries=[...packages.values()].sort((a,b)=>a.packageId.localeCompare(b.packageId)).map(pkg=>stateFor(pkg,context,access));
    return page(context.readSet,expected,input,entries,selected=>({methods:selected.map(item=>item.value),snapshot:pin(context,access,selected.map(item=>item.state))}));
  }
  function events(ns,input,expected) {
    const filter=input.package===undefined?null:methodPackageRef(input.package);
    const entries=db.prepare(`SELECT * FROM method_binding_events WHERE ${where}${filter?' AND package_id=?':''} ORDER BY ordinal`).all(...boundary(ns),...(filter?[filter.packageId]:[])).map(row=>{
      const pkg=identity(row.package_id);
      if(filter && JSON.stringify(pkg)!==JSON.stringify(filter))return null;
      return {eventId:row.event_id,binding:bindingRef(ns,pkg,row),kind:row.kind,state:row.state,
        version:row.version_id?{type:'method-version',namespace:pkg.namespace,packageId:pkg.packageId,versionId:row.version_id,manifestIdentity:row.manifest_identity}:null,
        generation:row.generation,actionId:row.action_id,createdAt:row.created_at,ordinal:row.ordinal,
        reasonRefs:JSON.parse(row.reason_refs).map(ref=>({ref,status:reasonAvailable(ns,ref)?'available':'unavailable'}))};
    }).filter(Boolean);
    return page(ns,expected,input,entries,events=>({events}));
  }
  return {transition,resolve,list,events,decode,pinVersion,adoption,stateFor};
}
