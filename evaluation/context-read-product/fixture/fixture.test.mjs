import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateWorld } from './generator.mjs';
import { parameters, readJSON, memoryContent, cardContent, receipts, fit } from './content.mjs';
import { authoredQueries, labelQueries, auditNotes } from './query-source.mjs';
import { sha256, json } from './freeze.mjs';
import { freshnessTarget, writerOperation, workload } from './workload.mjs';
import { tokenizeT1 } from '../../../core/context-read-tokenize.mjs';

test('frozen P2 worlds, engine identities, labels and writer probes are reproducible', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'p2-fixture-test-'));
  try {
    const manifest = readJSON('manifest.json');
    const names = readdirSync(new URL('.', import.meta.url)).filter(name => name !== 'manifest.json').sort();
    assert.deepEqual(Object.keys(manifest.files), names);
    assert.equal(manifest.fileCount, names.length);
    assert.equal(sha256(json(manifest.files)), manifest.inventorySha256);
    for (const name of names) {
      const bytes = readFileSync(new URL(name, import.meta.url));
      assert.deepEqual({ bytes: bytes.length, sha256: sha256(bytes) }, manifest.files[name], name);
    }
    assert.deepEqual(readJSON('queries.json'), authoredQueries().map(({ slots, ...query }) => query));
    const knownMiss = readJSON('diagnostics.json').knownSingleHanMiss;
    assert.deepEqual(tokenizeT1(knownMiss.query), knownMiss.queryTokens);
    assert.deepEqual(tokenizeT1(knownMiss.bodyFragment), knownMiss.bodyTokens);
    assert.deepEqual(knownMiss.queryTokens.filter(token => knownMiss.bodyTokens.includes(token)), knownMiss.sharedTokens);
    for (const world of ['W1', ...(process.env.P2_FIXTURE_W3 === '1' ? ['W3'] : [])]) {
      const first = await generateWorld({ path: join(scratch, `${world}-first`), world, inMemory: true });
      const second = await generateWorld({ path: join(scratch, `${world}-second`), world, inMemory: true });
      assert.deepEqual(second, first, 'same seed => same public ids, canonical content hashes and logical hash');
      const { physical, canonicalBytes, ...catalog } = first;
      assert.deepEqual(catalog, readJSON(`world-${world}.json`));
      assert.equal(physical.schema, 23);
      for (const schema of [18, 33]) {
        const variant = await generateWorld({ path: join(scratch, `${world}-${schema}`), world, schema, inMemory: true });
        assert.equal(variant.physical.schema, schema);
        assert.deepEqual(variant.records, first.records.filter(row => schema !== 18 || row.type === 'memory'));
        assert.equal(variant.logicalSha256, readJSON('statistics.json').worlds[world].variants[schema].logicalSha256);
      }
    }
    // Always validate both frozen catalogs/labels, without regenerating W3 in ordinary tests.
    for (const world of ['W1', 'W3']) {
      const catalog = readJSON(`world-${world}.json`), labels = readJSON(`labels-${world}.json`);
      assert.deepEqual(labels, labelQueries(catalog));
      assert.equal(readFileSync(new URL(`why-${world}.txt`, import.meta.url), 'utf8'), auditNotes(labels, catalog));
      assert.equal(labels.length, 134);
      assert.equal(Math.min(...labels.map(label => Array.from(label.text).length)), 7);
      for (const [category, count] of Object.entries({ 'zh-Hant': 76, ja: 20, mixed: 28, negative: 10 }))
        assert.equal(labels.filter(q => q.category === category).length, count);
      assert.equal(labels.filter(q => q.intent === 'history').length, 22);
      assert.equal(labels.filter(q => q.crossNamespace).length, 20);
      for (const [flag, count] of Object.entries({ shortTemporal: 8, productTerm: 8, zeroSharedTokens: 10,
        naturalHistory: 6, ownerWide: 12, distractorChallenge: 6, notInMemory: 10 }))
        assert.equal(labels.filter(q => q[flag]).length, count, flag);
      assert.equal(labels.filter(q => q.language === 'zh-en' && q.category === 'mixed').length, 20);
      assert.equal(labels.filter(q => q.language === 'ja-en' && q.category === 'mixed').length, 8);
      const records = new Map(catalog.records.map(row => [row.id, row]));
      assert.equal(records.size, catalog.records.length);
      for (const label of labels) {
        assert.equal(label.expected === 'abstain', label.requiredEvidence.length === 0);
        for (const ref of [...label.requiredEvidence, ...label.acceptableAlternates.flatMap(group => group.refs)]) {
          const row = records.get(ref.id); assert.ok(row, `${label.id}: dangling ${ref.id}`);
          assert.deepEqual(ref, { id: row.id, namespace: row.namespace, type: row.type, revision: row.revision, bodyRevision: row.bodyRevision });
          if (label.intent === 'current') assert.equal(row.currentness, 'current');
        }
        if (label.intent === 'history') assert.ok(label.requiredEvidence.some(ref => records.get(ref.id).currentness === 'historical'));
        if (label.crossNamespace) assert.ok(new Set(label.requiredEvidence.map(ref => JSON.stringify(ref.namespace))).size >= 2);
        if (label.shortTemporal) {
          assert.ok(Array.from(label.text).length >= 7 && Array.from(label.text).length <= 10);
          assert.equal(label.temporal.asOf, '2026-10-27T12:00:00+08:00');
          const expected = catalog.records.filter(row => row.logicalKey.startsWith('c0/') &&
            row.groundTruth?.eventDate >= label.temporal.startDate && row.groundTruth.eventDate < label.temporal.endDateExclusive);
          assert.deepEqual(label.requiredEvidence.map(ref => ref.id).sort(), expected.map(row => row.id).sort());
        }
        if (label.naturalHistory) {
          assert.ok(label.explanationRequired);
          const old = label.requiredEvidence.map(ref => records.get(ref.id)).find(row => row.currentness === 'historical');
          const next = label.requiredEvidence.map(ref => records.get(ref.id)).find(row => row.groundTruth?.changeReason);
          assert.ok(old && next);
          assert.ok(catalog.links.some(link => link.previous === old.logicalKey && link.replacement === next.logicalKey));
        }
        if (label.ownerWide) {
          const related = label.ownerWideProof.relatedEvidence.map(ref => records.get(ref.id));
          const majority = JSON.stringify(label.ownerWideProof.majorityNamespace);
          assert.ok(related.filter(row => JSON.stringify(row.namespace) === majority).length > related.length / 2);
          assert.ok(label.requiredEvidence.every(ref => JSON.stringify(ref.namespace) !== majority));
          assert.ok(label.distractorEvidence.length >= 2);
          for (const entry of label.distractorEvidence) {
            assert.equal(entry.adopted, false);
            assert.equal(records.get(entry.ref.id).currentness, 'current', 'distractors remain eligible, not filtered');
            assert.ok(!label.requiredEvidence.some(ref => ref.id === entry.ref.id));
            assert.ok(!label.acceptableAlternates.some(group => group.refs.some(ref => ref.id === entry.ref.id)));
          }
        }
      }
      assert.equal(catalog.records.filter(row => row.type === 'memory').length, parameters.worlds[world].memories);
      assert.equal(catalog.records.filter(row => row.type === 'card').length, parameters.worlds[world].cards);
      assert.equal(catalog.mocs.length, parameters.worlds[world].mocs);
      // Independent content oracle: reconstruct submitted bodies and normalize only Memories.
      const allText = [];
      const canonicalBodies = new Map();
      for (const row of catalog.records) {
        const [c, n, i] = row.logicalKey.match(/\d+/g).map(Number);
        const body = row.type === 'memory' ? memoryContent(c, n, i).submitted.normalize('NFKC').replace(/\s+/gu, ' ').trim()
          : cardContent(c, n, i).submitted;
        assert.equal(sha256(body), row.bodySha256); allText.push(body);
        canonicalBodies.set(row.id, body);
        if (row.type === 'memory') allText.push(...receipts(c, n, i).map(r => r.excerpt));
        else allText.push(fit(`合成來源 ${c}/${n}/${i}：${cardContent(c, n, i).truth}`, parameters.perNamespacePerCohort.sourceNoteUnitsCycle[i % 4]));
        if (['proposal', 'rejected-suggestion'].includes(row.groundTruth?.adoptionStatus)) {
          assert.equal(row.groundTruth.adopted, false);
          assert.equal(row.currentness, 'current');
          assert.doesNotMatch(body, /尚未採用|未採用|不採用|已否決|被拒|not adopted|rejected|quoted/iu);
        }
      }
      const corpus = allText.join('\n');
      for (const label of labels.filter(q => q.notInMemory)) {
        assert.equal(label.expected, 'abstain');
        assert.equal(corpus.includes(label.absentProperty), false);
        assert.doesNotMatch(label.text, /不存在|未記録|尚未採用/u);
      }
      for (const label of labels.filter(q => q.zeroSharedTokens)) {
        for (const comparison of label.lexicalProof.comparisons) {
          const terms = new Set(tokenizeT1(canonicalBodies.get(comparison.ref.id)));
          assert.deepEqual(tokenizeT1(label.text).filter(token => terms.has(token)), []);
          assert.equal(comparison.bodySha256, records.get(comparison.ref.id).bodySha256);
        }
      }
      for (const label of labels.filter(q => q.distractorChallenge)) {
        const topicTerms = tokenizeT1(label.topic);
        for (const ref of [...label.requiredEvidence, ...label.distractorEvidence.map(entry => entry.ref)]) {
          const terms = new Set(tokenizeT1(canonicalBodies.get(ref.id)));
          assert.ok(topicTerms.every(term => terms.has(term)), 'adopted and suggested decisions share indexed topic terms');
        }
      }
      assert.equal(catalog.records.filter(row => row.groundTruth?.adoptionStatus === 'proposal').length, 6 * parameters.worlds[world].cohorts);
      assert.equal(catalog.records.filter(row => row.groundTruth?.adoptionStatus === 'rejected-suggestion').length, 6 * parameters.worlds[world].cohorts);
      for (const type of ['memory', 'card']) for (let index = 0; index < workload.freshness.targetsPerType; index++)
        assert.equal(corpus.includes(freshnessTarget(index, type).token), false, 'freshness token absent from frozen world');
    }
    const probes = ['memory', 'card'].flatMap(type => Array.from({ length: workload.freshness.targetsPerType }, (_, i) => freshnessTarget(i, type)));
    assert.equal(new Set(probes.map(p => p.token)).size, 240);
    assert.ok(probes.every(p => p.intents.join(',') === 'current,history' && p.body.includes(p.token)));
    assert.deepEqual(writerOperation(19), writerOperation(19));
    assert.equal(writerOperation(19).method, 'supersede');
    assert.notEqual(writerOperation(19).namespace.ownerId, writerOperation(19, { target: 'other-owner' }).namespace.ownerId);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
