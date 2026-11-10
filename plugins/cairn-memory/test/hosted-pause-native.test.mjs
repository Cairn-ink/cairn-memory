import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { captureCursorPath, writeCaptureCursor } from '../lib/capture-cursor.mjs';
import { hostedTargetId } from '../lib/http.mjs';
import { createServer } from 'node:http';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

const hook = fileURLToPath(new URL('../scripts/hook.mjs', import.meta.url));
const launcher = fileURLToPath(new URL('../scripts/launch-capture.mjs', import.meta.url));
const foregroundPreload = fileURLToPath(new URL('./fixtures/pause-foreground-preload.mjs', import.meta.url));
const nativePreload = fileURLToPath(new URL('./fixtures/pause-native-preload.mjs', import.meta.url));
const active = { paused: false, generation: 0, enforced: true };
const paused = { paused: true, generation: 1, enforced: true };
async function fixture(t, observation = () => active, memories = []) {
  const ws = createTestWorkspace(t), home = join(ws.path, 'home'), root = join(home, 'data');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(join(root, 'project-key'), '11111111-1111-4111-8111-111111111111\n', { mode: 0o600 });
  const transcript = join(ws.path, 'transcript.jsonl');
  await writeFile(transcript, JSON.stringify({ type: 'user', uuid: 'synthetic-message',
    message: { content: 'Synthetic capture text.' } }) + '\n');
  const captures=[];
  const counts = { pause: 0, recall: 0, capture: 0, other: 0 };
  const server = createServer((request, response) => {
    let body=''; request.on('data',chunk=>{body+=chunk;});
    request.on('end',()=>{if(request.url.endsWith('/capture'))captures.push(JSON.parse(body));});
    response.setHeader('content-type', 'application/json');
    if (request.url.endsWith('/pause-state')) {
      const value = observation(++counts.pause);
      if (value === null) return; // Explicitly held until the child aborts.
      if (value === undefined) { response.writeHead(503); response.end('{}'); }
      else response.end(JSON.stringify(value));
    } else if (request.url.endsWith('/recall')) {
      counts.recall++; response.end(JSON.stringify({ memories }));
    } else if (request.url.endsWith('/capture')) {
      counts.capture++; response.end(JSON.stringify({ duplicate: false, memoryCount: 1 }));
    } else { counts.other++; response.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const env = { PATH: '/usr/bin:/bin', HOME: home, TMPDIR: ws.path, CLAUDE_PLUGIN_DATA: root,
    CLAUDE_PLUGIN_OPTION_API_ENDPOINT: endpoint, CLAUDE_PLUGIN_OPTION_API_TOKEN: 'synthetic-token',
    CLAUDE_PLUGIN_OPTION_TELEMETRY: 'false' };
  const input = { session_id: 'synthetic-session', prompt: 'Synthetic recall query.',
    transcript_path: transcript, cwd: ws.path, capture_generation: 'initial' };
  return { counts, env, input, captures, transcript, root, endpoint };
}
async function run(t, f, action, { entry = hook, preload = nativePreload, onSpawn } = {}) {
  const events = [], started = performance.now();
  const child = spawn(process.execPath, [...(preload ? [preload].flat().flatMap(path=>['--import',path]) : []), entry, ...(action ? [action] : [])],
    { env: f.env, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  child.on('message', event => events.push(event));
  const done = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
  });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await done; });
  onSpawn?.(child);
  child.stdin.end(JSON.stringify(f.input));
  const result = await done;
  assert.equal(result.code, 0); assert.equal(result.signal, null); assert.equal(stderr, '');
  return { stdout, events, elapsedMs: performance.now() - started };
}
const memory={ id:'11111111-1111-4111-8111-111111111111',content:'Synthetic memory.',kind:'fact',scope:'personal',
  projectId:null,origin:'explicit',confidence:1,createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',
  receipts:[{client:'claude-code',sessionId:'s',eventId:'e',role:'user',excerpt:'Synthetic source.',createdAt:'2026-10-01T00:00:00Z'}]};
for(const action of ['recall','capture','capture-detached']) {
  test(`native ${action} sends after fresh active observations`,{timeout:10000},async t=>{
    const f=await fixture(t,()=>active,action==='recall'?[memory]:[]);
    const result=await run(t,f,action);
    assert.equal(f.counts.pause,action==='recall'?1:2,'native_fresh_observations');
    assert.equal(f.counts[action==='recall'?'recall':'capture'],1,'native_active_send');
    if(action==='recall')assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext,/Synthetic memory/);
  });
  for(const [label,bad] of (action==='recall' ? [['paused',paused],['unavailable',undefined]] : [['paused',paused],['unavailable',undefined],['regressed',{...active,generation:0}]])) {
    for(const at of (action==='recall'?[1]:label==='regressed'?[2]:[1,2])) test(`native ${action} blocks ${label} at observation ${at}`,{timeout:10000},async t=>{
      const before=label==='regressed'?{...active,generation:1}:active;
      const f=await fixture(t,number=>number>=at?bad:before);
      if(label==='regressed' && action!=='recall')await writeCaptureCursor(captureCursorPath(f.root,f.input.session_id),{
        offset:0,generation:'initial',discardUntilNewline:false,hostedGeneration:1,hostedTarget:hostedTargetId({endpoint:f.endpoint}),
      });
      const result=await run(t,f,action);
      assert.equal(f.counts.recall+f.counts.capture,0,'native_denied_content');assert.equal(result.stdout,'');
      assert.equal(f.counts.pause,at,'native_denial_observation_reached');
    });
  }
}
for(const action of ['capture','capture-detached']) test(`native ${action} discards paused-period bytes after resume across fresh processes`,{timeout:15000},async t=>{
  let remote=active;
  const f=await fixture(t,()=>remote);
  await run(t,f,action);assert.equal(f.counts.capture,1,'pre_pause_capture');
  remote=paused;await run(t,f,action);
  await appendFile(f.transcript,JSON.stringify({type:'user',uuid:'paused-message',message:{content:'SYNTHETIC_PAUSED_PERIOD'}})+'\n');
  remote={...paused,paused:false};
  await run(t,f,action);
  assert.equal(f.counts.capture,1,'resume_eof_skips_paused_bytes');
  await appendFile(f.transcript,JSON.stringify({type:'user',uuid:'resumed-message',message:{content:'SYNTHETIC_AFTER_RESUME'}})+'\n');
  await run(t,f,action);assert.equal(f.counts.capture,2,'post_resume_capture');
  assert.ok(f.captures.flatMap(body=>body.messages).every(message=>!message.content.includes('SYNTHETIC_PAUSED_PERIOD')),'zero_paused_period_bytes');
});
for(const hook_event_name of ['Stop','PreCompact']) test(`native ${hook_event_name} foreground has zero network`,{timeout:10000},async t=>{
  const f=await fixture(t);f.input.hook_event_name=hook_event_name;
  const result=await run(t,f,'',{entry:launcher,preload:[nativePreload,foregroundPreload]});
  assert.deepEqual(f.counts,{pause:0,recall:0,capture:0,other:0});assert.equal(result.stdout,'');
});

for(const endpoint of ['file:///synthetic/local','stdio://synthetic'])test(`native non-HTTP ${new URL(endpoint).protocol} stays local`,{timeout:10000},async t=>{
  const f=await fixture(t);f.env.CLAUDE_PLUGIN_OPTION_API_ENDPOINT=endpoint;
  for(const action of ['recall','capture','capture-detached'])assert.equal((await run(t,f,action)).stdout,'');
  assert.deepEqual(f.counts,{pause:0,recall:0,capture:0,other:0});
});

for(const action of ['capture','capture-detached'])test(`native ${action} observes before each batch`,{timeout:10000},async t=>{
  const f=await fixture(t,number=>number<3?active:paused);
  await writeFile(f.transcript,Array.from({length:25},(_,index)=>JSON.stringify({type:'user',uuid:'message-'+index,message:{content:'Synthetic message '+index}})).join('\n')+'\n');
  await run(t,f,action);
  assert.equal(f.counts.pause,3,'every_batch_observes');assert.equal(f.counts.capture,1,'second_batch_blocked');
  assert.equal(f.captures.flatMap(body=>body.messages).length,24);
});
