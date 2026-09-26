import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { before } from 'node:test';
import { buildArtifact, command, packageName, runtimeFiles } from '../build.mjs';
import { createExperimentBudget } from '../../evaluation/experiment-budget/index.mjs';
import { createExperimentRequestGuard, authorizeQualificationExtension } from '../../evaluation/experiment-budget/request-guard.mjs';
import { experimentPolicy } from '../../evaluation/live/session.mjs';
import { createQualificationLiveSession } from '../../evaluation/live/qualification-session.mjs';
import { startExperimentProxy } from '../../evaluation/live/proxy.mjs';
import { qualificationPoolWire } from '../../adapters/openai/test/qualification-pool-wire.mjs';
import { getQualificationPilotPins, runQualificationPilot } from '../../evaluation/live/qualification-pilot.mjs';
import { fileURLToPath } from 'node:url';

const requireSDK = createRequire(new URL('../../adapters/mcp/package.json', import.meta.url));
const { Client } = await import(requireSDK.resolve('@modelcontextprotocol/client'));
const { StdioClientTransport } = await import(requireSDK.resolve('@modelcontextprotocol/client/stdio'));
const readJSON = (path) => JSON.parse(readFileSync(path, 'utf8'));
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
let artifact;
let installation;

function install(archive, directory = mkdtempSync(join(tmpdir(), 'cairn-installed-preview-'))) {
  if (!existsSync(join(directory, 'package.json'))) writeFileSync(join(directory, 'package.json'),
    JSON.stringify({ name: 'synthetic-local-install', private: true, version: '0.0.0' }), { flag: 'wx' });
  assert.equal(command('npm', ['prefix', '--prefix', directory], directory, archive.userconfig).trim(), directory);
  command('npm', ['install', '--prefix', directory, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', archive.artifactPath],
    directory, archive.userconfig);
  return { directory, packagePath: join(directory, 'node_modules', packageName),
    executable: join(directory, 'node_modules', '.bin', 'cairn-memory') };
}

before(() => {
  artifact = buildArtifact();
  installation = install(artifact);
});

async function connect(t, installed, databasePath, { owner = 'synthetic-installed-owner', project } = {}) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [installed.executable, '--db', databasePath, '--owner', owner, ...(project ? ['--project', project] : [])],
    cwd: installed.directory, env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' }, stderr: 'pipe' });
  const client = new Client({ name: 'synthetic-installed-client', version: '1.0.0' });
  t.after(async () => { await client.close(); });
  await client.connect(transport);
  return client;
}

async function call(client, name, args = {}) {
  const response = await client.callTool({ name, arguments: args });
  assert.equal(response.content[0].type, 'text');
  const result = JSON.parse(response.content[0].text);
  assert.equal(Boolean(response.isError), !result.ok);
  assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions');
  return result;
}
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };

for (const mode of ['success', 'invalid-first-qualification', 'transport-failure']) {
  test(`installed qualification pilot retains all six cases with ${mode} fake upstream`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'cairn-installed-qualification-pilot-'));
    const ledger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd: 50_000_000, requestCap: 1000 };
    createExperimentBudget(ledger).close();
    const policy = experimentPolicy();
    createExperimentRequestGuard({ ledger, policy, fetchImpl: () => assert.fail('No setup transport') }).close();
    const privateDirectory = join(root, 'evidence'); mkdirSync(privateDirectory, { mode: 0o700 });
    const apiKey = 'synthetic-pilot-parent-key';
    let sends = 0; let qualifications = 0;
    const report = await runQualificationPilot({ ledger, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 },
      apiKey, nodePath: realpathSync(process.execPath), cairnExecutable: realpathSync(installation.executable),
      cairnArtifact: artifact.artifactPath, cairnArtifactSha256: hash(artifact.artifactPath),
      privateDirectory, pins: getQualificationPilotPins(), fetchImpl: async (url, options) => {
        sends++;
        assert.equal(new Headers(options.headers).get('authorization'), `Bearer ${apiKey}`);
        if (mode === 'transport-failure') return new Response('synthetic unavailable', { status: 503 });
        const payload = JSON.parse(options.body);
        if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
        const input = JSON.parse(payload.input[0].content[0].text); let output;
        assert.equal(Object.hasOwn(input, 'expected'), false); assert.equal(Object.hasOwn(input, 'query'), false);
        if (payload.text.format.name === 'cairn_extract') {
          assert.deepEqual(Object.keys(input), ['messages']);
          output = { items: [{ content: input.messages[0].content, kind: 'preference', confidence: 0.9, sourceIndices: [0] }] };
        } else if (payload.text.format.name === 'cairn_qualify') {
          qualifications++;
          output = { qualifications: input.items.map(item => ({ itemIndex: item.itemIndex,
            qualification: { version: 1, slot: { subject: null, property: null, scope: null, applies: null },
              value: null, attribution: 'unknown', commitment: 'unknown', anchors: [{ receiptIndex: 0, start: 0,
                end: mode === 'invalid-first-qualification' && qualifications === 1 ? 999 : item.sources[0].excerpt.length,
                text: item.sources[0].excerpt, fields: ['value'] }] } })) };
        } else {
          assert.equal(payload.text.format.name, 'cairn_classify');
          output = { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
        }
        return Response.json({ object: 'response', model: payload.model, status: 'completed', error: null,
          incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
            content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
          usage: { input_tokens: 120, output_tokens: 100, total_tokens: 220 } });
      } });
    assert.equal(report.semanticReviewRequired, true);
    assert.equal(report.cases.length, 6);
    const events = report.cases.flatMap(item => [item.events.initial, item.events.later]);
    assert.equal(events.length, 12);
    assert.equal(JSON.stringify(report).includes(apiKey), false);
    if (mode === 'success') {
      assert.equal(sends, 72);
      assert.ok(events.every(event => event.status === 'completed'), JSON.stringify(report));
    } else if (mode === 'invalid-first-qualification') {
      assert.equal(sends, 64);
      assert.equal(events[0].status, 'failed'); assert.equal(events[1].status, 'not_run');
      assert.ok(events.slice(2).every(event => event.status === 'completed'), JSON.stringify(report));
    } else {
      assert.equal(sends, 1);
      assert.equal(events[0].status, 'failed');
      assert.ok(events.slice(1).every(event => event.status === 'not_run'), JSON.stringify(report));
    }
    assert.equal(existsSync(join(ledger.directory, 'qualification-pilot-v1-intent.json')), true);
    const verify = createExperimentRequestGuard({ ledger, policy, fetchImpl: () => assert.fail('No verification transport') });
    try {
      const state = verify.getState();
      assert.equal(state.requestCount, sends); assert.equal(state.reservedMicroUsd, sends * 5000);
      assert.ok(state.attempts.every(attempt => attempt.outcome !== null));
    } finally { verify.close(); }
    const intentPath = join(ledger.directory, 'qualification-pilot-v1-intent.json');
    const intentBefore = readFileSync(intentPath);
    const retryDirectory = join(root, 'retry-evidence'); mkdirSync(retryDirectory, { mode: 0o700 });
    const retry = await runQualificationPilot({ ledger,
      expectedCheckpoint: { requestCount: sends, reservedMicroUsd: sends * 5000 },
      apiKey, nodePath: realpathSync(process.execPath), cairnExecutable: realpathSync(installation.executable),
      cairnArtifact: artifact.artifactPath, cairnArtifactSha256: hash(artifact.artifactPath),
      privateDirectory: retryDirectory, pins: getQualificationPilotPins(),
      fetchImpl: () => assert.fail('Existing intent must prevent repeat transport') });
    assert.equal(retry.status, 'halted');
    assert.ok(retry.cases.every(item => item.events.initial.status === 'not_run' && item.events.later.status === 'not_run'));
    assert.deepEqual(readFileSync(intentPath), intentBefore);
  });
}

test('installed qualification pilot preserves a partial intent without sending or repairing it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-pilot-partial-intent-'));
  const ledger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd: 50_000_000, requestCap: 1000 };
  createExperimentBudget(ledger).close();
  createExperimentRequestGuard({ ledger, policy: experimentPolicy(), fetchImpl: () => assert.fail('No setup transport') }).close();
  const intentPath = join(ledger.directory, 'qualification-pilot-v1-intent.json');
  writeFileSync(intentPath, '{partial', { flag: 'wx', mode: 0o600 });
  const directory = join(root, 'evidence'); mkdirSync(directory, { mode: 0o700 });
  const report = await runQualificationPilot({ ledger, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 },
    apiKey: 'synthetic-key', nodePath: realpathSync(process.execPath), cairnExecutable: realpathSync(installation.executable),
    cairnArtifact: artifact.artifactPath, cairnArtifactSha256: hash(artifact.artifactPath),
    privateDirectory: directory, pins: getQualificationPilotPins(), fetchImpl: () => assert.fail('No partial-intent transport') });
  assert.equal(report.status, 'halted');
  assert.equal(report.budgetAfter.requestCount, 0);
  assert.equal(readFileSync(intentPath, 'utf8'), '{partial');
});

test('installed qualified MCP launcher uses the shared capability guard through an authenticated proxy', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-qualified-guard-install-'));
  const ledger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd: 50_000_000, requestCap: 100 };
  createExperimentBudget(ledger).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger, policy, fetchImpl: () => assert.fail('Provisioning has no transport') }).close();
  const qualificationExtension = authorizeQualificationExtension({ ledger, policy, authorizationId: 'synthetic-installed-qualification' });
  const parentKey = 'synthetic-parent-provider-key';
  let sends = 0; let forbid = false;
  const session = createQualificationLiveSession({ ledger, apiKey: parentKey, qualificationExtension,
    fetchImpl: async (url, options) => {
      assert.equal(forbid, false, 'Cold inspection/replay must not use provider transport'); sends++;
      assert.equal(new Headers(options.headers).get('authorization'), `Bearer ${parentKey}`);
      const payload = JSON.parse(options.body);
      if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
      const input = JSON.parse(payload.input[0].content[0].text); let output;
      if (payload.text.format.name === 'cairn_extract') output = { items: [{ content: input.messages[0].content,
        kind: 'preference', confidence: 0.9, sourceIndices: [0] }] };
      else if (payload.text.format.name === 'cairn_qualify') output = { qualifications: input.items.map(item => ({
        itemIndex: item.itemIndex, qualification: { version: 1, slot: { subject: null, property: null, scope: null, applies: null },
          value: null, attribution: 'unknown', commitment: 'unknown', anchors: [{ receiptIndex: 0, start: 0,
            end: item.sources[0].excerpt.length, text: item.sources[0].excerpt, fields: ['value'] }] } })) };
      else {
        assert.equal(payload.text.format.name, 'cairn_classify');
        output = { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
      }
      return Response.json({ object: 'response', model: payload.model, status: 'completed', error: null,
        incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
        usage: { input_tokens: 120, output_tokens: 100, total_tokens: 220 } });
    } });
  const proxy = await startExperimentProxy({ session });
  t.after(async () => { await proxy.close(); session.close(); });
  assert.notEqual(proxy.token, parentKey);
  const config = join(root, 'launcher.json');
  writeFileSync(config, JSON.stringify({ version: 1, packageRoot: installation.packagePath, proxyUrl: proxy.url }), { mode: 0o600, flag: 'wx' });
  const db = join(root, 'memory.sqlite');
  const launcher = fileURLToPath(new URL('../../evaluation/live/cairn-launcher.mjs', import.meta.url));
  const start = async () => {
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [launcher, '--db', db, '--owner', 'synthetic-qualified-proxy', '--capture-qualification', 'source-bound-v1'],
      cwd: installation.directory,
      env: { CAIRN_LIVE_CONFIG: config, OPENAI_API_KEY: proxy.token, NODE_NO_WARNINGS: '1' }, stderr: 'pipe' });
    const client = new Client({ name: 'synthetic-guard-install', version: '1.0.0' });
    t.after(() => client.close()); await client.connect(transport); return client;
  };
  let client = await start();
  const request = { batchId: 'guarded-installed-batch', messages: [{ role: 'user', content: '週報請用繁體中文。' }] };
  const captured = ok(await call(client, 'capture_memory', request));
  const memoryId = captured.admission.memories[0].id;
  const before = ok(await call(client, 'inspect_memory', { memoryId, includeQualification: true }));
  assert.equal(before.qualification.anchors[0].text, request.messages[0].content);
  const state = session.getState();
  assert.equal(sends, 6); assert.equal(state.requestCount, sends);
  assert.equal(state.reservedMicroUsd, 30_000);
  assert.equal(state.attempts.filter(attempt => attempt.actualMicroUsd === null).length, 3);
  assert.ok(state.attempts.every(attempt => attempt.outcome !== null));
  await client.close(); forbid = true;
  client = await start();
  assert.deepEqual(ok(await call(client, 'inspect_memory', { memoryId, includeQualification: true })), before);
  assert.equal(ok(await call(client, 'capture_memory', request)).duplicate, true);
  assert.deepEqual(session.getState(), state);
  await client.close();
  for (const flags of [['--capture-qualification', 'wrong'], ['--capture-qualification'],
    ['--capture-qualification', 'source-bound-v1', '--capture-qualification', 'source-bound-v1']]) {
    const invalidPath = join(root, 'invalid.sqlite');
    const result = spawnSync(process.execPath, [launcher, '--db', invalidPath, '--owner', 'synthetic', ...flags],
      { env: { CAIRN_LIVE_CONFIG: config, OPENAI_API_KEY: proxy.token, NODE_NO_WARNINGS: '1' }, encoding: 'utf8' });
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.equal(result.stderr.trim(), 'cairn_live_launcher_failed');
    assert.equal(existsSync(invalidPath), false);
  }
  assert.deepEqual(session.getState(), state);
});

test('installed v2 MCP launcher captures and cold-replays without granting a paid method', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-installed-v2-mcp-'));
  const databasePath = join(root, 'memory.sqlite');
  let sends = 0; let readOnly = false; let active;
  const proxy = await startExperimentProxy({ session: { request: async (route, body) => {
    assert.equal(readOnly, false, 'Inspection, replay and mode mismatch must make no request');
    sends++; const payload = JSON.parse(body);
    if (route === '/responses/input_tokens') return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
    assert.equal(route, '/responses');
    const input = JSON.parse(payload.input[0].content[0].text); let output;
    if (payload.text.format.name === 'cairn_extract') output = { items: [{ content: input.messages[0].content,
      kind: 'preference', confidence: 0.9, sourceIndices: [0] }] };
    else if (payload.text.format.name === 'cairn_qualifyCandidates') output = { qualifications: input.items.map(item => ({
      itemIndex: item.itemIndex,
      subject: { value: null, evidenceIndices: [item.candidates[0].candidateIndex] },
      property: { value: null, evidenceIndices: [] }, scope: { value: null, evidenceIndices: [] },
      applies: { value: null, evidenceIndices: [] }, value: { value: null, evidenceIndices: [] },
      attribution: { value: 'unknown', evidenceIndices: [] }, commitment: { value: 'unknown', evidenceIndices: [] },
    })) };
    else {
      assert.equal(payload.text.format.name, 'cairn_classify');
      output = { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
    }
    if (payload.text.format.name === 'cairn_qualifyCandidates') {
      output = qualificationPoolWire(input, output);
    }
    return Response.json({ object: 'response', model: payload.model, status: 'completed', error: null,
      incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
      usage: { input_tokens: 120, output_tokens: 100, total_tokens: 220 } });
  } } });
  t.after(async () => { if (active) await active.close(); await proxy.close(); });
  const config = join(root, 'transport.json');
  writeFileSync(config, JSON.stringify({ version: 1, packageRoot: installation.packagePath, proxyUrl: proxy.url }), { mode: 0o600, flag: 'wx' });
  const start = async (mode = 'source-bound-v2') => {
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL('../../evaluation/live/cairn-launcher.mjs', import.meta.url)),
        '--db', databasePath, '--owner', 'synthetic-v2-mcp', '--capture-qualification', mode],
      env: { CAIRN_LIVE_CONFIG: config, OPENAI_API_KEY: proxy.token, NODE_NO_WARNINGS: '1' }, stderr: 'pipe' });
    active = new Client({ name: 'synthetic-installed-v2', version: '1.0.0' });
    await active.connect(transport); return active;
  };
  let client = await start();
  assert.equal((await client.listTools()).tools.length, 6);
  const batches = ['上午請用清單。', '下午請用段落。'].map((content, index) => ({
    batchId: 'v2-installed-' + index, messages: [{ role: 'user', content }],
  }));
  const records = [];
  for (const batch of batches) {
    const capture = ok(await call(client, 'capture_memory', batch));
    const record = ok(await call(client, 'inspect_memory', { memoryId: capture.admission.memories[0].id, includeQualification: true }));
    assert.equal(record.memory.state, 'active'); assert.equal(record.qualification.anchors[0].text, batch.messages[0].content);
    records.push(record);
  }
  assert.equal(sends, 12); await client.close(); readOnly = true;
  client = await start();
  for (let index = 0; index < records.length; index++) {
    assert.deepEqual(ok(await call(client, 'inspect_memory', { memoryId: records[index].memory.id, includeQualification: true })), records[index]);
    assert.equal(ok(await call(client, 'capture_memory', batches[index])).duplicate, true);
  }
  await client.close(); client = await start('source-bound-v1');
  assert.equal((await call(client, 'capture_memory', batches[0])).error.code, 'event_payload_conflict');
  assert.equal(sends, 12);
  await client.close();
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM qualified_claim_bindings').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM qualified_slots').get().n, 0);
  } finally { db.close(); }
});

test('installed MCP captures qualified submitted text and reopens without new provider requests', async (t) => {
  const directory = installation.directory;
  const databasePath = join(directory, 'mcp-qualified.sqlite');
  const tracePath = join(directory, 'mcp-qualified-calls.txt');
  const fixturePath = join(directory, 'mcp-qualified-fixture.mjs');
  // This generated fixture imports runtime and dependencies only from the installed archive.
  writeFileSync(fixturePath, `import assert from 'node:assert/strict';
    import { appendFileSync } from 'node:fs';
    import { createRequire } from 'node:module';
    import { createCairnServer } from './node_modules/${packageName}/adapters/mcp/server.mjs';
    import { createOpenAIModel } from './node_modules/${packageName}/adapters/openai/index.mjs';
    const requireInstalled=createRequire(new URL('./node_modules/${packageName}/package.json',import.meta.url));
    const {serveStdio,StdioServerTransport}=await import(requireInstalled.resolve('@modelcontextprotocol/server/stdio'));
    globalThis.fetch=()=>assert.fail('Native network forbidden');
    const model=createOpenAIModel({apiKey:'synthetic-fake-only',fetchImpl:async(url,options)=>{
      assert.notEqual(process.argv[4],'deny','Cold replay must not call transport');
      const payload=JSON.parse(options.body); const method=payload.text.format.name;
      appendFileSync(process.argv[3],method+'\\n');
      if(url.endsWith('/input_tokens')) return new Response(JSON.stringify({object:'response.input_tokens',input_tokens:120}));
      const input=JSON.parse(payload.input[0].content[0].text); let output;
      if(method==='cairn_extract') output={items:[{content:input.messages[0].content,
        kind:'preference',confidence:0.9,sourceIndices:[0]}]};
      else if(method==='cairn_qualify') output={qualifications:input.items.map(item=>({itemIndex:item.itemIndex,
        qualification:{version:1,slot:{subject:null,property:null,scope:null,applies:null},value:null,
          attribution:'unknown',commitment:'unknown',anchors:[{receiptIndex:0,start:0,
            end:item.sources[0].excerpt.length,text:item.sources[0].excerpt,fields:['value']}]}}))};
      else if(method==='cairn_classify') output={items:input.memories.map(memory=>({memoryId:memory.id,parentIds:[]}))};
      else assert.fail('Unexpected model method');
      return new Response(JSON.stringify({object:'response',model:payload.model,status:'completed',error:null,
        incomplete_details:null,output:[{type:'message',role:'assistant',status:'completed',
          content:[{type:'output_text',text:JSON.stringify(output)}]}],
        usage:{input_tokens:120,output_tokens:100,total_tokens:220}}));
    }});
    const handle=serveStdio(()=>createCairnServer({path:process.argv[2],model,
      namespace:{ownerId:'synthetic-installed-qualified',scope:'personal',projectId:null},
      captureQualification:'source-bound-v1'}),{
        transport:new StdioServerTransport(process.stdin,process.stdout,{maxBufferSize:65536})});
    process.stdin.once('end',()=>{void handle.close();});
    process.once('SIGTERM',()=>{void handle.close();});`, { flag: 'wx' });
  const start = async (deny = false) => {
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [fixturePath, databasePath, tracePath, ...(deny ? ['deny'] : [])],
      cwd: directory, env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' }, stderr: 'pipe' });
    const client = new Client({ name: 'synthetic-qualified-install', version: '1.0.0' });
    t.after(() => client.close());
    await client.connect(transport);
    return client;
  };
  let client = await start();
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 6);
  assert.equal(tools.find(tool => tool.name === 'capture_memory').annotations.openWorldHint, true);
  const request = { batchId: 'installed-submitted-batch', messages: [{ role: 'user', content: '我偏好紫色的電車 🚋。' }] };
  const captured = ok(await call(client, 'capture_memory', request));
  assert.equal(captured.duplicate, false);
  const memoryId = captured.admission.memories[0].id;
  const before = ok(await call(client, 'inspect_memory', { memoryId, includeQualification: true }));
  assert.equal(before.qualification.anchors[0].text, request.messages[0].content);
  const anchor = before.qualification.anchors[0];
  assert.equal(before.receipts.find(receipt => receipt.id === anchor.receiptId).excerpt.slice(anchor.start, anchor.end), anchor.text);
  const calls = readFileSync(tracePath, 'utf8');
  assert.equal(calls.split('\n').filter(method => method === 'cairn_qualify').length, 2);
  await client.close();
  client = await start(true);
  assert.deepEqual(ok(await call(client, 'inspect_memory', { memoryId, includeQualification: true })), before);
  assert.equal(ok(await call(client, 'capture_memory', request)).duplicate, true);
  assert.equal(readFileSync(tracePath, 'utf8'), calls);
  await client.close();
  const keyless = await connect(t, installation, databasePath, { owner: 'synthetic-installed-qualified' });
  assert.deepEqual(ok(await call(keyless, 'inspect_memory', { memoryId, includeQualification: true })), before);
  await keyless.close();
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(databasePath);
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM qualified_claim_bindings').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM qualified_slots').get().n, 0);
  } finally { db.close(); }
});

test('installed core and adapter capture source qualifications without granting update authority', () => {
  const probe = `import assert from 'node:assert/strict';
    import { DatabaseSync } from 'node:sqlite';
    import { openMemoryCore } from './node_modules/${packageName}/core/contract.mjs';
    import { createOpenAIModel } from './node_modules/${packageName}/adapters/openai/index.mjs';
    globalThis.fetch=()=>assert.fail('Native network is forbidden');
    const namespace={ownerId:'synthetic-installed-auto-qualification',scope:'personal',projectId:null};
    const methods=[]; const qualifications=[];
    const model=createOpenAIModel({apiKey:'synthetic-fake-only',fetchImpl:async(url,options)=>{
      const payload=JSON.parse(options.body); const method=payload.text.format.name;
      if(url.endsWith('/input_tokens')) return new Response(JSON.stringify({object:'response.input_tokens',input_tokens:120}));
      methods.push(method); const input=JSON.parse(payload.input[0].content[0].text); let output;
      if(method==='cairn_extract') output={items:[{content:input.messages[0].content,kind:'decision',confidence:0.9,sourceIndices:[0]}]};
      else if(method==='cairn_qualify') {
        output={qualifications:input.items.map(item=>{
          const text=item.sources[0].excerpt;
          const qualification={version:1,slot:{subject:null,property:null,scope:null,applies:null},value:null,
            attribution:'unknown',commitment:'unknown',anchors:[{receiptIndex:0,start:0,end:text.length,text,fields:['value']}]};
          qualifications.push(qualification); return {itemIndex:item.itemIndex,qualification};
        })};
      } else if(method==='cairn_classify') output={items:input.memories.map(memory=>({memoryId:memory.id,parentIds:[]}))};
      else assert.fail('Unexpected method '+method);
      return new Response(JSON.stringify({object:'response',model:payload.model,status:'completed',error:null,
        incomplete_details:null,output:[{type:'message',role:'assistant',status:'completed',
          content:[{type:'output_text',text:JSON.stringify(output)}]}],usage:{input_tokens:120,output_tokens:100,total_tokens:220}}));
    }});
    const ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
    const path='./automatic-qualification.sqlite';
    let core=openMemoryCore({path,model,captureQualification:'source-bound-v1'});
    const request=(index,ordered)=>({namespace,client:'synthetic',sessionId:'session',eventId:'event-'+index,
      messages:[{id:'message-'+index,role:'user',content:index===1?'I choose the violet tram 🚋.':'我正在考慮週五。'}],
      ...(ordered?{causal:{streamId:'synthetic-stream',sequence:1}}:{})});
    const first=ok(await core.capture(request(1,false))); const second=ok(await core.capture(request(2,true)));
    assert.deepEqual(second.reconciliation,{status:'unresolved',reason:'qualification_requires_identity',retiredCount:0});
    assert.equal(Object.hasOwn(first,'reconciliation'),false);
    const ids=[first,second].map(result=>result.admission.memories[0].id);
    const read=()=>ids.map(memoryId=>ok(core.get({namespace,memoryId,includeQualification:true})));
    const before=read();
    before.forEach((record,index)=>{
      const {anchors,...metadata}=record.qualification;
      const {anchors:expected,...expectedMetadata}=qualifications[index];
      assert.deepEqual(metadata.version,expectedMetadata.version);
      assert.deepEqual(metadata.slot,expectedMetadata.slot); assert.equal(metadata.value,null);
      assert.equal(metadata.attribution,'unknown'); assert.equal(metadata.commitment,'unknown');
      assert.equal(anchors[0].text,expected[0].text); assert.equal(anchors[0].start,0);
      assert.equal(anchors[0].end,expected[0].end); assert.deepEqual(anchors[0].fields,['value']);
      assert.equal(record.memory.state,'active');
    });
    core.close(); core=openMemoryCore({path,model,captureQualification:'source-bound-v1'});
    assert.deepEqual(read(),before);
    const calls=methods.length; const replay=ok(await core.capture(request(2,true)));
    assert.equal(replay.duplicate,true); assert.deepEqual(replay.reconciliation,second.reconciliation);
    assert.equal(methods.length,calls); assert.equal(methods.filter(method=>method==='cairn_qualify').length,2);
    core.close(); const db=new DatabaseSync(path);
    assert.equal(db.prepare('SELECT count(*) AS n FROM qualified_claim_bindings').get().n,0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM qualified_slots').get().n,0); db.close();
    console.log('installed_automatic_qualification_passed');`;
  assert.equal(command(process.execPath, ['--input-type=module', '-e', probe],
    installation.directory, artifact.userconfig).trim(), 'installed_automatic_qualification_passed');
});

test('installed v2 core and adapter compile source selections without model offsets or coverage', () => {
  const probe = `import assert from 'node:assert/strict';
    import { DatabaseSync } from 'node:sqlite';
    import { openMemoryCore } from './node_modules/${packageName}/core/contract.mjs';
    import { createOpenAIModel } from './node_modules/${packageName}/adapters/openai/index.mjs';
    const namespace={ownerId:'synthetic-installed-v2',scope:'personal',projectId:null};
    const source='I prefer calm captions 🌙.';
    const methods=[]; let sends=0;
    const model=createOpenAIModel({apiKey:'synthetic',fetchImpl:async(url,options)=>{
      sends++; const payload=JSON.parse(options.body);
      if(url.endsWith('/input_tokens'))return Response.json({object:'response.input_tokens',input_tokens:120});
      const method=payload.text.format.name;methods.push(method);
      const input=JSON.parse(payload.input[0].content[0].text);let output;
      if(method==='cairn_extract')output={items:[{content:source,kind:'preference',confidence:0.9,sourceIndices:[0]}]};
      else if(method==='cairn_qualifyCandidates'){
        assert.deepEqual(Object.keys(input),['items']);
        output={wireVersion:'evidence-pool-v1',qualifications:Object.fromEntries(input.items.map(item=>{
          assert.deepEqual(Object.keys(item).sort(),['candidates','content','itemIndex','kind']);
          assert.deepEqual(Object.keys(item.candidates[0]).sort(),['candidateIndex','role','text']);
          assert.equal(item.candidates[0].text,source);
          const known=value=>({value,evidenceSlots:[0]});
          const unknown=()=>({value:null,evidenceSlots:[]});
          return['item_'+item.itemIndex,{itemIndex:item.itemIndex,pool:[item.candidates[0].candidateIndex],
            subject:known('user'),property:known('caption tone'),scope:unknown(),applies:unknown(),
            value:known('calm'),attribution:known('direct'),commitment:known('adopted')}];
        }))};
      }else{assert.equal(method,'cairn_classify');output={items:input.memories.map(m=>({memoryId:m.id,parentIds:[]}))};}
      return Response.json({object:'response',model:payload.model,status:'completed',error:null,incomplete_details:null,
        output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(output)}]}],
        usage:{input_tokens:120,output_tokens:100,total_tokens:220}});
    }});
    const ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
    const path='./qualification-v2.sqlite';
    const request={namespace,client:'synthetic',sessionId:'s',eventId:'v2-event',
      messages:[{id:'v2-message',role:'user',content:source}],causal:{streamId:'v2-stream',sequence:1}};
    let core=openMemoryCore({path,model,captureQualification:'source-bound-v2'});
    const result=ok(await core.capture(request));
    assert.deepEqual(result.reconciliation,{status:'unresolved',reason:'qualification_requires_identity',retiredCount:0});
    const memoryId=result.admission.memories[0].id;
    const before=ok(core.get({namespace,memoryId,includeQualification:true}));
    assert.equal(before.qualification.version,1);assert.equal(before.qualification.value,'calm');
    assert.deepEqual(before.qualification.anchors[0].fields,['subject','property','value','attribution','commitment']);
    assert.equal(before.qualification.anchors[0].text,source);
    assert.equal(before.qualification.anchors[0].start,0);assert.equal(before.qualification.anchors[0].end,source.length);
    assert.deepEqual(methods,['cairn_extract','cairn_qualifyCandidates','cairn_classify']);assert.equal(sends,6);
    core.close();core=openMemoryCore({path,model,captureQualification:'source-bound-v2'});
    assert.deepEqual(ok(core.get({namespace,memoryId,includeQualification:true})),before);
    assert.equal(ok(await core.capture(request)).duplicate,true);assert.equal(sends,6);core.close();
    core=openMemoryCore({path,model,captureQualification:'source-bound-v1'});
    assert.equal((await core.capture(request)).error.code,'event_payload_conflict');assert.equal(sends,6);core.close();
    const db=new DatabaseSync(path);
    assert.equal(db.prepare('SELECT count(*) AS n FROM qualified_claim_bindings').get().n,0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM qualified_slots').get().n,0);db.close();
    console.log('installed_candidate_qualification_passed');`;
  assert.equal(command(process.execPath, ['--input-type=module', '-e', probe],
    installation.directory, artifact.userconfig).trim(), 'installed_candidate_qualification_passed');
});

test('installed shared core preserves opt-in qualification across restart and clears it on correction and forget', () => {
  const probe = `import assert from 'node:assert/strict';
    import { openMemoryCore } from './node_modules/${packageName}/core/contract.mjs';
    const namespace={ownerId:'synthetic-installed-qualification',scope:'personal',projectId:null};
    const content='I choose the violet tram 🚋.';
    const receipt={client:'synthetic',sessionId:'session',eventId:'source',role:'user',excerpt:content};
    const qualification={version:1,slot:{subject:'I',property:'transport',scope:null,applies:null},value:'violet tram',attribution:'direct',commitment:'adopted',
      anchors:[{receiptIndex:0,start:0,end:content.length,text:content,fields:['subject','property','value','attribution','commitment']}]};
    const ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
    const path='./qualification.sqlite'; let core=openMemoryCore({path});
    const admitted=ok(core.admit({namespace,memory:{content,kind:'fact'},receipts:[receipt],qualification}));
    const read=()=>ok(core.get({namespace,memoryId:admitted.memory.id,includeQualification:true}));
    const before=read(); assert.equal(before.qualification.anchors[0].text,content);
    assert.equal(Object.hasOwn(ok(core.get({namespace,memoryId:admitted.memory.id})),'qualification'),false);
    core.close(); core=openMemoryCore({path}); assert.deepEqual(read(),before);
    const corrected=ok(core.correct({namespace,memoryId:admitted.memory.id,expectedRevision:admitted.memory.revision,content,kind:'fact',receipt:{...receipt,eventId:'correction'}}));
    assert.equal(read().qualification,null);
    ok(core.forget({namespace,memoryId:admitted.memory.id,expectedRevision:corrected.memory.revision}));
    core.close(); core=openMemoryCore({path});
    const result=core.get({namespace,memoryId:admitted.memory.id,includeQualification:true});
    assert.deepEqual(result,{ok:false,error:{code:'memory_not_found',retryable:false}});
    core.close(); console.log('installed_qualification_lifecycle_passed');`;
  assert.equal(command(process.execPath, ['--input-type=module', '-e', probe],
    installation.directory, artifact.userconfig).trim(), 'installed_qualification_lifecycle_passed');
});

test('installed core enforces trusted qualified transitions and retains history across cold reopen', () => {
  const probe = `import assert from 'node:assert/strict';
    import {openMemoryCore} from './node_modules/${packageName}/core/contract.mjs';
    const namespace={ownerId:'synthetic-installed-transition',scope:'personal',projectId:null};
    const path='./qualified-transition.sqlite'; let core=openMemoryCore({path});
    const ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
    const admit=(content,value)=>ok(core.admit({namespace,memory:{content,kind:'preference'},
      receipts:[{client:'synthetic',sessionId:'session',eventId:content,role:'user',excerpt:content}],
      qualification:{version:1,slot:{subject:'I',property:'transport',scope:'commute',applies:'recurring'},
        value,attribution:'direct',commitment:'adopted',anchors:[{receiptIndex:0,start:0,end:content.length,text:content,
          fields:['subject','property','scope','applies','value','attribution','commitment']}]}})).memory;
    const previous=admit('I choose the violet tram for my recurring commute.','violet tram');
    const reaffirmed=admit('I still choose the violet tram for my recurring commute.','violet tram');
    const bind=(memory,slotId)=>ok(core.bindQualifiedClaim({namespace,memoryId:memory.id,
      expectedRevision:memory.revision,slotId,singleClaim:true})).slotId;
    const slotId=bind(previous,null); bind(reaffirmed,slotId);
    const transition=memory=>core.transitionQualified({namespace,
      predecessor:{memoryId:previous.id,expectedRevision:previous.revision},
      replacement:{memoryId:memory.id,expectedRevision:memory.revision}});
    assert.equal(ok(transition(reaffirmed)).reason,'same_value');
    ok(core.forget({namespace,memoryId:reaffirmed.id,expectedRevision:reaffirmed.revision}));
    assert.equal(core.get({namespace,memoryId:reaffirmed.id}).error.code,'memory_not_found');
    const replacement=admit('I now choose the blue bus for my recurring commute.','blue bus');
    // The surviving predecessor preserves the slot after the other binding is
    // forgotten; binding this new member exercises that lifecycle as well.
    bind(replacement,slotId);
    assert.equal(ok(transition(replacement)).status,'applied');
    const read=()=>ok(core.get({namespace,memoryId:previous.id,includeQualification:true}));
    const before=read(); assert.equal(before.memory.state,'historical');
    assert.equal(before.qualification.value,'violet tram');
    core.close(); core=openMemoryCore({path}); assert.deepEqual(read(),before);
    assert.equal(ok(core.get({namespace,memoryId:replacement.id})).memory.state,'active');
    core.close(); console.log('installed_qualified_transition_passed');`;
  assert.equal(command(process.execPath, ['--input-type=module', '-e', probe],
    installation.directory, artifact.userconfig).trim(), 'installed_qualified_transition_passed');
});

test('installed core atomically resolves a complete qualified set without dropping reaffirmations', () => {
  const probe = `import assert from 'node:assert/strict';
    import {openMemoryCore} from './node_modules/${packageName}/core/contract.mjs';
    const namespace={ownerId:'synthetic-installed-transition-set',scope:'personal',projectId:null};
    const path='./qualified-transition-set.sqlite'; let core=openMemoryCore({path});
    const ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
    const admit=(content,value)=>ok(core.admit({namespace,memory:{content,kind:'preference'},
      receipts:[{client:'synthetic',sessionId:'session',eventId:content,role:'user',excerpt:content}],
      qualification:{version:1,slot:{subject:'I',property:'transport',scope:'commute',applies:'recurring'},
        value,attribution:'direct',commitment:'adopted',anchors:[{receiptIndex:0,start:0,end:content.length,text:content,
          fields:['subject','property','scope','applies','value','attribution','commitment']}]}})).memory;
    const previous=admit('I choose the violet tram for my recurring commute.','violet tram');
    const reaffirmed=admit('I still choose the violet tram for my recurring commute.','violet tram');
    const replacement=admit('I now choose the blue bus for my recurring commute.','blue bus');
    const bind=(memory,slotId)=>ok(core.bindQualifiedClaim({namespace,memoryId:memory.id,
      expectedRevision:memory.revision,slotId,singleClaim:true})).slotId;
    const slotId=bind(previous,null); bind(reaffirmed,slotId); bind(replacement,slotId);
    const ref=memory=>({memoryId:memory.id,expectedRevision:memory.revision});
    const read=memory=>ok(core.get({namespace,memoryId:memory.id,includeQualification:true}));
    const before=[previous,reaffirmed,replacement].map(read);
    const omitted=ok(core.transitionQualifiedSet({namespace,predecessors:[ref(previous)],replacement:ref(replacement)}));
    assert.equal(omitted.status,'unresolved'); assert.equal(omitted.reason,'additional_current_claims');
    assert.equal(omitted.retiredCount,0); assert.deepEqual([previous,reaffirmed,replacement].map(read),before);
    const applied=ok(core.transitionQualifiedSet({namespace,predecessors:[ref(reaffirmed),ref(previous)],replacement:ref(replacement)}));
    assert.equal(applied.status,'applied'); assert.equal(applied.retiredCount,2);
    assert.deepEqual(applied.previous.map(memory=>memory.id),[previous.id,reaffirmed.id].sort());
    const history=[previous,reaffirmed].map(read);
    for (const memory of history) { assert.equal(memory.memory.state,'historical');
      assert.equal(memory.qualification.value,'violet tram');
      assert.equal(memory.supersession.replacement.memoryId,replacement.id);
      assert.equal(memory.supersession.evidenceAvailable,true); }
    assert.equal(read(replacement).memory.state,'active');
    core.close(); core=openMemoryCore({path});
    assert.deepEqual([previous,reaffirmed].map(read),history);
    assert.equal(read(replacement).memory.state,'active');
    core.close(); console.log('installed_qualified_transition_set_passed');`;
  assert.equal(command(process.execPath, ['--input-type=module', '-e', probe],
    installation.directory, artifact.userconfig).trim(), 'installed_qualified_transition_set_passed');
});

test('installed core rejects malformed Unicode namespace identities', () => {
  const probe = `import assert from 'node:assert/strict';
    import {openMemoryCore} from './node_modules/${packageName}/core/contract.mjs';
    const core=openMemoryCore({path:':memory:'});
    for (const code of [0xd800,0xdc00]) {
      const bad=String.fromCharCode(code);
      for (const namespace of [{ownerId:'synthetic-'+bad,scope:'personal',projectId:null},
        {ownerId:'synthetic',scope:'project',projectId:'project-'+bad}]) {
        const result=core.admit({namespace,memory:{content:'Synthetic marker',kind:'fact'},
          receipts:[{client:'synthetic',sessionId:'session',eventId:'event',role:'user',excerpt:'Synthetic marker'}]});
        assert.deepEqual(result,{ok:false,error:{code:'invalid_input',retryable:false}});
      }
    }
    core.close(); console.log('installed_identifier_boundary_passed');`;
  assert.equal(command(process.execPath, ['--input-type=module', '-e', probe],
    installation.directory, artifact.userconfig).trim(), 'installed_identifier_boundary_passed');
});

test('archive inspection and installed hashes prove the explicit single-source runtime allowlist', (t) => {
  assert.equal(hash(artifact.artifactPath), artifact.sha256);
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
  assert.ok(artifact.bytes > 0);
  for (const path of artifact.files) {
    assert.equal(/(?:^|\/)(?:node_modules|test|testing|reports|\.env|\.npmrc)(?:\/|$)/.test(path), false, path);
    assert.equal(/\.(?:sqlite|db|tgz)$/.test(path), false, path);
  }
  for (const path of runtimeFiles) assert.ok(artifact.files.includes(path), path);
  assert.ok(artifact.files.includes('adapters/openai/qualification-evidence-pool.mjs'));
  assert.equal(artifact.files.includes('adapters/openai/test/qualification-pool-wire.mjs'), false);
  assert.equal(artifact.sourceHashes['adapters/openai/qualification-evidence-pool.mjs'],
    hash(new URL('../../adapters/openai/qualification-evidence-pool.mjs', import.meta.url)));
  assert.ok(artifact.files.includes('core/query-candidates.mjs'),
    'installed recall must include the new shared candidate scorer');
  for (const [path, expected] of Object.entries(artifact.sourceHashes)) {
    assert.equal(hash(join(installation.packagePath, path)), expected, path);
  }
  const manifest = readJSON(join(installation.packagePath, 'package.json'));
  assert.equal(manifest.private, true);
  assert.equal(manifest.version, artifact.version);
  assert.equal(manifest.engines.node, '>=22.16.0');
  assert.equal(manifest.scripts, undefined);
  assert.deepEqual(manifest.bin, { 'cairn-memory': 'bin/cairn-memory.mjs' });
  assert.ok(statSync(installation.executable).mode & 0o111);
  t.diagnostic(JSON.stringify({ artifactPath: artifact.artifactPath, sha256: artifact.sha256,
    installationPath: installation.directory, executable: installation.executable, runtime: process.version }));
});

test('production shrinkwrap installs only the exact reviewed closure with upstream notices', () => {
  const shrinkwrap = readJSON(join(installation.packagePath, 'npm-shrinkwrap.json'));
  const expected = { '@modelcontextprotocol/server': '2.0.0', '@modelcontextprotocol/core': '2.0.0',
    zod: '4.5.4', tiktoken: '1.0.22' };
  assert.deepEqual(Object.keys(shrinkwrap.packages).filter(Boolean).sort(),
    Object.keys(expected).map((name) => `node_modules/${name}`).sort());
  const resolveInstalled = createRequire(join(installation.packagePath, 'package.json'));
  for (const [name, version] of Object.entries(expected)) {
    const lock = shrinkwrap.packages[`node_modules/${name}`];
    assert.equal(lock.version, version);
    assert.match(lock.integrity, /^sha512-/);
    assert.equal(lock.hasInstallScript, undefined);
    let path = dirname(resolveInstalled.resolve(name));
    let manifest;
    for (let remaining = 8; remaining > 0; remaining--) {
      if (existsSync(join(path, 'package.json'))) {
        const candidate = readJSON(join(path, 'package.json'));
        if (candidate.name === name) { manifest = candidate; break; }
      }
      path = dirname(path);
    }
    assert.equal(manifest?.version, version, name);
    if (name === 'tiktoken') {
      const notice = readFileSync(join(installation.packagePath, 'licenses/tiktoken-LICENSE'), 'utf8');
      assert.match(notice, /MIT License/);
      assert.match(notice, /Copyright \(c\) 2022 OpenAI, Shantanu Jain/);
      assert.match(notice, /The above copyright notice and this permission notice shall be included/);
    } else assert.ok(readdirSync(path).some((file) => /^licen[sc]e(?:\.|$)/i.test(file)), name);
    for (const lifecycle of ['preinstall', 'install', 'postinstall']) assert.equal(manifest.scripts?.[lifecycle], undefined);
  }
});

test('installed executable provides help and non-mutating configuration diagnostics', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-installed-check-'));
  const path = join(directory, 'memory.sqlite');
  const help = command(process.execPath, [installation.executable, '--help'],
    installation.directory, artifact.userconfig);
  assert.match(help, /--check-config/);
  const report = JSON.parse(command(process.execPath, [installation.executable,
    '--check-config', '--db', path, '--owner', 'synthetic-owner'],
  installation.directory, artifact.userconfig));
  assert.equal(report.ok, true);
  assert.equal(report.modelKeyPresent, false);
  assert.equal(report.recall, 'model_not_configured');
  assert.equal(report.databaseOpened, false);
  assert.deepEqual(readdirSync(directory), []);
});

test('installed adapter resolves its relative runtime modules without source-checkout imports', () => {
  const probe = `import { createOpenAIModel } from './node_modules/${packageName}/adapters/openai/index.mjs';
    const noNetwork = () => { throw new Error('unexpected_network'); };
    const baseline = createOpenAIModel({ apiKey: 'synthetic-import-only', fetchImpl: noNetwork });
    const candidate = createOpenAIModel({ apiKey: 'synthetic-import-only', fetchImpl: noNetwork,
      extractionModel: 'gpt-5.4-mini-2026-03-17' });
    if (baseline.contextWindow !== 1047576 || candidate.contextWindow !== 400000) throw new Error('wrong_profile');
    console.log('installed_adapter_import_passed');`;
  assert.equal(command(process.execPath, ['--input-type=module', '-e', probe],
    installation.directory, artifact.userconfig).trim(), 'installed_adapter_import_passed');
});

test('installed adapter resolves the diagnostic helper and emits only the finite event', () => {
  const probe = `import assert from 'node:assert/strict';
    import { createOpenAIModel } from './node_modules/${packageName}/adapters/openai/index.mjs';
    const events = [];
    const model = createOpenAIModel({ apiKey: 'synthetic-import-only',
      fetchImpl() { throw new Error('unexpected_network'); },
      onDiagnostic(event) { events.push(event); } });
    await assert.rejects(model.select({ system: 'synthetic', input: {},
      maxOutputTokens: 1, signal: new AbortController().signal }),
      { message: 'invalid_openai_request' });
    assert.deepEqual(events, [{ version: 1, stage: 'select', layer: 'adapter', reason: 'request_invalid' }]);
    assert.equal(Object.isFrozen(events[0]), true);
    console.log('installed_diagnostic_passed');`;
  assert.equal(command(process.execPath, ['--input-type=module', '-e', probe],
    installation.directory, artifact.userconfig).trim(), 'installed_diagnostic_passed');
});

test('installed executable completes actual SDK stdio lifecycle, restart and scoped revision rejection', { timeout: 30000 }, async (t) => {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-installed-data-')), 'memory.sqlite');
  const first = await connect(t, installation, path, { project: 'harbor' });
  assert.deepEqual((await first.listTools()).tools.map((tool) => tool.name).sort(),
    ['correct_memory', 'forget_memory', 'inspect_memory', 'recall_memory', 'remember_memory']);
  const content = 'Synthetic Harbor review happens Tuesday.';
  const saved = ok(await call(first, 'remember_memory', { content })).memory;
  assert.equal(ok(await call(first, 'inspect_memory', { memoryId: saved.id })).receipts[0].excerpt, content);
  assert.equal((await call(first, 'recall_memory', { query: 'When is the review?' })).error.code, 'model_not_configured');
  await first.close();
  const reopened = await connect(t, installation, path, { project: 'harbor' });
  assert.equal(ok(await call(reopened, 'inspect_memory', { memoryId: saved.id })).memory.content, content);
  const foreign = await connect(t, installation, path, { owner: 'synthetic-other-owner', project: 'harbor' });
  assert.deepEqual(ok(await call(foreign, 'inspect_memory')).memories, []);
  assert.equal((await call(foreign, 'correct_memory', {
    memoryId: saved.id, expectedRevision: saved.revision, content: 'Foreign replacement',
  })).error.code, 'memory_not_found');
  assert.equal(ok(await call(foreign, 'forget_memory', {
    memoryId: saved.id, expectedRevision: saved.revision,
  })).forgotten, false);
  await foreign.close();
  for (const extra of [{ namespace: {} }, { ownerId: 'foreign' }, { path: '/not-opened.sqlite' }, { readSet: [] }]) {
    const response = await reopened.callTool({ name: 'remember_memory', arguments: { content: 'Rejected', ...extra } });
    assert.equal(response.isError, true);
  }
  const changed = ok(await call(reopened, 'correct_memory', { memoryId: saved.id,
    expectedRevision: saved.revision, content: 'Synthetic Harbor review happens Friday.' })).memory;
  assert.ok(changed.revision > saved.revision);
  assert.equal((await call(reopened, 'forget_memory', {
    memoryId: saved.id, expectedRevision: saved.revision,
  })).error.code, 'revision_conflict');
  ok(await call(reopened, 'forget_memory', { memoryId: saved.id, expectedRevision: changed.revision }));
  assert.equal((await call(reopened, 'inspect_memory', { memoryId: saved.id })).error.code, 'memory_not_found');
  assert.deepEqual(ok(await call(reopened, 'inspect_memory')).memories, []);
});

test('same-schema version upgrade and local uninstall preserve the separately selected memory database', { timeout: 30000 }, async (t) => {
  const upgraded = install(artifact);
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-upgrade-data-')), 'memory.sqlite');
  const first = await connect(t, upgraded, path);
  const content = 'Synthetic upgrade persistence marker.';
  const saved = ok(await call(first, 'remember_memory', { content })).memory;
  await first.close();
  const next = buildArtifact({ version: '0.0.0-preview.2' });
  install(next, upgraded.directory);
  assert.equal(readJSON(join(upgraded.packagePath, 'package.json')).version, '0.0.0-preview.2');
  const second = await connect(t, upgraded, path);
  const persisted = ok(await call(second, 'inspect_memory', { memoryId: saved.id })).memory;
  assert.equal(persisted.content, content);
  assert.equal(persisted.revision, saved.revision);
  await second.close();
  const beforeUninstall = hash(path);
  command('npm', ['uninstall', '--prefix', upgraded.directory, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', packageName],
    upgraded.directory, artifact.userconfig);
  assert.equal(existsSync(upgraded.packagePath), false);
  assert.equal(hash(path), beforeUninstall);
  // Restore only this synthetic test install to verify retained data is reusable.
  install(next, upgraded.directory);
  const third = await connect(t, upgraded, path);
  assert.equal(ok(await call(third, 'inspect_memory', { memoryId: saved.id })).memory.content, content);
});

test('preview builder rejects release-like or path-shaped versions', () => {
  for (const version of ['1.0.0', '../elsewhere', '0.0.0-preview.0']) {
    assert.throws(() => buildArtifact({ version }), /invalid_preview_version/);
  }
});

test('an ancestor npm project is never modified by a fresh explicitly scoped child install', () => {
  const ancestor = mkdtempSync(join(tmpdir(), 'cairn-ancestor-regression-'));
  const manifestPath = join(ancestor, 'package.json');
  writeFileSync(manifestPath, JSON.stringify({ name: 'synthetic-ancestor-do-not-modify',
    version: '0.0.0', private: true, dependencies: {} }));
  const before = hash(manifestPath);
  const child = join(ancestor, 'child');
  mkdirSync(child);
  const installed = install(artifact, child);
  assert.equal(hash(manifestPath), before);
  assert.equal(existsSync(join(ancestor, 'package-lock.json')), false);
  assert.equal(existsSync(join(ancestor, 'node_modules')), false);
  assert.equal(readJSON(join(child, 'package.json')).name, 'synthetic-local-install');
  assert.ok(existsSync(installed.executable));
  assert.equal(hash(join(installed.packagePath, 'core/contract.mjs')), artifact.sourceHashes['core/contract.mjs']);
});
