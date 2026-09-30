import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { openMemoryCore } from '../../../core/contract.mjs';
import { boundedText } from '../../../core/validation.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createCairnServer } from '../server.mjs';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const namespace = { ownerId: 'synthetic-history', scope: 'personal', projectId: null };
const defaults = ['remember_memory', 'recall_memory', 'inspect_memory', 'correct_memory', 'forget_memory'].sort();
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const error = (result, code) => { assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code); };
const update = (memory, content = 'Synthetic review is Monday.', sourceExcerpt = 'I have adopted Monday for the synthetic review.') => ({
  memoryId: memory.id, expectedRevision: memory.revision, replacement: { content, kind: 'fact' }, sourceExcerpt });
const receipt = excerpt => ({ client: 'synthetic-seed', sessionId: 'session', eventId: excerpt, role: 'user', excerpt });
const snapshot = db => db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);
const options = { timeout: 30000 };

function fixture(t) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-history-updates-' });
  return { workspace, path: join(workspace.path, 'memory.sqlite') };
}
async function stdio(workspace, path, { owner = namespace.ownerId, history = true, flags = [] } = {}) {
  const client = new Client({ name: 'synthetic-history', version: '1.0.0' });
  workspace.defer(() => client.close());
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ['--import', 'data:text/javascript,globalThis.fetch=()=>{process.exit(91)}', cli,
      '--db', path, '--owner', owner, ...(history ? ['--history-updates', 'explicit-v1'] : []), ...flags],
    env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' }, stderr: 'pipe' });
  await client.connect(transport);
  return client;
}
async function embedded(workspace, path, config = {}) {
  let modelCalls = 0;
  const deny = () => { modelCalls++; assert.fail('Local history tools must not call models'); };
  const server = createCairnServer({ path, namespace, historyUpdates: 'explicit-v1', ...config,
    model: { countTokens: deny, extract: deny, qualify: deny, classify: deny, select: deny, rank: deny, relate: deny } });
  workspace.defer(() => server.close());
  const client = new Client({ name: 'synthetic-history-embedded', version: '1.0.0' });
  workspace.defer(() => client.close());
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  await client.connect(clientSide);
  return { client, calls: () => modelCalls };
}
async function call(client, name, args = {}) {
  const response = await client.callTool({ name, arguments: args });
  assert.equal(response.content.length, 1);
  assert.equal(response.content[0].type, 'text');
  const result = JSON.parse(response.content[0].text);
  assert.equal(Boolean(response.isError), !result.ok);
  assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions');
  return result;
}
async function invalid(client, args, name = 'supersede_memory') {
  try { const result = await client.callTool({ name, arguments: args }); assert.equal(result.isError, true); }
  catch (caught) {
    if (caught instanceof assert.AssertionError) throw caught;
    assert.match(String(caught), /invalid|validation|unrecognized|required|not found/i);
  }
}
const inspect = async (client, memory) => ok(await call(client, 'inspect_memory', { memoryId: memory.id }));
const save = async (client, content) => ok(await call(client, 'remember_memory', { content })).memory;

test('IS1/IS6 history adds exactly one tool independently; absence preserves existing and episode inventories', options, async t => {
  const { workspace, path } = fixture(t);
  const profileFlags = [[], ['--capture-qualification', 'source-bound-v2'],
    ['--classification-recovery', 'guarded-v1'],
    ['--capture-qualification', 'source-bound-v2', '--classification-recovery', 'guarded-v1'],
    ['--session-episodes-access', 'episode-v1'],
    ['--capture-qualification', 'source-bound-v2', '--capture-evidence', 'staged-v1', '--session-episodes', 'episode-v1']];
  for (const flags of profileFlags) {
    let client = await stdio(workspace, path, { history: false, flags });
    const before = await client.listTools();
    assert.ok(!before.tools.some(tool => tool.name === 'supersede_memory'));
    if (flags.length === 0) {
      assert.deepEqual(before.tools.map(tool => tool.name).sort(), defaults);
      await invalid(client, update({ id: 'missing', revision: 1 }));
    }
    await client.close();
    client = await stdio(workspace, path, { flags });
    const after = await client.listTools();
    assert.equal(after.tools.length, before.tools.length + 1);
    assert.deepEqual(after.tools.filter(tool => tool.name !== 'supersede_memory'), before.tools);
    const tool = after.tools.find(tool => tool.name === 'supersede_memory');
    assert.deepEqual(tool.inputSchema.required.sort(), ['expectedRevision', 'memoryId', 'replacement', 'sourceExcerpt']);
    assert.deepEqual(tool.inputSchema.properties.replacement.required.sort(), ['content', 'kind']);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.inputSchema.properties.replacement.additionalProperties, false);
    assert.equal(tool.inputSchema.properties.sourceExcerpt.maxLength, 800);
    assert.equal(tool.annotations.openWorldHint, false);
    await client.close();
  }
});

test('IS2/IS3/IS5 real keyless stdio update retains original sources and exact successor links across restart', options, async t => {
  const { workspace, path } = fixture(t);
  let client = await stdio(workspace, path, { flags: ['--client', 'synthetic-client', '--session', 'synthetic-session'] });
  const old = await save(client, 'Synthetic review is Friday.');
  const unrelated = await save(client, 'Synthetic unrelated preference.');
  const before = await inspect(client, old);
  const input = update(old); const originalInput = structuredClone(input);
  const changed = ok(await call(client, 'supersede_memory', input));
  assert.deepEqual(input, originalInput);
  assert.notEqual(changed.memory.id, old.id);
  assert.deepEqual(changed.previous, { id: old.id, revision: old.revision + 1 });
  const history = await inspect(client, old); const successor = await inspect(client, changed.memory);
  assert.equal(history.memory.state, 'historical');
  assert.deepEqual(history.receipts, before.receipts);
  assert.equal(successor.memory.state, 'active');
  assert.equal(successor.memory.content, input.replacement.content);
  assert.equal(successor.receipts.length, 1);
  assert.equal(successor.receipts[0].excerpt, input.sourceExcerpt);
  assert.equal(successor.receipts[0].client, 'synthetic-client');
  assert.equal(successor.receipts[0].sessionId, 'synthetic-session');
  assert.notEqual(successor.receipts[0].eventId, before.receipts[0].eventId);
  assert.deepEqual(history.supersession, { previousRevision: old.revision,
    replacement: { memoryId: changed.memory.id, revision: changed.memory.revision,
      currentRevision: changed.memory.revision, state: 'active' },
    receiptIds: successor.receipts.map(source => source.id), evidenceAvailable: true });
  await client.close();
  client = await stdio(workspace, path);
  assert.deepEqual(await inspect(client, old), history);
  assert.deepEqual(await inspect(client, changed.memory), successor);
  assert.deepEqual(ok(await call(client, 'inspect_memory', { states: ['active'] })).memories.map(memory => memory.id).sort(),
    [changed.memory.id, unrelated.id].sort());
  assert.deepEqual(ok(await call(client, 'inspect_memory')).memories.map(memory => memory.id).sort(),
    [old.id, changed.memory.id, unrelated.id].sort());
  assert.deepEqual(ok(await call(client, 'inspect_memory', { states: ['historical'] })).memories.map(memory => memory.id), [old.id]);
  const repaired = ok(await call(client, 'correct_memory', { memoryId: changed.memory.id,
    expectedRevision: changed.memory.revision, content: 'Synthetic review is Monday morning.' })).memory;
  assert.equal(repaired.id, changed.memory.id);
  const repairedDetail = await inspect(client, repaired);
  assert.equal(repairedDetail.receipts.length, 1);
  assert.equal(repairedDetail.receipts[0].excerpt, repairedDetail.memory.content);
  assert.ok(!repairedDetail.receipts.some(source => history.supersession.receiptIds.includes(source.id)));
  const lost = await inspect(client, old);
  assert.equal(lost.memory.state, 'historical'); assert.deepEqual(lost.receipts, before.receipts);
  assert.equal(lost.supersession.evidenceAvailable, false); assert.deepEqual(lost.supersession.receiptIds, []);
  assert.equal(lost.supersession.replacement.revision, changed.memory.revision);
  assert.equal(lost.supersession.replacement.currentRevision, repaired.revision);
  ok(await call(client, 'forget_memory', { memoryId: repaired.id, expectedRevision: repaired.revision }));
  assert.deepEqual((await inspect(client, old)).supersession,
    { previousRevision: old.revision, replacement: null, receiptIds: [], evidenceAvailable: false });
  assert.equal((await inspect(client, unrelated)).memory.state, 'active');
  await client.close(); client = await stdio(workspace, path);
  assert.equal((await inspect(client, old)).memory.state, 'historical');
  assert.equal((await inspect(client, old)).supersession.evidenceAvailable, false);
  error(await call(client, 'inspect_memory', { memoryId: repaired.id }), 'memory_not_found');
});

test('IS2/IS2a/IS4 strict submitted evidence and atomic guards reject with zero model calls', options, async t => {
  const { workspace, path } = fixture(t);
  const host = await embedded(workspace, path);
  const db = new DatabaseSync(path); workspace.defer(() => db.close());
  const old = await save(host.client, 'Synthetic guard is Friday.');
  const suppressed = await save(host.client, 'Suppressed synthetic replacement.');
  ok(await call(host.client, 'forget_memory', { memoryId: suppressed.id, expectedRevision: suppressed.revision }));
  const base = update(old); const before = snapshot(db);
  const malformed = [{ ...base, sourceExcerpt: undefined }, { ...base, sourceExcerpt: null },
    { ...base, sourceExcerpt: '' }, { ...base, sourceExcerpt: ' \t\n ' },
    { ...base, sourceExcerpt: 'x'.repeat(801) }, { ...base, sourceExcerpt: '😀'.repeat(401) },
    { ...base, replacement: { content: 'New', kind: undefined } },
    { ...base, replacement: { content: 'New', kind: 'unsupported' } },
    { ...base, replacement: { content: 'x'.repeat(601), kind: 'fact' } },
    { ...base, replacement: { content: 'New', kind: 'fact', origin: 'explicit' } },
    { ...base, namespace }, { ...base, ownerId: 'foreign' }, { ...base, receipts: [receipt('forged')] },
    { ...base, singleClaim: true }, { ...base, slotId: 'forged' }, { ...base, expectedRevision: 0 }];
  for (const args of malformed) { await invalid(host.client, args); assert.deepEqual(snapshot(db), before); }
  for (const [patch, code] of [[{ sourceExcerpt: 'ﬃ'.repeat(300) }, 'invalid_input'],
    [{ sourceExcerpt: '\0' }, 'invalid_input'], [{ sourceExcerpt: '[REDACTED]' }, 'invalid_input'],
    [{ expectedRevision: 999 }, 'revision_conflict'], [{ memoryId: 'missing' }, 'memory_not_found'],
    [{ replacement: { content: ' ＳＹＮＴＨＥＴＩＣ guard is Friday. ', kind: 'fact' } }, 'invalid_ref'],
    [{ replacement: { content: 'Suppressed synthetic replacement.', kind: 'fact' } }, 'memory_suppressed']]) {
    error(await call(host.client, 'supersede_memory', { ...base, ...patch }), code);
    assert.deepEqual(snapshot(db), before);
  }
  const foreign = await stdio(workspace, path, { owner: 'synthetic-foreign' });
  const foreignBefore = snapshot(db);
  error(await call(foreign, 'supersede_memory', base), 'memory_not_found');
  assert.deepEqual(snapshot(db), foreignBefore);
  const project = await stdio(workspace, path, { flags: ['--project', 'synthetic-foreign-project'] });
  const projectBefore = snapshot(db);
  error(await call(project, 'supersede_memory', base), 'memory_not_found');
  assert.deepEqual(snapshot(db), projectBefore);
  const changed = ok(await call(host.client, 'supersede_memory', { ...base, sourceExcerpt: '😀'.repeat(400) }));
  assert.equal((await inspect(host.client, changed.memory)).receipts[0].excerpt, '😀'.repeat(400));
  const historical = await inspect(host.client, old); const after = snapshot(db);
  error(await call(host.client, 'supersede_memory', base), 'revision_conflict');
  error(await call(host.client, 'supersede_memory', { ...base, expectedRevision: historical.memory.revision }), 'memory_historical');
  assert.deepEqual(snapshot(db), after);
  assert.equal(host.calls(), 0);
});

test('IS4 qualified predecessor and deduplicated qualified successor refuse atomically without exposed authority', options, async t => {
  const { workspace, path } = fixture(t);
  const core = openMemoryCore({ path });
  try {
    const seed = (content, qualified) => ok(core.admit({ namespace, memory: { content, kind: 'fact' }, receipts: [receipt(content)],
      ...(qualified ? { qualification: { version: 1, slot: { subject: null, property: null, scope: null, applies: null },
        value: null, attribution: 'unknown', commitment: 'unknown',
        anchors: [{ receiptIndex: 0, start: 0, end: content.length, text: content, fields: ['value'] }] } } : {}) })).memory;
    const qualified = seed('Qualified synthetic predecessor.', true);
    const ordinary = seed('Ordinary synthetic predecessor.', false);
    const next = seed('Qualified synthetic successor.', true);
    // Establish valid, actually persisted core qualification and bound receipts
    // before exercising the fence; a caller-supplied label alone is insufficient.
    for (const memory of [qualified, next]) {
      const detail = ok(core.get({ namespace, memoryId: memory.id, includeQualification: true }));
      assert.equal(detail.qualification.version, 1);
      assert.equal(detail.qualification.boundRevision, memory.revision);
      assert.equal(detail.qualification.contentDigest, createHash('sha256').update(detail.memory.content).digest('hex'));
      assert.equal(detail.qualification.anchors.length, 1);
      const anchor = detail.qualification.anchors[0];
      const source = detail.receipts.find(source => source.id === anchor.receiptId);
      assert.ok(source);
      assert.equal(source.excerpt.slice(anchor.start, anchor.end), anchor.text);
      assert.equal(anchor.receiptDigest, createHash('sha256').update(source.excerpt).digest('hex'));
    }
    core.close();
    const host = await embedded(workspace, path);
    const db = new DatabaseSync(path); workspace.defer(() => db.close());
    const before = snapshot(db);
    for (const args of [update(qualified, 'Novel synthetic successor.'), update(ordinary, 'Qualified synthetic successor.')]) {
      error(await call(host.client, 'supersede_memory', args), 'qualified_transition_required');
      assert.deepEqual(snapshot(db), before);
    }
    assert.equal((await inspect(host.client, qualified)).memory.state, 'active');
    assert.equal((await inspect(host.client, ordinary)).memory.state, 'active');
    assert.equal((await inspect(host.client, next)).receipts.length, 1);
    assert.deepEqual((await host.client.listTools()).tools.map(tool => tool.name).sort(), [...defaults, 'supersede_memory'].sort());
    assert.equal(host.calls(), 0);
  } finally { core.close(); }
});

test('IS2/IS2a canonical receipt normalization preserves caller input and the complete canonical excerpt', options, async t => {
  const { workspace, path } = fixture(t);
  const host = await embedded(workspace, path);
  const old = await save(host.client, 'Synthetic canonical review is Friday.');
  const submitted = update(old, 'Synthetic canonical review is Monday.',
    '  I adopted Ｍｏｎｄａｙ.\nThe scope stays the same.  ');
  const before = structuredClone(submitted);
  const changed = ok(await call(host.client, 'supersede_memory', submitted));
  assert.deepEqual(submitted, before);
  const successor = await inspect(host.client, changed.memory);
  assert.equal(successor.receipts[0].excerpt, 'I adopted Monday. The scope stays the same.');
  assert.deepEqual((await inspect(host.client, old)).supersession.receiptIds, [successor.receipts[0].id]);
  assert.equal(host.calls(), 0);
});

test('IS2b/IS8b real stdio refuses lone UTF-16 surrogates atomically and preserves valid pairs', options, async t => {
  const { workspace, path } = fixture(t);
  const client = await stdio(workspace, path);
  const embeddedHost = await embedded(workspace, path);
  const cases = [
    { client, sourceExcerpt: 'I adopted Monday.\ud800', label: 'stdio-high' },
    { client, sourceExcerpt: 'I adopted Monday.\udc00', label: 'stdio-low' },
    { client: embeddedHost.client, sourceExcerpt: '\ud800', label: 'embedded-high' },
    { client: embeddedHost.client, sourceExcerpt: '\udc00', label: 'embedded-low' },
  ];
  for (const item of cases) item.old = await save(client, `Synthetic Unicode ${item.label} review is Friday.`);
  const db = new DatabaseSync(path); workspace.defer(() => db.close());
  const before = snapshot(db);
  const outcomes = [];
  // Observe both real stdio cases before asserting, so a pre-fix failure cannot
  // hide the second malformed surrogate. Each starts from an independent record.
  for (const { client: target, sourceExcerpt, label, old } of cases) {
    assert.equal(sourceExcerpt.isWellFormed(), false);
    assert.equal(JSON.parse(JSON.stringify({ sourceExcerpt })).sourceExcerpt, sourceExcerpt);
    assert.equal(boundedText(sourceExcerpt, 800), sourceExcerpt);
    const result = await call(target, 'supersede_memory', update(old,
      `Synthetic Unicode ${label} review is Monday.`, sourceExcerpt));
    const retained = result.ok ? (await inspect(target, result.value.memory)).receipts[0].excerpt : null;
    outcomes.push({ label, result, material: snapshot(db), retainedWellFormed: retained?.isWellFormed() ?? null,
      retainedEqualsSource: retained === sourceExcerpt, replacementCharacterObserved: retained?.includes('\ufffd') ?? null });
  }
  t.diagnostic(JSON.stringify({ outcomes: outcomes.map(({ label, result, material, retainedWellFormed,
    retainedEqualsSource, replacementCharacterObserved }) => ({ label, ok: result.ok,
    writesObserved: JSON.stringify(material) !== JSON.stringify(before), retainedWellFormed,
    retainedEqualsSource, replacementCharacterObserved })), modelCalls: embeddedHost.calls() }));
  assert.equal(embeddedHost.calls(), 0);
  for (const { result, material } of outcomes) {
    error(result, 'invalid_input');
    assert.deepEqual(material, before);
  }
  const old = await save(client, 'Synthetic Unicode valid-pair review is Friday.');
  const changed = ok(await call(client, 'supersede_memory', update(old, 'Synthetic Unicode review is Monday.', '😀'.repeat(400))));
  assert.equal((await inspect(client, changed.memory)).receipts[0].excerpt, '😀'.repeat(400));
  assert.equal((await inspect(client, old)).supersession.evidenceAvailable, true);
});

test('IS2b2 real stdio refuses lone replacement surrogates atomically and preserves 600-unit pairs', options, async t => {
  const { workspace, path } = fixture(t);
  const client = await stdio(workspace, path);
  const host = await embedded(workspace, path);
  const cases = [
    { client, content: 'Adopted Monday.\ud800', label: 'stdio-high' },
    { client, content: 'Adopted Monday.\udc00', label: 'stdio-low' },
    { client: host.client, content: '\ud800', label: 'embedded-high' },
    { client: host.client, content: '\udc00', label: 'embedded-low' },
  ];
  for (const item of cases) item.old = await save(client, `Synthetic content Unicode ${item.label} Friday.`);
  const db = new DatabaseSync(path); workspace.defer(() => db.close());
  const before = snapshot(db);
  const outcomes = [];
  for (const { client: target, content, label, old } of cases) {
    assert.equal(content.isWellFormed(), false);
    assert.equal(JSON.parse(JSON.stringify({ content })).content, content);
    assert.equal(boundedText(content, 600), content);
    const result = await call(target, 'supersede_memory', update(old, content));
    const retained = result.ok ? (await inspect(target, result.value.memory)).memory.content : null;
    outcomes.push({ label, result, material: snapshot(db), retainedEqualsContent: retained === content,
      replacementCharacterObserved: retained?.includes('\ufffd') ?? null });
  }
  t.diagnostic(JSON.stringify({ outcomes: outcomes.map(({ label, result, material, retainedEqualsContent,
    replacementCharacterObserved }) => ({ label, ok: result.ok,
    writesObserved: JSON.stringify(material) !== JSON.stringify(before), retainedEqualsContent,
    replacementCharacterObserved })), modelCalls: host.calls() }));
  assert.equal(host.calls(), 0);
  for (const { result, material } of outcomes) {
    error(result, 'invalid_input');
    assert.deepEqual(material, before);
  }
  const old = await save(client, 'Synthetic replacement valid-pair Friday.');
  const changed = ok(await call(client, 'supersede_memory', update(old, '😀'.repeat(300))));
  assert.equal((await inspect(client, changed.memory)).memory.content, '😀'.repeat(300));
});

test('IS3 deduplicated successors bind only the supplied update receipt; correction alone creates no history', options, async t => {
  const { workspace, path } = fixture(t);
  const host = await embedded(workspace, path);
  const old = await save(host.client, 'Synthetic Friday review.');
  const next = await save(host.client, 'Synthetic Monday review.');
  const originalNext = await inspect(host.client, next);
  const result = ok(await call(host.client, 'supersede_memory', update(old, 'Synthetic Monday review.')));
  assert.equal(result.deduplicated, true); assert.equal(result.memory.id, next.id);
  const successor = await inspect(host.client, next); const history = await inspect(host.client, old);
  assert.equal(successor.receipts.length, 2);
  assert.ok(successor.receipts.some(source => source.id === originalNext.receipts[0].id));
  const updateSource = successor.receipts.find(source => source.excerpt === update(old).sourceExcerpt);
  assert.deepEqual(history.supersession.receiptIds, [updateSource.id]);
  const repair = await save(host.client, 'Synthetic spelling erorr.'); const before = await inspect(host.client, repair);
  const fixed = ok(await call(host.client, 'correct_memory', { memoryId: repair.id, expectedRevision: repair.revision,
    content: 'Synthetic spelling error.' })).memory;
  const detail = await inspect(host.client, fixed);
  assert.equal(fixed.id, repair.id); assert.equal(detail.memory.state, 'active');
  assert.equal(Object.hasOwn(detail, 'supersession'), false);
  assert.equal(detail.receipts.length, 1); assert.notEqual(detail.receipts[0].id, before.receipts[0].id);
  assert.deepEqual(ok(await call(host.client, 'inspect_memory', { states: ['historical'] })).memories.map(memory => memory.id), [old.id]);
  assert.equal(host.calls(), 0);
  await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
});
