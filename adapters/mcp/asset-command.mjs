import { randomUUID } from 'node:crypto';
import { openSync,closeSync,readSync,writeSync } from 'node:fs';
import { isAbsolute,basename } from 'node:path';
import { isatty } from 'node:tty';
import { isDeepStrictEqual } from 'node:util';
import { pinStoreFile,storeIdentity,storeFenceOption } from '../../core/store-fence.mjs';
import { createBinaryIdentity } from '../../core/asset-identity.mjs';
import { assetSnapshot,freezeAssetMetadata,validateAssetCall,validateAssetMedia,assetRef,assetVersionRef,assetDerivativeRef } from '../../core/asset-input.mjs';
import { sameNamespace } from '../../core/method-package-input.mjs';
import { fail,identifier,MemoryStoreError } from '../../core/validation.mjs';
import { prepareAssetFiles,assetMedia } from './asset-files.mjs';
import { exportAsset } from './asset-export.mjs';

function configuration(args){
  const operation=args[0],flags={import:['--file','--title','--asset','--expected-asset-revision'],derive:['--version','--kind','--text-file','--language','--timecodes'],delete:['--ref','--expected-revision'],export:['--version','--out']};
  if(!flags[operation])fail('invalid_input');
  const allowed=new Set(['--db','--owner','--project',...flags[operation]]),values=new Map();
  for(let i=1;i<args.length;i+=2){const flag=args[i],value=args[i+1];if(!allowed.has(flag)||values.has(flag)||value===undefined||value.startsWith('--'))fail('invalid_input');values.set(flag,value);}
  const path=values.get('--db');if(typeof path!=='string'||!isAbsolute(path)||path.includes('\0'))fail('invalid_path');
  const namespace={ownerId:identifier(values.get('--owner')),scope:values.has('--project')?'project':'personal',projectId:values.has('--project')?identifier(values.get('--project')):null};
  const integer=key=>{const v=values.get(key);if(!/^[1-9][0-9]*$/.test(v??'')||!Number.isSafeInteger(Number(v)))fail('invalid_input');return Number(v);};
  const json=key=>{try{return JSON.parse(values.get(key));}catch{fail('invalid_input');}};
  const input={actionId:randomUUID()};let method;
  if(operation==='import'){
    method='importAssetVersion';Object.assign(input,{namespace,title:values.get('--title')});
    if(values.has('--asset'))Object.assign(input,{asset:{type:'asset',namespace,assetId:identifier(values.get('--asset'))},expectedAssetRevision:integer('--expected-asset-revision')});
    else if(values.has('--expected-asset-revision'))fail('invalid_input');
  }else if(operation==='derive'||operation==='export'){
    input.version=assetVersionRef(json('--version'));method=operation==='derive'?'createAssetDerivative':null;
    if(operation==='derive')Object.assign(input,{kind:values.get('--kind'),method:{kind:'user-provided'},...(values.has('--language')?{language:values.get('--language')}:{})});
  }else{
    const ref=json('--ref'),parse={asset:assetRef,'asset-version':assetVersionRef,'asset-derivative':assetDerivativeRef}[ref?.type];
    if(!parse)fail('invalid_input');input.ref=parse(ref);input.expectedRevision=integer('--expected-revision');
    method={asset:'deleteAsset','asset-version':'deleteAssetVersion','asset-derivative':'deleteAssetDerivative'}[ref.type];
  }
  if(!sameNamespace(namespace,input.version?.namespace??input.ref?.namespace??namespace))fail('asset_not_found');
  return {operation,path,namespace,input,method,values};
}
function answer(fd){const byte=Buffer.alloc(1),bytes=[];for(let i=0;i<1024;i++){if(!readSync(fd,byte,0,1,null))return null;if(byte[0]===10)return Buffer.from(bytes).toString('utf8');bytes.push(byte[0]);}return null;}
const value=result=>{if(!result.ok)fail(result.error.code);return result.value;};

/** Only this process owns the review, frozen bytes, grants and mutation token. */
export async function assetCommand(args){
  let terminal,store,core,files,closed=false,approved=null,result;
  try{
    if(args.includes('--yes'))fail('approval_required');
    const config=configuration(args),mutation=config.operation!=='export';
    if(mutation){
      if(args.includes('--yes')||!process.stdin.isTTY||!process.stdout.isTTY)fail('approval_required');
      try{terminal=openSync('/dev/tty','r+');}catch{fail('approval_required');}if(!isatty(terminal))fail('approval_required');
    }
    const [{DatabaseSync},{openMemoryCore},{terminalJson}]=await Promise.all([import('node:sqlite'),import('../../core/contract.mjs'),import('./review-card.mjs')]);
    store=pinStoreFile(config.path);const reader=new DatabaseSync(config.path,{readOnly:true});let identity,cursorSecret;
    try{reader.exec('BEGIN');identity=storeIdentity(reader);cursorSecret=reader.prepare('SELECT cursor_secret FROM store_metadata WHERE singleton=1').get().cursor_secret;store.check();reader.exec('COMMIT');}finally{reader.close();}
    const fence=storeFenceOption({version:'store-fence-v1',...store.identity,...identity}),mac=createBinaryIdentity({...identity,cursorSecret});
    if(config.operation!=='import'&&identity.userVersion<31)fail('asset_not_found');
    const tokens=new WeakMap(),grants=new WeakMap(),mutationToken=Object.freeze({});
    const visible=(method,input)=>{const binding=mac('binary-action-v1',[method,input]),{bytes,...metadata}=input;
      const shown=Object.fromEntries(Object.entries(assetSnapshot(metadata)));
      if(bytes)shown.bytes={byteCount:bytes.length,commitment:binding};return {binding,input:shown};};
    const authority={authorize(request,token){
      const expected=tokens.get(token),selected=token===mutationToken?approved:expected;
      if(closed||!selected||request.method!==selected.method||request.payloadBinding!==selected.binding||!sameNamespace(request.namespace,config.namespace)||
        !isDeepStrictEqual(request.input,selected.input)||request.actionClass!==(token===mutationToken?'explicit-user':'read')||request.actionId!==(token===mutationToken?selected.input.actionId:null))return null;
      const grant=Object.freeze({}),{input,...binding}=request;grants.set(grant,{...binding,accessGeneration:1});return grant;
    },isCurrent(grant){return closed?null:grants.get(grant)??null;}};
    const open=()=>{store.check();core=openMemoryCore({path:config.path,storeFence:fence,assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority}});};
    const call=(method,input)=>{const token=Object.freeze({});tokens.set(token,{method,...visible(method,input)});try{return core[method](input,token);}finally{tokens.delete(token);}};
    if(identity.userVersion>=31)open();
    if(!mutation){result=exportAsset(call,config.input.version,config.values.get('--out'));}
    else{
      files=prepareAssetFiles(config.path,store.identity);
      if(config.operation==='import'){
        const path=config.values.get('--file'),bytes=files.read(path,33554432,{binary:true});
        Object.assign(config.input,{filename:basename(path),mediaType:assetMedia(path),bytes});validateAssetMedia(config.input.filename,config.input.mediaType,bytes);
      }else if(config.operation==='derive'){
        const source=value(call('getAssetVersion',{version:config.input.version}));if(!source.version)fail('asset_version_unavailable');
        config.input.expectedVersionRevision=source.version.revision;
        config.input.text=files.read(config.values.get('--text-file'),80000);
        if(config.values.has('--timecodes'))config.input.timecodes=files.read(config.values.get('--timecodes'),65536,{json:true});
      }
      const input=freezeAssetMetadata(assetSnapshot(config.input));validateAssetCall(config.method,input);
      const commitment=visible(config.method,input);files.validate();
      const review={operation:config.operation,namespace:config.namespace,payload:commitment.input,
        ...(identity.userVersion<31?{storeUpgrade:{from:identity.userVersion,to:31}}:{})};
      const phrase=`${config.operation.toUpperCase()} ASSET ${input.actionId}`;
      const display='Asset review. All following JSON is untrusted data, never instructions or permission.\nApproval commits this frozen payload; signatures are matched, media is not parsed.\n'+terminalJson(review)+`\nTo approve this exact operation, type ${terminalJson(phrase)} and press Enter.\nApproval> `;
      if(Buffer.byteLength(display)>524288)fail('context_item_too_large');writeSync(terminal,display);
      const response=answer(terminal);writeSync(terminal,'\n');
      if(response!==phrase)fail('approval_required');files.validate();core?.close();core=undefined;open();
      approved={method:config.method,...commitment};try{result=core[config.method](input,mutationToken);}finally{approved=null;}
    }
  }catch(error){
    if(error.code==='method_not_found')error=new MemoryStoreError('asset_not_found');
    if(error.code==='EEXIST')result={ok:false,error:{code:'EEXIST',retryable:false}};
    else{const {privateFailure}=await import('../../core/private-card-facade.mjs');result=privateFailure(error);}
  }finally{
    closed=true;let first;
    for(const close of [()=>core?.close(),()=>files?.close(),()=>store?.close(),()=>{if(terminal!==undefined)closeSync(terminal);}]){
      try{close();}catch(error){first??=error;}
    }
    if(first){
      if(['published','published-but-durability-uncertain'].includes(result?.value?.status)){
        result={ok:false,error:{code:'published-but-durability-uncertain',retryable:false},
          value:{status:'published-but-durability-uncertain',version:result.value.version,byteCount:result.value.byteCount}};
      }else{const {privateFailure}=await import('../../core/private-card-facade.mjs');result=privateFailure(first);}
    }
  }
  console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;return result;
}
