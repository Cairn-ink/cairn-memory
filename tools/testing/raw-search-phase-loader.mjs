import {registerHooks} from 'node:module';

// Opt-in measurement transforms only; the serving modules have no observer
// callbacks. Each sample contains phase duration alone, with no source data.
export function installPhaseMeasurement(){
  const helper=new URL('./raw-search-phase-ledger.mjs',import.meta.url).href;
  return registerHooks({load(url,context,next){
    const result=next(url,context);
    if(!/\/core\/raw-search-(index|authority|storage|retrieval|maintenance|sqlite)\.mjs$/.test(url))return result;
    let source=typeof result.source==='string'?result.source:Buffer.from(result.source).toString('utf8');source+='\n__measurement_end__';
    const replace=(before,after)=>{if(source.split(before).length!==2)throw Error('measurement_source_changed');source=source.replace(before,after);};
    const wrap=(start,next,name,finish='')=>{
      const a=source.indexOf(start),b=source.indexOf(next,a),end=source.lastIndexOf('\n'+start.match(/^ */)[0]+'}',b);
      if(a<0||b<0||end<a)throw Error('measurement_phase_missing');
      const brace=source.indexOf('{\n',a)+1;
      source=source.slice(0,end)+'\n    }finally{sample('+JSON.stringify(name)+',performance.now()-phaseStart);'+finish+'}\n'+source.slice(end);
      source=source.slice(0,brace)+'\n    const phaseStart=performance.now();try{'+source.slice(brace);
    };
    if(url.endsWith('/raw-search-sqlite.mjs')){
      // Capture at the origin before an opener's foreign catch can rename it.
      replace("throw Object.assign(new MemoryStoreError('search_deadline'),{reason:'deadline'});",
        "const error=Object.assign(new MemoryStoreError('search_deadline'),{reason:'deadline'});internalFailure(error,'origin');throw error;");
    }else if(url.endsWith('/raw-search-index.mjs')){
      replace("const safeFailure = error => { fail(","const safeFailure = error => { internalFailure(error); fail(");
      replace("}catch{fail('raw_search_unavailable');}","}catch(error){internalFailure(error);fail('raw_search_unavailable');}finally{operationEnd(at);}");
      replace("catch{return {state:'unavailable'","catch(error){internalFailure(error);return {state:'unavailable'");
      wrap('    async function retry(', '    async function search(','operation','operationEnd(at);');
      replace('return retry(deadlineAt=>searchAttempt(value,token,deadlineAt),at,emptyPartial);',
        'return await retry(deadlineAt=>searchAttempt(value,token,deadlineAt),at,emptyPartial);');
      wrap('    async function search(value,token)', '    async function searchAttempt','search');
      replace(`database=openReadDatabase(options.path,{contextRead:true,busyTimeoutMs:0,preflight:openingCheck,
      nativeObserver:{invoke(_kind,_label,work){openingCheck();return work();},database:native=>rawSearchSqlite(native,openingCheck)}});`,
        `database=measured('canonical-open',()=>openReadDatabase(options.path,{contextRead:true,busyTimeoutMs:0,preflight:openingCheck,
      nativeObserver:{invoke(_kind,_label,work){openingCheck();return work();},database:native=>rawSearchSqlite(native,openingCheck)}}));`);
    }else if(url.endsWith('/raw-search-authority.mjs')){
      wrap('  function bindWithin(', '  const sourceIdentity','bounded-hash');
      wrap('  function buildFence(', '  function fence(','commitment');
      wrap('  function validate(', '  function reset(','final-validation');
    }else if(url.endsWith('/raw-search-storage.mjs')){
      wrap('export async function openRawSearchStorage(', '\n__measurement_end__','sidecar-open');
      if(source.includes('  function searchSlice(')){
        wrap('  function snapshotInside(', '  function searchSlice(','snapshot');
        wrap('  async function search(', '  function head(','snapshot');
      }else wrap('  function snapshotInside(', '  function publication(','snapshot');
      wrap('  function publicationInside(', '  async function stage(','publication-shape');
      replace('if (!row || row.signature !== sign(row.data,row.vectors))',"if (!row || row.signature !== measured('authentication',()=>sign(row.data,row.vectors)))");
      replace('unpack(row.data,vectorBytes(row.vectors))',"measured('hint-decode',()=>unpack(row.data,vectorBytes(row.vectors)))");
    }else if(url.endsWith('/raw-search-maintenance.mjs')){
      replace("const refusal = error => ['budget_denied','timeout','rate_limited','dimension_mismatch','invalid_vector'].includes(error?.code) ? error.code : 'provider_error';",
        "const refusal = error => {internalFailure(error);return ['budget_denied','timeout','rate_limited','dimension_mismatch','invalid_vector'].includes(error?.code) ? error.code : 'provider_error';};");
    }else{
      wrap('export function retrieveRaw(', 'export function loadRawVectorBlocks(', 'hierarchy');
      // The vector loader is synchronous and has one terminal return.
      replace('export function loadRawVectorBlocks(segments,metadata,check=()=>{}) {',
        'export function loadRawVectorBlocks(segments,metadata,check=()=>{}) {const phaseStart=performance.now();try{');
      replace('  return {blocks,offsets,positions,dimensions,blockVectors,count};\n}',
        "  return {blocks,offsets,positions,dimensions,blockVectors,count};\n}finally{sample('vector-load',performance.now()-phaseStart);}}" );
      source="import {performance} from 'node:perf_hooks';\n"+source;
    }
    return {...result,source:'import {sample,measured,selectionUnit,internalFailure,operationEnd} from '+JSON.stringify(helper)+';\n'+source.replace('\n__measurement_end__','')};
  }});
}
