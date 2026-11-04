// Run before the quiet window. This controller never loads SQLite.
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync,realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve,dirname } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { validateRegistration,writerProfile } from '../../tools/testing/measure-context-read-product.mjs';
import { validateV4Registration } from '../../tools/testing/fixtures/context-product/v4-runner.mjs';
import { estimateV4Segment } from '../../tools/testing/fixtures/context-product/v4-plan.mjs';
import { V3_DEFINITION,validateNativeVolume } from '../../tools/testing/fixtures/context-product/protocol.mjs';
import { isDeepStrictEqual } from 'node:util';
import { counterAssets,counterConfiguration } from './counter.mjs';
const packageRoot=dirname(fileURLToPath(import.meta.url));
export function segmentEstimates(registration) {
  return registration.segments.map(segment=>{
    const estimate=estimateV4Segment('engine',registration,segment.id);
    return {id:segment.id,cells:estimate.cells,estimateSeconds:estimate.estimateSeconds,sessions:estimate.sessions,assumption:'V4.6 allowances; 1800 s failure allowance per segment; each shared session counted once; no timing claim'};
  });
}
export function validateFilled(input) {
  validateNativeVolume(input);
  if(/PLACEHOLDER|\$\{[^}]*\}/.test(JSON.stringify(input)))throw Error('unfilled_registration');
  const templateBytes=readFileSync(new URL('./registration.engine.template.json',import.meta.url));
  if(readFileSync(new URL('./registration.engine.template.sha256',import.meta.url),'utf8')!==createHash('sha256').update(templateBytes).digest('hex')+'  registration.engine.template.json\n')throw Error('template_hash_changed');
  const frozen=JSON.parse(templateBytes);
  for(const key of ['productionNode','counterId','deadlines','pump','productInputs','readCutoffReport','stateDeadlines'])if(!isDeepStrictEqual(input[key],frozen[key]))throw Error('product_input_changed:'+key);
  if(input.counterModule!==new URL('./counter.mjs',import.meta.url).href)throw Error('counter_module_must_be_registered');
  validateV4Registration(input,'engine');
  validateRegistration({...input,protocolDefinition:V3_DEFINITION},{engineProfile:true});
  writerProfile(input.writerProfile);
  for(const estimate of segmentEstimates(input)) {
    if(estimate.cells===0||estimate.estimateSeconds>24300)throw Error('segment_exceeds_single_night');
    const registered=input.segments.find(s=>s.id===estimate.id);
    if(registered.estimateSeconds!==estimate.estimateSeconds)throw Error('segment_estimate_changed');
  }
  if(input.writerProfile.captureMs!==25000||input.writerProfile.reviewMs!==5000)throw Error('writer_profile_must_be_25000_5000');
  return input;
}
function gitHead() {const r=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});if(r.status!==0)throw Error('git_exit:'+r.status);return r.stdout.trim();}
export async function fillRegistration(hostInput,profilePath) {
  validateNativeVolume(hostInput);
  let input=JSON.parse(readFileSync(new URL('./registration.engine.template.json',import.meta.url),'utf8'));
  const allowed=new Set(['host','volume','volumeRoot','platformRole','filesystem','profileCommit','protocolCommit','counterConfiguration']);
  for(const field of Object.keys(hostInput))if(!allowed.has(field))throw Error('host_field_not_fillable:'+field);
  if(Object.keys(hostInput.counterConfiguration??{}).some(k=>k!=='dependencyRoot'))throw Error('host_field_not_fillable:counterConfiguration');
  for(const field of ['host','volume','volumeRoot','platformRole'])if(!hostInput[field])throw Error('host_field_required:'+field);
  const volumeRoot=realpathSync(resolve(hostInput.volumeRoot));
  // Explicit host overrides are registered before validation and collection.
  input={...input,...hostInput,volumeRoot,filesystem:hostInput.filesystem??hostInput.volume.filesystem,
    profileCommit:hostInput.profileCommit??gitHead(),protocolCommit:hostInput.protocolCommit??gitHead()};
  input.counterConfiguration=counterConfiguration({...hostInput.counterConfiguration,counterId:input.counterId});
  input.reservation={...input.reservation,owner:hostInput.host.owner};
  if(!profilePath)throw Error('writer_profile_registration_input_required');
  input.writerProfileFile=resolve(profilePath);
  input.writerProfile=writerProfile(JSON.parse(readFileSync(input.writerProfileFile,'utf8')));
  input=JSON.parse(JSON.stringify(input).replaceAll('${volumeRoot}',volumeRoot).replaceAll('${packageRoot}',packageRoot));
  for(const key of ['adapterModule','counterModule'])input[key]=pathToFileURL(input[key]).href;
  input.inputFiles=[input.writerProfileFile,...counterAssets(input.counterConfiguration),...['manifest.json','corpus.mjs','labels.json','queries.json','schemas.mjs','registration.engine.template.json','registration.engine.template.sha256','registration.mjs','generate.mjs','generate-child.mjs','canonical-evidence.mjs','build-template.mjs','registration.constants.json','gold-rank.mjs','freeze.mjs','counter-deps/package.json','counter-deps/package-lock.json'].map(n=>resolve(packageRoot,n))];
  validateFilled(input);
  const counter=await (await import(input.counterModule)).createCounter(input.counterConfiguration);if(counter.id!==input.counterId||counter.countTokens('東京 海港 orchard')<1)throw Error('counter_unavailable');
  return input;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),get=k=>args[args.indexOf(k)+1];
  if(args.includes('--validate')){
    const input=validateFilled(JSON.parse(readFileSync(get('--validate'),'utf8')));
    const counter=await (await import(input.counterModule)).createCounter(input.counterConfiguration);if(counter.id!==input.counterId)throw Error('counter_identity');
    for(const value of segmentEstimates(input))console.log(JSON.stringify(value));
  }else{
    if(!args.includes('--host')||!args.includes('--out'))throw Error('usage: registration.mjs --host host.json --out registration.json [--writer-profile writer-profile.json]');
    const input=await fillRegistration(JSON.parse(readFileSync(get('--host'),'utf8')),args.includes('--writer-profile')?get('--writer-profile'):undefined);
    writeFileSync(get('--out'),JSON.stringify(input,null,2)+'\n',{flag:'wx',mode:0o400});
    for(const value of segmentEstimates(input))console.log(JSON.stringify(value));
  }
}
