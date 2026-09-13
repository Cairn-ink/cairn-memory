import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { before } from 'node:test';
import { buildArtifact, command, packageName, runtimeFiles } from '../build.mjs';

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
