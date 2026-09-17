import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildArtifact, command, packageName } from '../build.mjs';

for (const staleVersion of [2, 3]) test(`installed core and adapter bind v1/v2/v3 and fence v${staleVersion} correction`,
  { timeout: 60000 }, async t => {
    const artifact = buildArtifact();
    const root = mkdtempSync(join(tmpdir(), 'cairn-installed-context-adapter-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-context-adapter',
      private: true, version: '0.0.0' }), { flag: 'wx' });
    command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit',
      '--no-fund', artifact.artifactPath], root, artifact.userconfig);
    const packageRoot = join(root, 'node_modules', packageName);
    const { openMemoryCore } = await import(pathToFileURL(join(packageRoot, 'core/index.mjs')).href);
    const path = join(root, 'memory.sqlite');
    const namespace = { ownerId: 'installed-context-owner', scope: 'personal', projectId: null };
    const excerpt = 'The team considered A because the export is auditable; adoption is still pending.';
    const core = openMemoryCore({ path }); t.after(() => core.close());
    const admission = core.admit({ namespace, memory: { content: 'Generated interpretation', kind: 'context' },
      receipts: [{ client: 'synthetic-client', sessionId: 'synthetic-session',
        eventId: 'synthetic-event', role: 'user', excerpt }] });
    assert.equal(admission.ok, true, JSON.stringify(admission));
    const ref = { memoryId: admission.value.memory.id, revision: admission.value.memory.revision };
    core.close();
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { pathToFileURL } from 'node:url';
      const packageRoot = process.argv[1];
      const { openMemoryCore, prepareSourceContextUnits } = await import(
        pathToFileURL(packageRoot + '/core/index.mjs').href);
      const { createOpenAIModel } = await import(pathToFileURL(packageRoot + '/adapters/openai/index.mjs').href);
      const namespace = JSON.parse(process.argv[3]); const ref = JSON.parse(process.argv[4]);
      const field = (value, evidence = []) => ({ value, evidence });
      const proposal = { units: [{ source: 0, receipt: 0, kind: 'decision_state',
        subject: field(null, [0]), property: field(null), scope: field(null), applies: field(null),
        value: field(null), attribution: field('unknown'), polarity: field('unknown'),
        quantifier: field('unknown'), state: field('considered', [0]),
        eventTimeContext: [], reporterContext: [] }] };
      const v2Proposal = { units: [{ ...proposal.units[0],
        epistemicState: field('asserted', [0]), claimant: field(null), reporter: field(null) }] };
      const factualUnit = structuredClone(v2Proposal.units[0]); delete factualUnit.state;
      const v3Proposal = { units: [{ ...factualUnit, kind: 'factual_claim' },
        v2Proposal.units[0]], reasonLinks: [{ from: 0, to: 1,
          relation: 'stated-reason-for', evidence: [0] }] };
      const calls = [];
      let correctionMode = false; let corrected = null; let afterCorrectionSnapshot = null;
      const model = createOpenAIModel({ apiKey: 'synthetic-only', fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body); calls.push({ url, body });
        if (url.endsWith('/input_tokens')) {
          if (correctionMode && !corrected) {
            corrected = core.correct({ namespace, memoryId: ref.memoryId,
              expectedRevision: ref.revision, content: 'Corrected stored interpretation', kind: 'context',
              receipt: { client: 'synthetic-client', sessionId: 'synthetic-session',
                eventId: 'synthetic-event-corrected', role: 'user', excerpt: 'The team now rejects A.' } });
            afterCorrectionSnapshot = core.sourceSnapshot({ readSet: [namespace], limit: 12 });
          }
          return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
        }
        const version = JSON.parse(body.input[0].content[0].text).version;
        return Response.json({ object: 'response', model: body.model, status: 'completed',
          error: null, incomplete_details: null,
          output: [{ type: 'message', role: 'assistant', status: 'completed',
            content: [{ type: 'output_text', text: JSON.stringify(version === 3 ? v3Proposal
              : version === 2 ? v2Proposal : proposal) }] }],
          usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } });
      } });
      const core = openMemoryCore({ path: process.argv[2], model });
      const priorSnapshot = core.sourceSnapshot({ readSet: [namespace], limit: 12 });
      const prior = core.getRationale({ namespace, ...ref });
      const review = await core.reviewSourceContext({ namespace, refs: [ref] });
      const v2 = await core.reviewSourceContext({ namespace, refs: [ref], version: 2 });
      const v3 = await core.reviewSourceContext({ namespace, refs: [ref], version: 3 });
      const canonicalV3 = prepareSourceContextUnits({ version: 3, sources: [
        { receipts: [{ role: 'user', excerpt: process.argv[6] }] }] }).responseSchema;
      for (const call of calls.slice(4, 6)) {
        if (JSON.stringify(call.body.text.format.schema) !== JSON.stringify(canonicalV3)) {
          throw new Error('installed_v3_schema_mismatch');
        }
        if (call.body.text.format.schema.properties.units.items.anyOf[0]
          .properties.quantifier.anyOf[0].properties.evidence.minItems !== 1) {
          throw new Error('installed_v3_citation_minimum_missing');
        }
      }
      const afterSuccessfulSnapshot = core.sourceSnapshot({ readSet: [namespace], limit: 12 });
      const after = core.getRationale({ namespace, ...ref });
      correctionMode = true;
      const stale = await core.reviewSourceContext({ namespace, refs: [ref], version: Number(process.argv[5]) });
      const postCorrectionSnapshot = core.sourceSnapshot({ readSet: [namespace], limit: 12 });
      const correctedRationale = corrected?.ok && core.getRationale({ namespace,
        memoryId: ref.memoryId, revision: corrected.value.memory.revision });
      core.close();
      const cold = openMemoryCore({ path: process.argv[2], model });
      const coldSnapshot = cold.sourceSnapshot({ readSet: [namespace], limit: 12 });
      const coldRationale = corrected?.ok && cold.getRationale({ namespace,
        memoryId: ref.memoryId, revision: corrected.value.memory.revision });
      cold.close();
      process.stdout.write(JSON.stringify({ priorSnapshot, prior, review, v2, v3,
        afterSuccessfulSnapshot, after, corrected, stale,
        afterCorrectionSnapshot, postCorrectionSnapshot, coldSnapshot,
        correctedRationale, coldRationale, calls }));
    `, packageRoot, path, JSON.stringify(namespace), JSON.stringify(ref), String(staleVersion), excerpt],
    { encoding: 'utf8', timeout: 30000 });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.priorSnapshot.ok, true);
    assert.deepEqual(result.afterSuccessfulSnapshot, result.priorSnapshot);
    assert.equal(result.prior.value.edges.length, 0);
    assert.equal(result.review.ok, true, JSON.stringify(result.review));
    assert.equal(result.review.value.units[0].memoryId, ref.memoryId);
    assert.equal(result.review.value.units[0].receiptId,
      result.review.value.sources[0].receipts[0].id);
    assert.equal(result.review.value.units[0].state.value, 'considered');
    assert.equal(result.review.value.units[0].interpretationStatus, 'model-proposed-unverified');
    assert.equal(result.v2.ok, true, JSON.stringify(result.v2));
    assert.equal(result.v2.value.version, 2);
    assert.equal(result.v2.value.units[0].epistemicState.value, 'asserted');
    assert.equal(result.v2.value.units[0].claimant.value, null);
    assert.equal(result.v2.value.units[0].reporter.value, null);
    assert.equal(result.v2.value.units[0].memoryId, ref.memoryId);
    assert.equal(result.v2.value.units[0].receiptId, result.v2.value.sources[0].receipts[0].id);
    assert.equal(result.v3.ok, true, JSON.stringify(result.v3));
    assert.equal(result.v3.value.version, 3);
    assert.equal(result.v3.value.reasonLinks.length, 1);
    assert.equal(result.v3.value.units[1].state.value, 'considered');
    assert.deepEqual([result.v3.value.reasonLinks[0].memoryId,
      result.v3.value.reasonLinks[0].revision, result.v3.value.reasonLinks[0].receiptId],
    [ref.memoryId, ref.revision, result.v3.value.sources[0].receipts[0].id]);
    assert.equal(result.v3.value.reasonLinks[0].interpretationStatus,
      'model-proposed-unverified');
    assert.equal(result.after.value.edges.length, 0);
    assert.equal(result.corrected.ok, true, JSON.stringify(result.corrected));
    assert.equal(result.stale.ok, false, JSON.stringify(result.stale));
    assert.equal(result.stale.error.code, 'revision_conflict');
    assert.equal(result.afterCorrectionSnapshot.ok, true);
    assert.deepEqual(result.postCorrectionSnapshot, result.afterCorrectionSnapshot);
    assert.deepEqual(result.coldSnapshot, result.afterCorrectionSnapshot);
    assert.equal(result.correctedRationale.ok, true);
    assert.equal(result.coldRationale.ok, true);
    assert.deepEqual(result.coldRationale, result.correctedRationale);
    assert.equal(result.coldRationale.value.edges.length, 0);
    assert.deepEqual(result.calls.slice(0, 4).map(call => call.url), [
      'https://api.openai.com/v1/responses/input_tokens', 'https://api.openai.com/v1/responses',
      'https://api.openai.com/v1/responses/input_tokens', 'https://api.openai.com/v1/responses']);
    assert.equal(result.calls[4].url, 'https://api.openai.com/v1/responses/input_tokens');
    assert.equal(result.calls[5].url, 'https://api.openai.com/v1/responses');
    assert.equal(JSON.parse(result.calls[4].body.input[0].content[0].text).version, 3);
    assert.equal(JSON.parse(result.calls[6].body.input[0].content[0].text).version, staleVersion);
    assert.ok(result.calls.length >= 7 && result.calls.length <= 8);
    assert.equal(result.calls[1].body.max_output_tokens, 3072);
    assert.equal(result.calls[3].body.max_output_tokens, 3072);
    assert.equal(result.calls[5].body.max_output_tokens, 3072);
    assert.equal(JSON.parse(result.calls[2].body.input[0].content[0].text).version, 2);
    assert.equal(Object.hasOwn(result.calls[2].body.text.format.schema.properties.units
      .items.anyOf[0].properties, 'epistemicState'), true);
    assert.equal(JSON.stringify(result.calls).includes('Generated interpretation'), false);
    assert.equal(JSON.stringify(result.calls).includes(ref.memoryId), false);
  });
