import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, copyFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { SERDE_MARKERS } from '../schema-evidence.mjs';
import { fingerprint, KNOWN_FORMATS, binaryIdentity, qualifyBinary, cachedQualification, finishQualification } from '../qualification.mjs';
import { currentHost } from '../installed.mjs';
import { parseLine, verifyHeader, FORMAT } from '../parser.mjs';
import { formatFixture } from './format-fixtures.mjs';

const fixtures = new URL('./fixtures/', import.meta.url);
const json = async name => JSON.parse(await readFile(new URL(name, fixtures)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const versions = ['0.163.0', '0.164.0', '0.165.0', '0.166.0'];
const oldMarkers = (await json('binary-0.162.0/format.json')).serdeMarkers;
const oldFormats = ['a64741d8899f84513232c3145595ed279325abfdf190b7705b94dcb81b14ab1a',
  '66fc10979c1594fdb2ba648983d36f10f2c4c1b33c01afe853ba92925b707b87'];
const oldPolicy = sha(JSON.stringify(oldFormats));
const qa = name => [{ role: 'user', content: 'Synthetic question ' + name + '.' }, { role: 'assistant', content: 'Synthetic answer ' + name + '.' }];
const expected = { final: qa('final'), 'two-turns': [...qa('two-turns'), ...qa('two-turns')],
  'partial-final': [{ role: 'user', content: 'Synthetic question partial-final.' }, { role: 'assistant', content: 'First stable section.' },
    { role: 'assistant', content: 'Second terminal section.' }], resume: [...qa('resume'), ...qa('resume')],
  interrupted: [{ role: 'user', content: 'Synthetic question interrupted.' }], tool: qa('tool'), 'hooks-recall': qa('hooks-recall'),
  'compaction-before': [...qa('compaction-before'), ...qa('compaction-after')] };
function differences(a, b, path = '') {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length ? a.flatMap((v, i) => differences(v, b[i], path + '/' + i)) : [path];
  if (a && b && typeof a === 'object' && typeof b === 'object') return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap(key => {
    const pointer = path + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1');
    return !Object.hasOwn(a, key) || !Object.hasOwn(b, key) ? [pointer] : differences(a[key], b[key], pointer);
  });
  return Object.is(a, b) ? [] : [path];
}
const imageChanges = ['/ThreadItem/oneOf/15/anyOf', '/ThreadItem/oneOf/15/description',
  '/ThreadItem/oneOf/15/properties/inputImages', '/ThreadItem/oneOf/15/properties/result', '/ThreadItem/oneOf/15/required'];
const allowed = version => version === '0.163.0' ? [] : ['/HookEventName/enum', '/ImageGenerationInputImage', ...imageChanges,
  ...(version === '0.166.0' ? ['/HookMetadata/properties/environmentId', '/HooksListParams/properties/cwds/description',
    '/HooksListParams/properties/threadId', '/ThreadItem/description', '/ThreadItem/oneOf/15/properties/generationId',
    '/ThreadItem/properties', '/ThreadItem/type'] : [])].sort();

test('Q01/Q02 historical hash inputs refresh only markers; every old excerpt supports all five', async () => {
  assert.deepEqual(SERDE_MARKERS, ['internally tagged enum AgentMessageContent', 'struct variant AgentMessageContent::Text with 1 element',
    'internally tagged enum RolloutItemWire', 'hook_started', 'hook_completed']);
  for (const version of ['0.160.1', '0.161.0', '0.162.0']) {
    const original = await json(`binary-${version}/format.json`), refreshed = await formatFixture(version);
    assert.deepEqual(differences(original, refreshed), ['/serdeMarkers']);
    assert.ok(KNOWN_FORMATS.includes(fingerprint(refreshed)));
    const excerpts = Object.values(await json(`binary-${version}/serde-markers.json`)).map(row => row.excerpt).join('\n');
    for (const marker of SERDE_MARKERS) assert.ok(excerpts.includes(marker), version + ' ' + marker);
  }
  assert.equal(fingerprint(await formatFixture('0.162.0')), fingerprint(await formatFixture('0.163.0')));
});

test('all committed rollout Git headers contain only synthetic metadata', async () => {
  let headers = 0;
  for (const name of (await readdir(fixtures)).filter(name => name.endsWith('.jsonl'))) {
    for (const line of (await readFile(new URL(name, fixtures), 'utf8')).trim().split('\n')) {
      const row = JSON.parse(line);
      if (row.type !== 'session_meta' || !Object.hasOwn(row.payload, 'git')) continue;
      assert.deepEqual(row.payload.git, { commit_hash: '0'.repeat(40), branch: 'synthetic-branch',
        repository_url: 'https://example.invalid/synthetic.git' }, name);
      headers++;
    }
  }
  assert.equal(headers, 32);
});

for (const version of versions) test(`Q01–Q04 ${version}: strict markers, exact schema changes, native cases and provenance`, async () => {
  const manifest = await json(`native-evidence-${version}.json`), evidence = await formatFixture(version);
  assert.ok(KNOWN_FORMATS.includes(fingerprint(evidence)));
  assert.deepEqual(evidence.serdeMarkers, [...SERDE_MARKERS].sort());
  const presence = await json(`binary-${version}/marker-presence.json`);
  const strict = markers => { for (const marker of markers) if (presence[marker]?.offset < 0) throw new Error('serde_marker_missing'); };
  strict(SERDE_MARKERS);
  for (const marker of SERDE_MARKERS) { assert.ok(presence[marker].offset >= 0); assert.equal(presence[marker].excerpt, marker); }
  if (version !== '0.163.0') {
    assert.throws(() => strict(oldMarkers), /serde_marker_missing/);
    // This is a lenient historical hash input, including absent markers, NEVER
    // a claim that the historical strict collector succeeded.
    assert.ok(!oldFormats.includes(fingerprint({ ...evidence, serdeMarkers: oldMarkers })));
  }
  const previous = await formatFixture('0.162.0');
  assert.deepEqual(evidence.hooks, previous.hooks); // complete objects and definitions
  assert.deepEqual(differences(previous.appServer, evidence.appServer), allowed(version));
  const refs = new Set();
  const visit = value => { if (!value || typeof value !== 'object') return;
    if (value.$ref) refs.add(value.$ref); for (const child of Object.values(value)) visit(child); };
  visit(evidence.appServer);
  for (const ref of refs) assert.ok(evidence.appServer[ref.replace('#/definitions/v2/', '')], ref);
  assert.deepEqual(manifest.isolation, { networkNamespace: 'fresh', interfaces: ['lo'], loopbackUp: true, externalRoutes: 0 });
  assert.equal(manifest.modelCalls, 0); assert.equal(manifest.mockRequests, 13); assert.deepEqual(manifest.unexpected, []);
  assert.equal(manifest.failure, undefined); assert.ok(manifest.exits.every(row => row.code === 0 && row.signal === null));
  for (const [script, digest] of [['probe-codex-rollout.mjs', manifest.scriptSha256], ['codex-probe-isolation.mjs', manifest.isolationScriptSha256],
    ['probe-codex-seeded-readback.mjs', manifest.seededReadback.scriptSha256], ['freeze-codex-rollout.mjs', manifest.normalization.scriptSha256]])
    assert.equal(sha(await readFile(new URL('../../../scripts/' + script, import.meta.url))), digest, script);
  for (const file of manifest.files) {
    const bytes = await readFile(new URL(file.path, fixtures)); assert.equal(sha(bytes), file.sha256); assert.equal(bytes.length, file.bytes);
    assert.ok(!/\/home\/|\/tmp\/claude|(?:^|["\s])\/(?:tmp|usr|bin|etc)\//mu.test(bytes.toString()), file.path);
  }
  // Independent disk inventory; the manifest cannot silently omit a fixture.
  const disk = (await readdir(fixtures)).filter(name => name.includes(version) && /^(native-|seeded-)/u.test(name));
  const binary = (await readdir(new URL(`binary-${version}/`, fixtures))).map(name => `binary-${version}/${name}`);
  assert.deepEqual([...disk, ...binary].sort(), [...manifest.files.map(file => file.path), `native-evidence-${version}.json`].sort());
  assert.equal(disk.length + binary.length, 14);
  const inventory = { topLevel: new Set(), eventMsg: new Set(), item: new Set(), content: new Set() };
  assert.deepEqual(manifest.cases.map(row => row.name).sort(), Object.keys(expected).sort());
  for (const entry of manifest.cases) {
    const lines = (await readFile(new URL(entry.path, fixtures), 'utf8')).trim().split('\n');
    const sessionId = JSON.parse(lines[0]).payload.id;
    assert.equal(verifyHeader(Buffer.from(lines[0]), sessionId), FORMAT); let start = 0;
    const messages = lines.flatMap(line => {
      const row = JSON.parse(line); inventory.topLevel.add(row.type);
      if (row.type === 'event_msg') inventory.eventMsg.add(row.payload.type);
      const item = row.type === 'event_msg' ? row.payload.item : row.type === 'response_item' ? row.payload : undefined;
      if (item?.type) inventory.item.add(item.type);
      if (Array.isArray(item?.content)) for (const part of item.content) if (part.type) inventory.content.add(part.type);
      const end = start + Buffer.byteLength(line) + 1, result = parseLine(Buffer.from(line), { sessionId, wireSessionId: 'a'.repeat(64), epoch: 0, start, end }); start = end;
      return result.message ? [{ role: result.message.role, content: result.message.content }] : [];
    });
    assert.deepEqual(messages, expected[entry.name]); assert.deepEqual(messages, entry.messages);
    assert.equal(entry.unsupportedFormat, 0);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(inventory).map(([key, values]) => [key, [...values].sort()])), manifest.inventory);
  assert.deepEqual(manifest.bestEffort.map(row => [row.case, row.produced]), [['h', true], ['f2', false]]);
  assert.ok(manifest.absent.includes('security_risk_score')); assert.ok(manifest.absent.includes('dynamic_tools_updated'));
  const hooks = await json(`native-hooks-${version}.json`);
  assert.ok(hooks.untrusted.data.flatMap(entry => entry.hooks).every(hook => hook.trustStatus === 'untrusted'));
  assert.equal(hooks.trusted.data.flatMap(entry => entry.hooks).length, 4);
  assert.ok(hooks.trusted.data.flatMap(entry => entry.hooks).every(hook => hook.trustStatus === 'trusted'));
  assert.equal(manifest.hookLifecycle.started, 10); assert.equal(manifest.hookLifecycle.completed, 10);
  assert.deepEqual(manifest.hookLifecycle.absentRolloutEvents, ['hook_started', 'hook_completed']);
  assert.equal(hooks.notifications.filter(row => row.method === 'hook/started').length, 10);
  assert.equal(hooks.notifications.filter(row => row.method === 'hook/completed').length, 10);
  assert.equal(hooks.placement.placements.length, 1); assert.equal(hooks.placement.placements[0].role, 'developer');
  // The native mock request has submitted user input at index 3, then the
  // hook context at index 4. A moved context requires placement/A7 review.
  assert.equal(hooks.placement.placements[0].inputIndex, 4);
  assert.equal(hooks.placement.placements[0].requestIndex, 0);
  assert.match(JSON.stringify(hooks.placement.placements[0].item), /SYNTHETIC_CONTEXT_CANARY/);
  const seeded = await json(`seeded-readback-${version}.json`);
  assert.deepEqual(seeded.exits.map(row => row.code), [0, 0]); assert.equal(seeded.modelCalls, 0); assert.equal(seeded.mockRequests, 0);
  assert.ok(!seeded.methods.includes('turn/start'));
  for (const [name, phases] of [['partial-final', ['partial_answer', 'final_answer']], ['interrupted', ['partial_answer']], ['unknown', []]])
    assert.deepEqual(seeded.cases.find(row => row.name === name).items.data.filter(row => row.item.type === 'agentMessage').map(row => row.item.phase), phases);
});

test('Q04/Q05 accepted dynamic tool definitions stay nonconversation; unknown creators still need proof', () => {
  const header = version => Buffer.from(JSON.stringify({ type: 'session_meta', payload: { cli_version: version, history_mode: 'paginated', id: 's', source: 'cli' } }));
  for (const version of versions) assert.equal(verifyHeader(header(version), 's'), FORMAT);
  assert.throws(() => verifyHeader(header('0.167.0'), 's'), /creator_unqualified/);
  assert.equal(verifyHeader(header('0.167.0'), 's', { qualifiedCreatorVersion: '0.167.0' }), FORMAT);
  const context = { sessionId: 's', wireSessionId: 'a'.repeat(64), epoch: 0, start: 0, end: 1 };
  assert.equal(parseLine(Buffer.from(JSON.stringify({ type: 'dynamic_tools_updated', payload: { tools: [{ description: 'Synthetic tool definitions.' }] } })), context).reason, 'non_conversation');
  for (const type of ['hook_started', 'hook_completed', 'context_compacted'])
    assert.equal(parseLine(Buffer.from(JSON.stringify({ type: 'event_msg', payload: { type } })), context).reason, 'non_conversation');
  assert.throws(() => parseLine(Buffer.from(JSON.stringify({ type: 'event_msg', payload: { type: 'unknown_event' } })), context), /unsupported_format/);
});

test('Q03/Q06 complete fingerprint refuses mutations; both old verdict kinds become pending and schedule once', async t => {
  const ws = createTestWorkspace(t, { prefix: 'codex-requalify-' }), configPath = join(ws.path, 'installation.json'), binaryPath = join(ws.path, 'codex');
  await copyFile(process.execPath, binaryPath); await chmod(binaryPath, 0o700);
  const host = { binaryPath, identity: await binaryIdentity(binaryPath), kind: 'app-server' };
  const evidence = await formatFixture('0.166.0');
  const collect = async () => ({ version: '0.166.0', evidence, binarySha256: 'a'.repeat(64) });
  const verdict = await qualifyBinary(configPath, host, { collect }); assert.equal(verdict.status, 'qualified');
  for (const mutate of [f => { f.appServer.ThreadItem.oneOf[2].properties.text.type = 'array'; },
    f => { f.hooks['user-prompt-submit.command.input'].properties.prompt.type = 'array'; },
    f => { f.appServer.HookMetadata.properties.environmentId.description = 'Unexpected drift.'; },
    f => { f.appServer.UnlistedDefinition = { type: 'string' }; }]) {
    const changed = structuredClone(evidence); mutate(changed);
    assert.equal((await qualifyBinary(configPath, host, { cache: false, collect: async () => ({ ...await collect(), evidence: changed }) })).status, 'changed');
  }
  const path = join(ws.path, 'qualification', host.identity + '.json');
  for (const old of [{ status: 'qualified', fingerprint: oldFormats[1] }, { status: 'changed', reason: 'serde_marker_missing' }]) {
    await writeFile(path, JSON.stringify({ ...verdict, ...old, policy: oldPolicy }));
    assert.equal((await cachedQualification(configPath, host)).status, 'pending'); let launches = 0;
    const calls = await Promise.all(Array.from({ length: 8 }, () => currentHost(configPath, { detect: async () => host, launch: async () => { launches++; } })));
    assert.ok(calls.every(row => row.status === 'pending')); assert.equal(launches, 1);
    await currentHost(configPath, { detect: async () => host, launch: async () => { launches++; } }); assert.equal(launches, 1);
    assert.equal((await qualifyBinary(configPath, host, { collect })).status, 'qualified');
    assert.equal((await currentHost(configPath, { detect: async () => host, launch: async () => { launches++; } })).status, 'qualified');
    assert.equal(launches, 1); await finishQualification(configPath, host);
  }
});
