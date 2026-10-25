import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runLocalMeasurement, parseLocalMeasurement, measureLocalWorkload } from '../../../tools/testing/measure-local-embedder.mjs';
import { fixture } from './fixtures/pack.mjs';
import { verifyPack } from '../pack.mjs';
import { loadRuntime } from '../runtime.mjs';
import { assertLocalQualificationAdmission } from '../../../tools/testing/local-embedder-admission.mjs';
const args = ['--pack','/synthetic/pack','--expected-manifest-sha256','a'.repeat(64),'--output','/synthetic/report.json'];

test('L14 qualification cannot complete with a valid runtime: real admission and every workload stage complete offline', async t => {
  const f = await fixture(t), pack = await verifyPack(f.root, { catalog: f.catalog });
  const texts = [], models = [], bundles = [];
  let crashed = 0;
  const start = async (p, threads, { onRegistration }) => {
    const runtime = await loadRuntime(p, threads, async () => ({ env: {},
      AutoTokenizer: { from_pretrained: async () => (text, options) => {
        assert.equal(options.truncation, false); texts.push(text);
        const count = text.trim().split(/\s+/u).length + 2;
        return { input_ids: { dims: [1, count], data: new BigInt64Array(count) } };
      } },
      AutoModel: { from_pretrained: async () => async tokens => {
        const count = tokens.input_ids.data.length; models.push(count);
        const data = new Float32Array(count * 1024); data[0] = 1;
        return { last_hidden_state: { dims: [1, count, 1024], data } };
      } } }));
    await runtime.embed(['warm-up']);
    let status = { state: 'ready', reason: null }, lastTokenCount, resolveClosed;
    const closed = new Promise(resolve => { resolveClosed = resolve; });
    const bundle = { localStatus: () => status, whenClosed: () => closed,
      diagnostics: () => ({ lastTokenCount }),
      async embed(input) {
        if (status.state !== 'ready') throw Object.assign(Error('child_crash'), { code: 'child_crash' });
        const value = await runtime.embed(input); lastTokenCount = value.tokenCounts[0]; return value.vectors;
      },
      crash() { status = { state: 'unavailable', reason: 'child_crash' }; resolveClosed(); },
      async close() { status = { state: 'closed', reason: 'closed' }; resolveClosed(); await runtime.close(); } };
    bundles.push(bundle); onRegistration({ inferencePid: 900000001, supervisorPid: 900000002 }); return bundle;
  };
  let written;
  const result = await runLocalMeasurement(['--pack', f.root, '--expected-manifest-sha256', pack.manifestHash, '--output', f.parent + '/report.json'], {
    verify: async () => pack,
    workload: (p, config) => measureLocalWorkload(p, config, { start,
      monitorRss: () => ({ start() {}, async close() {}, report: () => ({ peakInferenceBytes: 1, peakSupervisorBytes: 1, peakParentBytes: 1 }) }),
      crash(pid) { assert.equal(pid, 900000001); crashed++; bundles.at(-1).crash(); } }),
    write: async (_, value) => { written = value; } });
  assert.equal(result.exitCode, 0, JSON.stringify(written));
  const report = written.workload;
  assert.equal(report.warmQuery.samples, 20); assert.equal(report.lookup.samples, 20);
  assert.equal(report.refresh.short.embedded, 8); assert.equal(report.refresh.short.attempts, 8);
  assert.equal(report.refresh.nearLimit.embedded, 1); assert.equal(report.refresh.nearLimit.attempts, 1);
  assert.equal(report.refresh.nearLimit.tokenCount, 8105);
  const materialized = texts.find(text => text.startsWith('qualification near limit\n'));
  assert.equal(materialized, 'qualification near limit\n' + 'x '.repeat(8100).trim());
  assert.equal(texts.filter(text => text === materialized).length, 1);
  assert.equal(texts.filter(text => text === 'x '.repeat(20000)).length, 1);
  assert.equal(models.includes(20002), false, 'oversized input never reaches the model');
  assert.equal(report.tokenRefusal, 'context_item_too_large'); assert.equal(report.explicitReinitialization, 'ready');
  assert.equal(crashed, 1); assert.equal(bundles.length, 2); assert.equal(report.diskBytes > 0, true);
  assert.deepEqual(report.failures, []); assert.ok(report.eventLoopDelay); assert.equal(written.ok, true);
});
test('L14 exact qualification arguments, fail-nonzero reports, no runtime work before all verification', async () => {
  assert.deepEqual(parseLocalMeasurement(args),{packPath:'/synthetic/pack',expectedHash:'a'.repeat(64),output:'/synthetic/report.json'});
  for(const bad of [[],args.slice(0,-1),[...args,'--download','yes'],[...args,'--pack','/again'],args.map(v=>v==='/synthetic/pack'?'relative':v),args.map(v=>v==='a'.repeat(64)?'A'.repeat(64):v)]) assert.throws(()=>parseLocalMeasurement(bad),{code:'invalid_input'});
  for(const mode of ['missing','hash','runtime','success']){
    let calls=0,written;
    const result=await runLocalMeasurement(args,{verify:async()=>{if(mode==='missing')throw Object.assign(Error('CANARY_PATH'),{code:'model_pack_unavailable'});return{manifestHash:(mode==='hash'?'b':'a').repeat(64)};},
      workload:async()=>{calls++;if(mode==='runtime')throw Object.assign(Error('CANARY_SECRET'),{code:'model_runtime_unavailable'});return{fixture:true};},write:async(path,value)=>{assert.equal(path,'/synthetic/report.json');written=value;}});
    assert.equal(result.exitCode,mode==='success'?0:1);assert.equal(calls,['runtime','success'].includes(mode)?1:0);assert.equal(JSON.stringify(written).includes('CANARY'),false);
    assert.equal(written.ok,mode==='success');
  }
});
test('L14 dispatch-only four serialized exclusive-runner cells and pinned invocation; normal CI stays model-free', async () => {
  const text=await readFile(new URL('../../../.github/workflows/local-embedder-qualification.yml',import.meta.url),'utf8');
  assert.match(text,/name: Local embedder qualification/);assert.match(text,/\n  workflow_dispatch:/);assert.doesNotMatch(text,/\n  (?:push|pull_request|schedule):/);
  for(const input of ['linux_pack_dir','macos_pack_dir','manifest_sha256'])assert.match(text,new RegExp(input+':\\n\\s+type: string\\n\\s+required: true'));
  const cells=[...text.matchAll(/runner: \[([^\]]+)\]\n\s+node: '([^']+)'\n\s+pack_input: (\w+)/g)].map(m=>({labels:m[1].split(', '),node:m[2],input:m[3]}));
  assert.deepEqual(cells,[...['linux','macOS']].flatMap(os=>['22.16.0','24.15.0'].map(node=>({labels:['self-hosted',os,os==='linux'?'x64':'ARM64','cairn-local-embedder-qualification'],node,input:os==='linux'?'linux_pack_dir':'macos_pack_dir'}))));
  for(const rule of ['max-parallel: 1','fail-fast: false','cancel-in-progress: false','group: cairn-local-embedder-qualification','if: always()','local-embedder-admission.mjs','exit "$task_rc"'])assert.ok(text.includes(rule),rule);
  assert.ok(text.includes('npm run measure:local-embedder -- --pack "$CAIRN_QUAL_PACK" --expected-manifest-sha256 "$CAIRN_QUAL_MANIFEST" --output "$CAIRN_QUAL_REPORT"'));
  assert.doesNotMatch(text,/npm (?:ci|install)|setup-node|curl|wget/);assert.doesNotMatch(text,/run:.*\$\{\{ inputs/);
  const pkg=JSON.parse(await readFile(new URL('../../../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.scripts['measure:local-embedder'],'node tools/testing/run.mjs --script tools/testing/measure-local-embedder.mjs');
  assert.ok(Object.entries(pkg.scripts).filter(([k])=>k.startsWith('test:')).every(([,v])=>!v.includes('measure-local-embedder')));
  const ci=await readFile(new URL('../../../.github/workflows/ci.yml',import.meta.url),'utf8');assert.equal(ci.includes('measure:local-embedder'),false);assert.match(ci,/local-embedder-offline:/);assert.ok(ci.includes('npm run test:local-embedder'));assert.equal(pkg.scripts['test:local-embedder'],'node tools/testing/run.mjs adapters/local-embedder/test/*.test.mjs');
});
test('L14 missing external queue admission refuses before any model work',async()=>{
  await assert.rejects(assertLocalQualificationAdmission({}, {read(){assert.fail('no read');}}));
});
test('L14 queue lease must match this cell, commit and lifetime',async()=>{
  const commit='c'.repeat(40),env={CAIRN_QUAL_ADMISSION:'/synthetic/lease',CAIRN_QUAL_EXPECTED_NODE:process.versions.node,GITHUB_SHA:commit,CAIRN_QUAL_MANIFEST:'a'.repeat(64),CAIRN_QUAL_PACK:'/synthetic/pack'};
  const lease={commit,node:process.versions.node,platform:process.platform,arch:process.arch,expiresAt:200,exclusive:true};
  const inspect=async()=>({isFile:()=>true,isSymbolicLink:()=>false,size:200,nlink:1,uid:process.getuid?.(),mode:0o600});
  await assertLocalQualificationAdmission(env,{now:()=>100,inspect,read:async()=>Buffer.from(JSON.stringify(lease))});
  for(const bad of [{expiresAt:99},{exclusive:false},{commit:'d'.repeat(40)},{node:'20.0.0'},{extra:true}])await assert.rejects(assertLocalQualificationAdmission(env,{now:()=>100,inspect,read:async()=>Buffer.from(JSON.stringify({...lease,...bad}))}));
});
