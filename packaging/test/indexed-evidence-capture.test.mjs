import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildArtifact, command, packageName } from '../build.mjs';
import { qualificationPoolWire } from '../../adapters/openai/test/qualification-pool-wire.mjs';

test('E7 actual installed core/adapter evidence capture is cold-readable; qualified and invalid controls remain strict',
  { timeout: 90000 }, async t => {
    const artifact = buildArtifact(), root = mkdtempSync(join(tmpdir(), 'cairn-installed-indexed-evidence-'));
    t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(dirname(artifact.artifactPath), { recursive: true, force: true }); });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-evidence-install', private: true, version: '0.0.0' }));
    command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
      artifact.artifactPath], root, artifact.userconfig);
    const installed = join(root, 'node_modules', packageName);
    const { openMemoryCore } = await import(pathToFileURL(join(installed, 'core/index.mjs')).href);
    const { createOpenAIModel } = await import(pathToFileURL(join(installed, 'adapters/openai/index.mjs')).href);
    const namespace = { ownerId: 'installed-evidence-test', scope: 'personal', projectId: null };
    const tail = 'TAIL: synthetic Friday-only trip.';
    const request = { namespace, client: 'synthetic', sessionId: 'session', eventId: 'batch',
      messages: [{ id: 'original-source', role: 'user', content: 'x'.repeat(800) + tail }] };
    for (const mode of ['evidence', 'qualified', 'invalid']) {
      const stages = [];
      const model = createOpenAIModel({ apiKey: 'synthetic-installed-key', fetchImpl: async (url, options) => {
        assert.equal(new URL(url).origin, 'https://api.openai.com');
        const body = JSON.parse(options.body), name = body.text.format.name;
        stages.push([name, url.endsWith('/input_tokens') ? 'count' : 'generate']);
        if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
        const wire = JSON.parse(body.input[0].content[0].text); let output;
        if (name === 'cairn_extract') {
          assert.equal(wire.inputMode, 'indexed-windows-v1'); assert.equal(wire.messages[1].content, tail);
          output = { items: [{ content: 'Synthetic trip context', kind: 'context', confidence: 0.8, sourceIndices: [1] },
            ...(mode === 'invalid' ? [{ content: 'Later invalid item', kind: 'context', confidence: 0.8, sourceIndices: [99] }] : [])] };
        } else if (name === 'cairn_qualifyCandidates') {
          assert.equal(mode, 'qualified');
          output = qualificationPoolWire(wire, { qualifications: wire.items.map(item => ({ itemIndex: item.itemIndex,
            ...Object.fromEntries(['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'].map(field => [field,
              { value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null,
                evidenceIndices: field === 'value' ? [item.candidates[0].candidateIndex] : [] }])) })) });
        } else if (name === 'cairn_classify') output = { items: wire.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
        else assert.fail(`Unexpected installed stage: ${name}`);
        return Response.json({ object: 'response', model: body.model, status: 'completed', error: null,
          incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
            content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
          usage: { input_tokens: 120, output_tokens: 60, total_tokens: 180 } });
      } });
      const path = join(root, `${mode}.sqlite`), config = mode === 'qualified'
        ? { captureQualification: 'source-bound-v2', captureSourcePolicy: 'indexed-windows-v1' }
        : { captureSourcePolicy: 'indexed-evidence-v1' };
      let core = openMemoryCore({ path, model, ...config });
      try {
        const result = await core.capture(request);
        if (mode === 'invalid') {
          assert.equal(result.ok, false); assert.equal(result.error.code, 'invalid_model_output');
          assert.equal(core.list({ namespace }).value.memories.length, 0);
          assert.deepEqual(stages.map(([name]) => name), Array(2).fill('cairn_extract'));
          assert.equal(Object.hasOwn(result, 'value'), false); continue;
        }
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.equal(result.value.qualificationStatus, mode === 'evidence' ? 'not-requested' : undefined);
        const id = result.value.admission.memories[0].id;
        assert.deepEqual(stages, (mode === 'qualified' ? ['cairn_extract', 'cairn_qualifyCandidates', 'cairn_classify']
          : ['cairn_extract', 'cairn_classify']).flatMap(name => [[name, 'count'], [name, 'generate']]));
        core.close(); core = openMemoryCore({ path, model, ...config });
        const stored = core.get({ namespace, memoryId: id, includeQualification: true });
        assert.equal(stored.ok, true);
        assert.equal(stored.value.qualification === null, mode === 'evidence');
        const sources = core.sourceSnapshot({ readSet: [namespace], limit: 6, tokenBudget: 4000 });
        assert.equal(sources.ok, true, JSON.stringify(sources));
        assert.deepEqual(sources.value.memories[0].receipts.map(row => [row.role, row.excerpt]), [['user', tail]]);
        assert.equal(Object.hasOwn(sources.value.memories[0].memory, 'content'), false);
        const before = stages.length, duplicate = await core.capture(request);
        assert.equal(duplicate.value.duplicate, true); assert.equal(stages.length, before);
      } finally { core.close(); }
    }
  });
