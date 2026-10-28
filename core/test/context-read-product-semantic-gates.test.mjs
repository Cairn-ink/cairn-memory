import test from 'node:test';
import assert from 'node:assert/strict';
import { retrievalMetrics,pairedBootstrap,evaluateSemanticGates,stagingAddedLatency } from '../context-semantic-gates.mjs';

test('P2e-22 independent binary recall and nDCG arithmetic',()=>{
  const r=retrievalMetrics(['other','a','b'],['a','b','missing']);
  assert.equal(r.recall5,2/3);assert.equal(r.recall12,2/3);
  assert.equal(r.ndcg12,(1/Math.log2(3)+1/Math.log2(4))/(1+1/Math.log2(3)+1/Math.log2(4)));
  const b=pairedBootstrap(Array(50).fill(.05),12345);assert.equal(b.draws.length,10000);assert.ok(Math.abs(b.lower-.05)<1e-15);assert.equal(b.lower,b.upper);
  assert.deepEqual(b,pairedBootstrap(Array(50).fill(.05),12345));
});
function registration(delta=.06) {
  const queries=[],strata=[];
  for(const language of ['zh','en','ja','mixed'])for(const intent of ['current','history'])for(const schema of [18,23,33])for(const world of [1112,3336]) {
    const cell={language,intent,schema,world},id=JSON.stringify(cell),rows=Array.from({length:60},(_,i)=>({id:id+':'+i,positive:i<50,valid:true,a:{recall12:0,ndcg12:0},b:{recall12:delta,ndcg12:.01},cell}));
    queries.push(...rows);strata.push({id,cell,primary:true,applicable:true,queryIds:rows.map(q=>q.id)});
  }
  for(const id of ['zh-to-en','en-to-zh','cross-language','paraphrase','short-cjk','code-switching','exact-identifier','identifier:path','identifier:sha','identifier:error','identifier:flag']) {
    const rows=queries.filter(q=>id==='zh-to-en'?q.cell.language==='zh':id==='en-to-zh'?q.cell.language==='en':true);
    const parent={id,applicable:true,critical:['zh-to-en','en-to-zh','cross-language','paraphrase'].includes(id),identifier:id==='exact-identifier'||id.startsWith('identifier:'),queryIds:rows.map(q=>q.id)};
    strata.push(parent);
    for(const intent of ['current','history'])for(const schema of [18,23,33])for(const world of [1112,3336])strata.push({...parent,id:`${id}:${intent}:${schema}:${world}`,queryIds:rows.filter(q=>q.cell.intent===intent&&q.cell.schema===schema&&q.cell.world===world).map(q=>q.id)});
  }
  return {queries,strata,seed:9721,safety:true,extension:true,acceptance:true};
}
test('P2e-22 primary weights exclude overlapping challenges; all conjunctive gates apply',()=>{
  const r=registration();assert.equal(evaluateSemanticGates(r).state,'pass');
  assert.equal(evaluateSemanticGates(registration(.05)).state,'pass');
  assert.equal(evaluateSemanticGates({...r,safety:false}).state,'fail');
  assert.equal(evaluateSemanticGates(registration(.02)).state,'fail');
  assert.equal(evaluateSemanticGates({...r,strata:r.strata.filter(s=>s.id!=='paraphrase')}).state,'inconclusive');
  assert.equal(evaluateSemanticGates({...r,queries:r.queries.slice(0,59)}).state,'inconclusive');
  const bad=registration();bad.queries.forEach(q=>{q.a.ndcg12=.1;q.b.ndcg12=0;});assert.equal(evaluateSemanticGates(bad).state,'fail');
  const invalid=registration();invalid.queries[0].valid=false;assert.equal(evaluateSemanticGates(invalid).state,'inconclusive');
});
test('P2e-22 staging uses four distinct matched populations and p95 subtraction',()=>{
  const cells=['current','history'].flatMap(intent=>[2000,5000].map(requestMaxMs=>({intent,requestMaxMs,memories:1642,namespaces:26,schema:18,canonicalJournal:'DELETE',sidecarJournal:'DELETE',
    pairs:Array.from({length:53},(_,i)=>({warmup:i<3,valid:true,hybrid:true,a:100,b:250}))})));
  assert.equal(stagingAddedLatency(cells).state,'pass');assert.equal(stagingAddedLatency(cells).reports[0].addedP95Ms,150);
  cells[0].pairs.forEach(p=>p.b=250.01);assert.equal(stagingAddedLatency(cells).state,'fail');
  assert.equal(stagingAddedLatency(cells.slice(1)).state,'inconclusive');
});

test('P2e-22 independent seeded bootstrap draws and strict identifier/tolerance decisions',()=>{
  const differences=[-.02,.01,.03,.1],expected=[];let state=73n;
  const uniform=()=>{state=(state^(state<<13n))&0xffffffffn;state=(state^(state>>17n))&0xffffffffn;state=(state^(state<<5n))&0xffffffffn;return Number(state)/4294967296;};
  for(let draw=0;draw<10000;draw++){let sum=0;for(let n=0;n<4;n++)sum+=differences[Math.floor(uniform()*4)];expected.push(sum/4);}
  const actual=pairedBootstrap(differences,73);for(let i=0;i<10000;i++)assert.ok(Math.abs(actual.draws[i]-expected[i])<1e-16);
  expected.sort((a,b)=>a-b);assert.ok(Math.abs(actual.lower-expected[249])<1e-16);assert.ok(Math.abs(actual.upper-expected[9749])<1e-16);
  const identifier=registration(-.001),id=evaluateSemanticGates(identifier).reports.find(r=>r.id==='exact-identifier');assert.equal(id.pass,false);assert.ok(id.delta<0);
  const tolerance=registration(-.01),within=evaluateSemanticGates(tolerance).reports.find(r=>r.id.startsWith('{'));assert.equal(within.pass,true);
  const beyond=registration(-.010001),outside=evaluateSemanticGates(beyond).reports.find(r=>r.id.startsWith('{'));assert.equal(outside.pass,false);
});

test('P2e-10 fixed f32le known answer canonicalizes negative zero and rejects noncanonical bytes',async()=>{
  const {canonicalVectorBytes,manifestVector,rawSha256}=await import('../context-vector-validation.mjs');
  const {HOSTED_ID}=await import('../context-semantic-input.mjs');
  const identity={provider:'openai',model:'text-embedding-3-small',id:HOSTED_ID,revision:'provider-unversioned',dimensions:1536,normalization:'l2'};
  const v=new Float32Array(1536);v[0]=1;v[1]=-0;
  const bytes=canonicalVectorBytes(v,identity);assert.equal(bytes.readUInt32LE(0),0x3f800000);assert.equal(bytes.readUInt32LE(4),0);
  const oracle=Buffer.alloc(6144);oracle.writeUInt32LE(0x3f800000,0);assert.deepEqual(bytes,oracle);
  assert.equal(rawSha256(bytes),'JHPbaMkqnCHeq_6hSPI9WZxfBhYFMZKWiSblgEA9tDs');
  const bad=Buffer.from(bytes);bad.writeUInt32LE(0x80000000,4);assert.throws(()=>manifestVector(bad,identity),{code:'index_unavailable'});
});


test('P2e-07 the full 64-target canonical digest does not inherit a whole-IPC node ceiling',async()=>{
  const {targetSetDigest}=await import('../context-semantic-input.mjs');
  const {createHash}=await import('node:crypto');
  const {boundedData}=await import('../context-product-control.mjs');
  const targets=Array.from({length:32},(_,i)=>['current','history'].map(intent=>({storeId:'synthetic',canonicalIdentity:{device:'1',inode:'2',applicationId:3,userVersion:18,schemaVersion:4},
    readSet:[{ownerId:'owner',scope:'personal',projectId:null},...Array.from({length:32},(_,j)=>({ownerId:'owner',scope:'project',projectId:'p'+j})).filter((_,j)=>j!==i)],types:['memory'],intent}))).flat();
  const encode=v=>Array.isArray(v)?'['+v.map(encode).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+encode(v[k])).join(',')+'}':JSON.stringify(v);
  assert.throws(()=>boundedData(targets),{code:'invalid_input'});
  assert.equal(targetSetDigest(targets),createHash('sha256').update(encode(targets)).digest('base64url'));
});
