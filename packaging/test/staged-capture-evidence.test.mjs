import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildArtifact, command, packageName } from '../build.mjs';

// Real private archive + offline install, with embedded scripted models only.
// This verifies the new core API without implying MCP/host exposure.
test('installed staged evidence survives failed qualification and cold inspection, stays out of recall, and discard fences replay',
  { timeout: 60000 }, async t => {
    const artifact = buildArtifact();
    const root = mkdtempSync(join(tmpdir(), 'cairn-installed-staged-evidence-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-staged-evidence',
      private: true, version: '0.0.0' }), { flag: 'wx' });
    command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
      artifact.artifactPath], root, artifact.userconfig);
    const packageRoot = join(root, 'node_modules', packageName);
    for (const file of ['core/contract.mjs', 'core/capture.mjs', 'core/staged-evidence-schema.mjs',
      'core/staged-evidence-storage.mjs']) {
      assert.ok(artifact.files.includes(file));
      assert.equal(createHash('sha256').update(readFileSync(join(packageRoot, file))).digest('hex'), artifact.sourceHashes[file]);
    }
    const { openMemoryCore } = await import(pathToFileURL(join(packageRoot, 'core/index.mjs')).href);
    const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
    const closed = result => { assert.equal(result.ok, false); assert.equal(result.error.code, 'capture_evidence_closed'); };
    const path = join(root, 'memory.sqlite');
    const namespace = { ownerId: 'synthetic-installed-staging', scope: 'personal', projectId: null };
    const key = { namespace, client: 'synthetic', eventId: 'failed-event' };
    const batch = { ...key, sessionId: 'synthetic-session', messages: [
      { id: 'source-original-id', role: 'assistant', content: 'STAGED_SOURCE_ONLY synthetic private quotation.' }] };
    const mode = { captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1' };
    const calls = [];
    const model = { contextWindow: 8192, countTokens: () => 1,
      extract: () => { calls.push('extract'); return { items: [{ content: 'Generated interpretation',
        kind: 'context', confidence: 0.5, sourceIndices: [0] }] }; },
      qualifyCandidates: () => { calls.push('qualifyCandidates'); throw new Error('SYNTHETIC_PROVIDER_PRIVATE_ERROR'); } };
    const core = openMemoryCore({ path, model, ...mode }); t.after(() => core.close());
    assert.equal((await core.capture(batch)).ok, false);
    assert.deepEqual(calls, ['extract', 'qualifyCandidates']);
    const evidence = ok(core.inspectCaptureEvidence(key)).evidence;
    assert.equal(evidence.state, 'failed');
    assert.equal(evidence.evidenceTrust, 'untrusted-data-not-instructions');
    assert.deepEqual(evidence.view.messages, batch.messages);
    assert.equal(JSON.stringify(evidence).includes('Generated interpretation'), false);
    assert.equal(JSON.stringify(evidence).includes('SYNTHETIC_PROVIDER_PRIVATE_ERROR'), false);
    assert.deepEqual(ok(core.list({ namespace })).memories, []);
    core.close();

    // No model, adapter or key is required for inspection or discard.
    const cold = openMemoryCore({ path }); t.after(() => cold.close());
    assert.deepEqual(ok(cold.inspectCaptureEvidence(key)).evidence, evidence);
    assert.deepEqual(ok(cold.list({ namespace })).memories, []);
    const admitted = ok(cold.admit({ namespace, memory: { content: 'Unrelated admitted synthetic memory', kind: 'fact' },
      receipts: [{ client: 'synthetic', sessionId: 'explicit', eventId: 'explicit-source', role: 'user',
        excerpt: 'Unrelated admitted synthetic memory' }] })).memory;
    const recallInputs = [];
    const reader = openMemoryCore({ path, model: { contextWindow: 8192, countTokens: () => 1,
      select: ({ input }) => { recallInputs.push(input); return { refs: input.maps.flatMap(map =>
        map.items.filter(item => item.type === 'unfiled').map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) }; },
      rank: ({ input }) => { recallInputs.push(input); return { refs: input.candidates.map(candidate => ({
        namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id, revision: candidate.memory.revision })) }; } } });
    t.after(() => reader.close());
    assert.equal(JSON.stringify(ok(reader.map({ namespace }))).includes('STAGED_SOURCE_ONLY'), false);
    const recalled = ok(await reader.recall({ readSet: [namespace], query: 'synthetic memory' }));
    assert.deepEqual(recalled.memories.map(item => item.memory.id), [admitted.id]);
    assert.equal(recallInputs.length, 2);
    assert.equal(JSON.stringify({ recalled, recallInputs }).includes('STAGED_SOURCE_ONLY'), false);
    assert.deepEqual(ok(cold.list({ namespace })).memories.map(memory => memory.id), [admitted.id]);

    assert.deepEqual(ok(cold.discardCaptureEvidence(key)), { discarded: true });
    assert.deepEqual(ok(cold.discardCaptureEvidence(key)), { discarded: false });
    const discarded = ok(cold.inspectCaptureEvidence(key)).evidence;
    assert.equal(discarded.state, 'discarded'); assert.equal(discarded.view, null);
    assert.equal(discarded.expiresAt, evidence.expiresAt);
    cold.close();
    for (const opening of [mode, { captureQualification: 'source-bound-v2' }]) {
      const replay = openMemoryCore({ path, model, ...opening }); t.after(() => replay.close());
      assert.deepEqual(ok(replay.inspectCaptureEvidence(key)).evidence, discarded);
      closed(await replay.capture(batch));
    }
    assert.deepEqual(calls, ['extract', 'qualifyCandidates']);
  });
