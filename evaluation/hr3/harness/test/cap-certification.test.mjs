import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, openSync, closeSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { certify, readerReference, extractionReference, referenceDelivery, serializeOutput, meetsMargin } from '../cap-certification.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {engineeringStressFixtures,STRESS_SPEC} from '../cap-stress-fixtures.mjs';
import {pilotReferenceBundles} from '../cap-certification.mjs';
import {inspectedReferenceManifest,isInspectedReference} from '../inspected-references.mjs';
import { canonical, sha256 } from '../../generator/common.mjs';
import { answerSchema, extractionSchema, providerSchema } from '../schema.mjs';
import { scorerGold } from '../inputs.mjs';
import { score } from '../../scorer/scorer.mjs';
import { validate } from '../../scorer/schema.mjs';

const reportURL = new URL('../reports/cap-certification-a2.json', import.meta.url);
const getReport = () => JSON.parse(readFileSync(reportURL, 'utf8'));

test('offline cap report is reproducible over the complete frozen allocation', { timeout: 600000 }, t => {
  const actual = certify({ progress: message => t.diagnostic(message) });
  const saved = getReport();
  assert.equal(sha256(canonical(actual)), sha256(canonical(saved)), 'Regenerate the certification report after changing its inputs');
  assert.deepEqual(actual.counts.map(c => [c.families, c.checkpoints, c.extractionBatches]), [[60, 120, 240], [180, 360, 720]]);
  assert.equal(actual.method.allocationCrossCheck.families, 240);
  assert.equal(actual.pilotReferences.length, 120);
  assert.equal(new Set(actual.structures.map(s => s.structure)).size, actual.structures.length);
  assert.equal(actual.status, 'PASS');
  assert.equal(actual.paidWorkAllowedByThisGate, true);
  assert.equal(actual.minimumMarginPercent, 10);
  assert.equal(actual.gates.reader.pass, true);
  assert.equal(actual.gates.extraction.pass, true);
  assert.ok(actual.structures.every(s => s.worst.withinCap));
  assert.ok(actual.structures.every(s => s.failures===0 && s.worst.marginPercent >= 10));
  assert.ok(Object.values(actual.historicalDominance).every(r=>r.dominates));
  const historical = JSON.parse(readFileSync(new URL('../reports/cap-certification.json', import.meta.url), 'utf8'));
  assert.equal(historical.status, 'FAIL_AMENDMENT_REQUIRED');
  for (const old of historical.structures.filter(s=>s.worst.split==='pilot')) {
    const updated = actual.structures.find(s => s.structure === old.structure);
    assert.equal(updated.worst.serialization, old.worst.serialization);
    assert.equal(updated.worst.tokens, old.worst.tokens);
    assert.equal(updated.cases, old.cases);
  }
  const before=JSON.parse(readFileSync(new URL('../reports/cap-certification-a2-pre-cap-revision.json',import.meta.url),'utf8'));
  assert.equal(before.status,'FAIL_AMENDMENT_REQUIRED');
  for(const old of before.structures){const updated=actual.structures.find(s=>s.structure===old.structure);assert.equal(updated.worst.serialization,old.worst.serialization);assert.equal(updated.worst.tokens,old.worst.tokens);assert.equal(updated.cases,old.cases);}
  assert.equal(meetsMargin(1958, 2176), true);
  assert.equal(meetsMargin(1959, 2176), false);
  assert.equal(meetsMargin(3916, 4352), true);
  assert.equal(meetsMargin(3917, 4352), false);
});

test('every published serialization recounts with the installed real tokenizer and strict schema', () => {
  const require = createRequire(new URL('../../../../adapters/openai/package.json', import.meta.url));
  const encoder = require('tiktoken').get_encoding('o200k_base');
  try {
    for (const row of [...getReport().structures.map(s => s.worst), ...getReport().pilotReferences]) {
      const value = JSON.parse(row.serialization);
      const schema = providerSchema(row.operation === 'reader' ? answerSchema : extractionSchema);
      assert.deepEqual(validate(schema, value), []);
      assert.equal(serializeOutput(schema, value), row.serialization);
      assert.equal(encoder.encode(row.serialization, [], []).length, row.tokens);
      assert.equal(sha256(row.serialization), row.sha256);
      assert.equal(row.margin, row.cap - row.tokens);
      assert.equal(row.withinCap, row.margin >= 0);
      assert.equal(row.pass, meetsMargin(row.tokens, row.cap));
    }
  } finally { encoder.free(); }
});

test('all actual pilot gold references preserve C/O/R, directed support and citation provenance', () => {
  const saved = getReport();
  const bundles = [...pilotReferenceBundles(),...engineeringStressFixtures()];
  for (const bundle of bundles) for (const checkpoint of bundle.family.checkpoints) {
    const answer = readerReference(bundle, checkpoint.batch);
    const expected = saved.pilotReferences.find(r => r.familyId === bundle.family.family_id && r.batch === checkpoint.batch);
    if(bundle.family.split==='pilot')assert.equal(serializeOutput(providerSchema(answerSchema), answer), expected.serialization);
    const gold = scorerGold(bundle.family, checkpoint, bundle.gold, bundle.support);
    const delivered = referenceDelivery(bundle.family, checkpoint.batch);
    // License the full reference context, keeping exact edge-support spans and
    // OR/AND graphs intact. This is a local test fixture, never a reader input.
    for (const [i, b] of bundle.family.batches.filter(b => b.ordinal <= checkpoint.batch).entries()) for (const [j, turn] of b.turns.entries()) {
      gold.supportSpans.push({ id: `context-${i}-${j}`, origin: turn.turn_id, start: 0, end: turn.text.length, text: turn.text });
    }
    for (const candidate of [answer, ...bundle.support.checkpoints.find(c => c.batch === checkpoint.batch).acceptedGraphs.map((_, graph) => readerReference(bundle, checkpoint.batch, { graph, assertionCitations: false }))]) {
      const result = score(gold, { answer: candidate, delivered });
      assert.equal(result.valid, true);
      assert.deepEqual(result.scores, { C: 1, O: 1, R: 1, J: 1 }, `${bundle.family.family_id}/${checkpoint.batch}`);
      assert.equal(result.pendingAdjudication, false);
    }
  }
});

test('maximal scope/history and alternative graphs survive extraction; quote tampering fails', () => {
  const bundle=engineeringStressFixtures().find(b=>b.family.change_type==='scope_change'&&b.family.causal_class==='alternative_mediated'&&b.family.language==='zh-Hant');
  const answer = readerReference(bundle, 4);
  assert.equal(answer.current.claims.length, 2);
  assert.equal(answer.old.records.length, 2);
  assert.equal(answer.reason.nodes.length, 5);
  assert.equal(answer.reason.edges.length, 4);
  assert.ok(answer.current.claims.every(c => c.qualifiers.length === 2));
  const extraction = extractionReference(bundle.family, 4);
  assert.equal(extraction.events.length, 7);
  const focal = extraction.events.find(e => e.change_type === 'scope_change');
  assert.equal(focal.predecessor_anchors.length, 2);
  assert.equal(focal.reason_edges.length, 4);
  assert.ok(extraction.events.every(e => !e.event_id.includes(bundle.family.family_id)));
  const schema = providerSchema(answerSchema);
  const broken = structuredClone(answer);
  delete broken.old;
  assert.throws(() => serializeOutput(schema, broken));
  // Independent scorer validation catches a citation that is schema-valid but
  // absent from the delivered source text.
  const checkpoint = bundle.family.checkpoints.find(c => c.batch === 4);
  const gold = scorerGold(bundle.family, checkpoint, bundle.gold, bundle.support);
  answer.reason.edges[0].citations[0].quote = 'not a delivered causal quote';
  assert.equal(score(gold, { answer, delivered: referenceDelivery(bundle.family, 4) }).scores.R, 0);
});


test('certifier never imports generation entry points, even through transitive/dynamic imports',t=>{
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const dir=mkdtempSync(fileURLToPath(new URL('../artifacts/certifier-guard-',import.meta.url)));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const out=dir+'/stdout',err=dir+'/stderr',stdout=openSync(out,'wx'),stderr=openSync(err,'wx');let result;
 try{result=spawnSync(process.execPath,[fileURLToPath(new URL('./guard-certification.mjs',import.meta.url))],{stdio:['ignore',stdout,stderr],timeout:180000,env});}finally{closeSync(stdout);closeSync(stderr);}
 assert.equal(result.error,undefined);assert.equal(result.status,0,readFileSync(err,'utf8'));
 const report=JSON.parse(readFileSync(out,'utf8'));assert.equal(report.heldOutImports,0);assert.equal(report.negativeControlBlocked,true);
});

test('engineering stress Cartesian coverage and inspected held-out exclusion manifest are frozen',()=>{
 const fixtures=engineeringStressFixtures();assert.equal(fixtures.length,180);
 for(const type of STRESS_SPEC.changes)for(const cause of STRESS_SPEC.causes)for(const language of STRESS_SPEC.languages)for(const boundary of STRESS_SPEC.boundaryCases){
  assert.ok(fixtures.some(b=>b.family.change_type===type&&b.family.causal_class===cause&&b.family.language===language&&b.family.family_id.endsWith('B'+boundary)));
 }
 const manifest=inspectedReferenceManifest();
 assert.deepEqual(manifest,JSON.parse(readFileSync(new URL('../reports/inspected-heldout-references.json',import.meta.url),'utf8')));
 assert.deepEqual(manifest.counts,{cases:504,families:77,lineages:66,developmentLineages:33,testLineages:33});
 for(const c of manifest.cases){assert.equal(c.status,'inspected');assert.ok(isInspectedReference({serializationSHA256:c.serializationSHA256},manifest));}
 assert.ok(isInspectedReference({lineageId:'fresh-alias',ancestorLineageIds:[manifest.lineages[0].id]},manifest));
 assert.equal(isInspectedReference({lineageId:'independent-engineering-new'},manifest),false);
});
