import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildArtifact, command, packageName } from '../build.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };

test('installed archive imports default core and opt-in hierarchy with bundled prompts and fake HTTP', { timeout: 60_000 }, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-installed-moc-' });
  const artifact = buildArtifact();
  writeFileSync(join(workspace.path, 'package.json'), JSON.stringify({ name: 'synthetic-installed-moc', private: true, version: '0.0.0' }), { flag: 'wx' });
  command('npm', ['install', '--prefix', workspace.path, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact.artifactPath],
    workspace.path, artifact.userconfig);
  const installed = join(workspace.path, 'node_modules', packageName);
  const required = ['core/moc-recall-candidates.mjs', 'core/moc-group-packing.mjs',
    'core/prompts/moc-route-l1.md', 'core/prompts/moc-route-l1-v2.md', 'core/prompts/moc-route-l2.md'];
  for (const path of required) {
    assert.ok(artifact.files.includes(path), path);
    assert.equal(createHash('sha256').update(readFileSync(join(installed, path))).digest('hex'), artifact.sourceHashes[path]);
  }
  // Imports resolve exclusively inside the actual installed archive.
  const { openMemoryCore } = await import(pathToFileURL(join(installed, 'core/contract.mjs')).href);
  const { createOpenAIModel } = await import(pathToFileURL(join(installed, 'adapters/openai/index.mjs')).href);
  const calls = [];
  const model = createOpenAIModel({ apiKey: 'synthetic-installed-moc', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body), input = JSON.parse(body.input[0].content[0].text);
    const method = body.text.format.name.slice('cairn_'.length);
    calls.push({ method, url, schema: body.text.format.schema });
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
    let output;
    if (method === 'extract') output = { items: input.messages.map(message => ({ content: message.content,
      kind: 'fact', confidence: 0.8, sourceIndices: [message.index] })) };
    else if (method === 'classify') output = { items: input.memories.map(memory => ({ memoryId: memory.id,
      parentIds: [], newL1: memory.content.startsWith('Standalone') ? { title: 'Standalone', parentL2Ids: [] }
        : { title: 'Alpha', parentL2Ids: [], newL2Title: 'Work' } })) };
    else if (method === 'selectGroups') output = { refs: input.maps.flatMap(map => map.groups).slice(0, input.maxRefs)
      .map(({ namespaceIndex, mocId, revision }) => ({ namespaceIndex, mocId, revision })) };
    else if (method === 'select') output = { refs: input.maps.flatMap(map => map.items.flatMap(item => item.type === 'unfiled'
      ? [{ namespaceIndex: map.namespaceIndex, ...item.ref }] : item.type === 'ref' && item.ref.childType === 'memory'
        ? [{ namespaceIndex: map.namespaceIndex, memoryId: item.ref.childId, revision: item.ref.childRevision }] : [])).slice(0, input.maxRefs) };
    else if (method === 'rank') output = { refs: input.candidates.slice(0, input.limit).map(candidate => ({
      namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id, revision: candidate.memory.revision })) };
    else assert.fail(method);
    return Response.json({ object: 'response', model: body.model, status: 'completed', error: null, incomplete_details: null,
      output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
      usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140 } });
  } });
  const path = join(workspace.path, 'memory.sqlite');
  let core = openMemoryCore({ path, model });
  workspace.defer(() => core.close());
  const namespace = { ownerId: 'installed-moc', scope: 'personal', projectId: null };
  const captured = ok(await core.capture({ namespace, client: 'offline', sessionId: 'session', eventId: 'capture',
    messages: [{ id: 'source', role: 'user', content: 'Work / Alpha: synthetic installed receipt.' }] }));
  assert.equal(captured.classification.status, 'applied');
  const detail = ok(core.get({ namespace, memoryId: captured.admission.memories[0].id }));
  const request = { readSet: [namespace], query: 'Work Alpha', contextMode: 'source-evidence' };
  calls.length = 0;
  const baseline = ok(await core.recall(request));
  assert.equal(baseline.memories.length, 1);
  assert.deepEqual(calls.filter(call => call.url.endsWith('/responses')).map(call => call.method), ['select', 'rank']);
  assert.equal('selection' in baseline, false);
  calls.length = 0;
  const routed = ok(await core.recall({ ...request, selectionMode: 'moc-hierarchy-v1' }));
  assert.deepEqual(calls.filter(call => call.url.endsWith('/responses')).map(call => call.method), ['selectGroups', 'selectGroups', 'select', 'rank']);
  assert.equal(routed.selection.resources.modelCalls, 4);
  assert.deepEqual(routed.memories, baseline.memories);
  assert.deepEqual(routed.memories[0].receipts, detail.receipts.map(({ id, role, excerpt }) => ({ id, role, excerpt })));
  const groupWire = calls.find(call => call.method === 'selectGroups').schema.properties.refs.items.properties;
  assert.ok(groupWire.mocId); assert.equal('memoryId' in groupWire, false);
  assert.deepEqual(ok(core.get({ namespace, memoryId: detail.memory.id })), detail);
  const ordinary = ok(await core.capture({ namespace, client: 'offline', sessionId: 'session', eventId: 'standalone-capture',
    messages: [{ id: 'standalone-source', role: 'user', content: 'Standalone: retained ordinary installed source.' }] }));
  assert.equal(ordinary.classification.status, 'applied');
  const source = ok(core.get({ namespace, memoryId: ordinary.admission.memories[0].id }));
  core.close(); core = openMemoryCore({ path, model }); calls.length = 0;
  const v2 = ok(await core.recall({ ...request, selectionMode: 'moc-hierarchy-v2' }));
  assert.equal(v2.memories.length, 2);
  const standalone = v2.selection.candidates.find(ref => ref.memoryId === source.memory.id);
  assert.ok(standalone.paths.some(path => path.origin === 'standalone' && !Object.hasOwn(path, 'l2')));
  assert.deepEqual(v2.memories.find(item => item.memory.id === source.memory.id).receipts,
    source.receipts.map(({ id, role, excerpt }) => ({ id, role, excerpt })));
  assert.deepEqual(calls.filter(call => call.url.endsWith('/responses')).map(call => call.method), ['selectGroups', 'selectGroups', 'select', 'rank']);
  assert.ok(v2.selection.resources.mapCalls <= 20); assert.ok(v2.selection.resources.modelCalls <= 5);
  t.diagnostic(`builder independently compared archive manifest with tar listing: ${artifact.files.length} files; ${required.length} hierarchy runtime paths installed`);
});
