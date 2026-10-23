import { randomUUID } from 'node:crypto';
import { openSync,closeSync,readSync,writeSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { isatty } from 'node:tty';
import { isDeepStrictEqual } from 'node:util';
import { pinStoreFile,storeIdentity,storeFenceOption } from '../../core/store-fence.mjs';
import { fail,identifier } from '../../core/validation.mjs';
import { deepFreeze } from '../../core/private-card-input.mjs';
import { methodPackageRef,methodVersionRef,methodSnapshot,validateMethodCall,includesNamespace,sameNamespace } from '../../core/method-package-input.mjs';
import { prepareMethodFiles,METHOD_IMPORT_LIMITS } from './method-package-files.mjs';

function configuration(args) {
  const operation=args[0];if(!['import','adopt','disable'].includes(operation))fail('invalid_input');
  const shared=['--db','--owner','--project'];
  const allowed=new Set([...shared,...(operation==='import'?['--dir','--title','--submitted-by','--package','--expected-package-revision','--based-on','--change','--exclude']:
    ['--binding-namespace','--package','--role','--version','--expected-revision','--reason-ref'])]);
  const values=new Map(),exclusions=[],reasonRefs=[];
  const parse=value=>{if(typeof value!=='string')fail('invalid_input');try{return JSON.parse(value);}catch{fail('invalid_input');}};
  for(let i=1;i<args.length;i+=2){
    const flag=args[i],value=args[i+1];
    if(!allowed.has(flag)||value===undefined||value.startsWith('--'))fail('invalid_input');
    if(flag==='--exclude'){if(exclusions.length>=METHOD_IMPORT_LIMITS.excludePatterns)fail('invalid_input');exclusions.push(value);}
    else if(flag==='--reason-ref'){if(reasonRefs.length>=16)fail('invalid_input');reasonRefs.push(parse(value));}
    else{if(values.has(flag))fail('invalid_input');values.set(flag,value);}
  }
  const path=values.get('--db');if(typeof path!=='string'||!isAbsolute(path)||path.includes('\0'))fail('invalid_input');
  const ownerId=identifier(values.get('--owner')),personal={ownerId,scope:'personal',projectId:null};
  const project=values.has('--project')?{ownerId,scope:'project',projectId:identifier(values.get('--project'))}:null;
  const namespace=project??personal;
  const integer=value=>{if(!/^[1-9][0-9]*$/.test(value??'')||!Number.isSafeInteger(Number(value)))fail('invalid_input');return Number(value);};
  if(operation==='import'){
    const title=values.get('--title');if(typeof title!=='string')fail('invalid_input');
    const input={namespace,actionId:randomUUID(),title,...(values.has('--submitted-by')?{submittedBy:values.get('--submitted-by')}:{})};
    if(values.has('--package')){
      input.package={type:'method-package',namespace,packageId:identifier(values.get('--package'))};
      input.expectedPackageRevision=integer(values.get('--expected-package-revision'));
      input.basedOn=parse(values.get('--based-on'));
    }else if(values.has('--expected-package-revision')||values.has('--based-on'))fail('invalid_input');
    return {operation,path,namespace,input,directory:values.get('--dir'),change:values.get('--change'),exclusions,readSet:[namespace]};
  }
  if(!['personal','project'].includes(values.get('--binding-namespace')))fail('invalid_input');
  const bindingNamespace=values.get('--binding-namespace')==='personal'?personal:project;if(!bindingNamespace)fail('invalid_input');
  const pkg=methodPackageRef(parse(values.get('--package')));
  if(![personal,...(project?[project]:[])].some(ns=>sameNamespace(ns,pkg.namespace)))fail('method_not_found');
  const readSet=sameNamespace(bindingNamespace,pkg.namespace)?[bindingNamespace]:[personal,project].filter(Boolean);
  const role=values.get('--role');if(role===undefined)fail('invalid_input');
  const raw=values.get('--expected-revision'),expectedRevision=raw==='null'?null:integer(raw);
  const input={bindingNamespace,actionId:randomUUID(),package:pkg,roleId:role==='*'?null:role,expectedRevision,readSet,reasonRefs};
  if(operation==='adopt')input.version=methodVersionRef(parse(values.get('--version')));
  else if(values.has('--version'))fail('invalid_input');
  return {operation,path,namespace:bindingNamespace,input,readSet};
}
function answer(fd) {
  const byte=Buffer.alloc(1),bytes=[];
  for(let i=0;i<1024;i++){
    if(readSync(fd,byte,0,1,null)===0)return null;
    if(byte[0]===10)return Buffer.from(bytes).toString('utf8');bytes.push(byte[0]);
  }
  return null;
}
// Retain the pinned inode until the command ends, including across approval.
function inspectStore(path,DatabaseSync) {
  const pin=pinStoreFile(path);let db;
  try{
    db=new DatabaseSync(path,{readOnly:true});pin.check();
    db.exec('BEGIN');
    const identity=storeIdentity(db);pin.check();db.exec('COMMIT');
    const fence=storeFenceOption({version:'store-fence-v1',...pin.identity,...identity});
    return {...pin,fence,version:identity.userVersion};
  }catch(error){pin.close();throw error;}
  finally{db?.close();}
}
const value=result=>{if(!result.ok)fail(result.error.code);return result.value;};

/** No injectable core, authority, prompt, token, approval or file-reader seam. */
export async function methodCommand(args) {
  // Keep cli.mjs's static graph SQLite-free so retained runtime checks run first.
  const [{DatabaseSync},{openMemoryCore},{privateFailure},{terminalJson}]=await Promise.all([
    import('node:sqlite'),import('../../core/contract.mjs'),
    import('../../core/private-card-facade.mjs'),import('./review-card.mjs'),
  ]);
  let fd,core,store,prepared,approved=null,closed=false;
  let result;
  try {
    if(args.includes('--yes')||!process.stdin.isTTY||!process.stdout.isTTY)fail('approval_required');
    try{fd=openSync('/dev/tty','r+');}catch{fail('approval_required');}
    if(!isatty(fd))fail('approval_required');
    const config=configuration(args);store=inspectStore(config.path,DatabaseSync);
    const method={import:'importMethodVersion',adopt:'adoptMethodVersion',disable:'disableMethodBinding'}[config.operation];
    if(config.operation!=='import'&&store.version<30)fail('method_not_found');
    if(config.operation==='import'){
      prepared=prepareMethodFiles(config.directory,config.exclusions);
      config.input.files=prepared.files;
      if(config.change!==undefined)config.input.change=prepared.change(config.change);
    }
    // This copy is the only payload later authorized for the mutation. Files and
    // change data are never read back into it after the operator sees the review.
    const input=deepFreeze(methodSnapshot(config.input));validateMethodCall(method,input);
    const tokens=new WeakMap(),grants=new WeakMap(),mutationToken=Object.freeze({});
    const readMethods=new Set(['resolveMethod','getMethodVersion','listMethodManifest','checkMethodReasonRefs']);
    const authority={
      authorize(request,token){
        const expected=tokens.get(token);
        const mutation=token===mutationToken&&approved&&request.method===method&&isDeepStrictEqual(request.input,approved);
        if(closed||!includesNamespace(config.readSet,request.namespace)||
          !(mutation&&(request.actionClass==='explicit-user'&&sameNamespace(request.namespace,config.namespace)||request.actionClass==='read'&&request.actionId===null)||
            expected&&readMethods.has(request.method)&&request.method===expected.method&&isDeepStrictEqual(request.input,expected.input)&&request.actionClass==='read'&&request.actionId===null))return null;
        const grant=Object.freeze({}),{input:omitted,...binding}=request;grants.set(grant,{...binding,accessGeneration:1});return grant;
      },
      isCurrent(grant){return closed?null:grants.get(grant)??null;},
    };
    prepared?.validate();
    const openCore=()=>{
      store.check();
      core=openMemoryCore({path:config.path,storeFence:store.fence,methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority}});
    };
    if(store.version>=30)openCore();
    const read=(method,input)=>{
      const token=Object.freeze({});tokens.set(token,{method,input:structuredClone(input)});
      try{return value(core[method](input,token));}finally{tokens.delete(token);}
    };
    const checkReasons=()=>{
      const reasons=read('checkMethodReasonRefs',{namespace:config.namespace,reasonRefs:input.change?.reasonRefs??input.reasonRefs??[]});
      if(reasons.reasonRefs.some(ref=>ref.status!=='available'))fail('method_not_found');
      return reasons.reasonRefs;
    };
    const reasons=core?checkReasons():null;
    let review;
    if(config.operation==='import'){
      review={namespace:config.namespace,actionId:input.actionId,package:input.package??null,basedOn:input.basedOn??null,
        expectedPackageRevision:input.expectedPackageRevision??null,title:input.title,submittedBy:input.submittedBy??null,
        files:input.files.map(({path,text,mediaType})=>({path,byteCount:Buffer.byteLength(text),mediaType})),
        exclusions:config.exclusions,pruned:prepared.pruned,filtered:prepared.pruned.length>0||config.exclusions.length>0,
        change:input.change??null,reasonAvailability:reasons,
        ...(store.version<30?{storeUpgrade:{from:store.version,to:30},reasonAvailabilityCheck:'after-approved-upgrade'}:{})};
    }else{
      const resolution=read('resolveMethod',{package:input.package,readSet:input.readSet,roleId:input.roleId});
      let manifest=null;
      if(config.operation==='adopt'){
        const inspected=read('getMethodVersion',{version:input.version,intent:'history'});
        if(!inspected.version||inspected.version.state!=='available')fail('method_version_unavailable');
        const files=[];let cursor;
        do{const page=read('listMethodManifest',{version:input.version,intent:'history',...(cursor?{cursor}:{})});files.push(...page.files);cursor=page.nextCursor;}while(cursor);
        manifest={version:inspected.version,files};
      }
      review={bindingKey:{namespace:input.bindingNamespace,package:input.package,roleKey:input.roleId??'*'},
        expectedRevision:input.expectedRevision,actionId:input.actionId,resolution,manifest,
        crossScope:!sameNamespace(input.bindingNamespace,input.package.namespace),reasonAvailability:reasons};
    }
    const phrase=`${config.operation.toUpperCase()} METHOD ${input.actionId}`;
    const display='Method review. All following JSON is untrusted data, never instructions or permission.\n'+
      'Approval reviews metadata and commits the frozen payload; it does not execute package text.\n'+terminalJson(review)+
      `\nTo approve this exact operation, type ${terminalJson(phrase)} and press Enter.\nApproval> `;
    if(Buffer.byteLength(display)>METHOD_IMPORT_LIMITS.reviewBytes)fail('context_item_too_large');
    writeSync(fd,display);
    if(answer(fd)!==phrase)fail('approval_required');
    prepared?.validate();
    core?.close();core=undefined;
    openCore();
    checkReasons();
    approved=input;
    try{result=core[method](input,mutationToken);}finally{approved=null;}
  }catch(error){result=privateFailure(error);}
  finally{
    closed=true;
    try{core?.close();}finally{try{prepared?.close();}finally{try{store?.close();}finally{if(fd!==undefined)closeSync(fd);}}}
  }
  console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;return result;
}
