import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSplit } from '../../generator/deliver.mjs';
import { buildBoundReport, componentBound, scoreBounds, LABEL, writeBoundReport } from '../bounds.mjs';
import { canonical, hash } from '../common.mjs';

for (const C of [0, 1, null]) for (const O of [0, 1, null]) for (const R of [0, 1, null]) {
  test(`A-1 component states C=${C} O=${O} R=${R}`, () => {
    const result = scoreBounds({C, O, R});
    const states = [C, O, R];
    const expected = states.includes(0) ? [0, 0] : states.every(x => x === 1) ? [1, 1] : [0, 1];
    assert.deepEqual(result, {C:componentBound(C), O:componentBound(O), R:componentBound(R), J:expected});
  });
}
const families = generateSplit('pilot').bundles.map(b => b.family);
const observation = (family, scores, extra = {}) => ({family:family.family_id, arm:'T', batch:4, valid:true, referrals:[], scores, ...extra});
const finalT = report => report.tables.find(t => t.arm === 'T' && t.batch === 4 && t.changeType === 'overall');

test('frozen aggregation computes family J first, with all 48 arm/type/checkpoint rows', () => {
  const observations = families.map((f, i) => observation(f, {C:i%2, O:1-i%2, R:1, J:0}));
  const report = buildBoundReport({families, observations, metadata:{actualSpendUSD:0}});
  const row = finalT(report);
  assert.equal(report.label, LABEL);assert.equal(report.tables.length, 48);
  assert.deepEqual(row.rates.C.bound, [0.5, 0.5]);assert.deepEqual(row.rates.O.bound, [0.5, 0.5]);
  assert.deepEqual(row.rates.R.bound, [1, 1]);assert.deepEqual(row.rates.J.bound, [0, 0]);
  assert.deepEqual(row.rates.J.counts, {determinedCorrect:0, determinedIncorrect:60, unresolved:0});
  assert.equal(row.rates.J.denominator, 60);assert.equal(row.weights.frozenLineageWeight, 1/30);
  assert.equal(row.weights.representedWeight, 1);assert.equal(row.weights.applied.length, 30);
  const type = report.tables.find(t => t.arm === 'T' && t.batch === 4 && t.changeType === families[0].change_type);
  assert.equal(type.weights.frozenLineageWeight, 1/6);assert.equal(type.denominators.planned, 12);
  const empty = report.tables.find(t => t.arm === 'P' && t.batch === 2 && t.changeType === 'overall');
  assert.equal(empty.rates.J.bound, null);assert.equal(empty.denominators.unexecuted, 60);
  assert.equal(report.denominators.unexecuted, 420);
});

test('partial attempts preserve frozen lineage weights, failures, unexecuted IDs and separate referral/score counts', () => {
  const [a,b,c] = families;
  assert.equal(a.lineage_id,b.lineage_id);assert.notEqual(b.lineage_id,c.lineage_id);
  const referral = {pass:'correctness', key:'shared-key', components:['R']};
  const observations = [
    observation(a,{C:0,O:1,R:null,J:0},{referrals:[referral]}),
    observation(b,{C:1,O:1,R:1,J:1},{referrals:[referral]}),
    observation(c,{C:1,O:1,R:1,J:1}),
    observation(c,{C:0,O:0,R:0,J:0},{arm:'P',batch:2,valid:false})
  ];
  const report = buildBoundReport({families, observations, metadata:{}}), row = finalT(report);
  assert.deepEqual(row.rates.J.bound, [0.75,0.75]); // not the unweighted family mean 2/3
  assert.equal(row.rates.R.counts.unresolved,1);
  assert.deepEqual(row.jointUnresolved,{numerator:0,denominator:3,share:0,weightedShare:0});
  assert.equal(row.anyReferredComponent.numerator,2);assert.equal(row.anyReferredComponent.share,2/3);
  assert.equal(row.anyReferredComponent.weightedShare,0.5);
  assert.deepEqual(row.outstandingReferrals.correctness,{applications:2,uniqueKeys:1,propagatedApplications:1,componentApplications:{C:0,O:0,R:2}});
  assert.equal(report.outstandingReferrals.correctness.uniqueKeys,1);
  assert.equal(row.denominators.planned,60);assert.equal(row.denominators.attempted,3);
  assert.equal(row.denominators.unexecuted,57);assert.equal(row.unexecutedFamilies.length,57);
  assert.equal(row.lineagesRepresented.length,2);assert.equal(row.weights.representedWeight,2/30);
  const failed = report.tables.find(t => t.arm==='P' && t.batch===2 && t.changeType==='overall');
  assert.deepEqual(failed.denominators,{planned:60,attempted:1,validCompletion:0,failedAttempt:1,unexecuted:59});
  assert.deepEqual(failed.rates.J.bound,[0,0]);
});

test('unresolved J and correctness/support referral applications are distinct and deduplicated per pass', () => {
  const referrals = [{pass:'correctness',key:'k1',components:['C','R']},{pass:'support',key:'k2',components:['R']}];
  const observations = families.slice(0,2).flatMap(f => ['U','T'].map(arm => observation(f,{C:null,O:1,R:1,J:null},{arm,referrals})));
  const report = buildBoundReport({families,observations,metadata:{}}), row = finalT(report);
  assert.deepEqual(row.rates.J.bound,[0,1]);assert.equal(row.jointUnresolved.share,1);
  assert.equal(report.outstandingReferrals.observations,4);
  for (const pass of ['correctness','support']) {
    assert.equal(report.outstandingReferrals[pass].applications,4);
    assert.equal(report.outstandingReferrals[pass].uniqueKeys,1);
    assert.equal(report.outstandingReferrals[pass].propagatedApplications,3);
  }
});

test('invalid states, duplicate/foreign observations and inconsistent J fail explicitly', () => {
  assert.throws(()=>componentBound(undefined),/invalid_component_state/);
  assert.throws(()=>componentBound(false),/invalid_component_state/);
  assert.throws(()=>scoreBounds({C:0,O:null,R:1,J:null}),/inconsistent_joint_score/);
  const o=observation(families[0],{C:1,O:1,R:1,J:1});
  assert.throws(()=>buildBoundReport({families,observations:[o,o]}),/duplicate_observation/);
  assert.throws(()=>buildBoundReport({families,observations:[{...o,family:'foreign'}]}),/unknown_observation/);
  assert.throws(()=>buildBoundReport({families,observations:[{...o,valid:false}]}),/failed_attempt/);
});

test('completed-stage report requires execution hashes, checks artifact bytes, and never overwrites output', t => {
  const root=mkdtempSync(join(tmpdir(),'hr3-bound-report-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const save=(name,data)=>writeFileSync(join(root,name),canonical(data)+'\n');
  save('families.jsonl',null); // replace with actual JSONL below
  writeFileSync(join(root,'families.jsonl'),families.map(canonical).join('\n')+'\n');
  const familyBytes=readFileSync(join(root,'families.jsonl'));
  save('manifest.json',{split:'pilot',seed:'hr3-worlds-v1',hashes:{'families.jsonl':{sha256:hash(familyBytes),bytes:familyBytes.length}}});
  const inputManifest=readFileSync(join(root,'manifest.json'));
  // Use a separate stage directory so its manifest cannot replace input hashes.
  const stage=mkdtempSync(join(root,'stage-'));
  const stageSave=(name,data)=>writeFileSync(join(stage,name),canonical(data)+'\n');
  const run={stage:'pilot',offline:true,families:families.map(f=>f.family_id),frozenArtifacts:{'protocol/errata.md':{sha256:'frozen-errata-hash'},'generator/pilot/manifest.json':{sha256:hash(inputManifest)}}};
  stageSave('run.json',run);stageSave('summary.json',{stage:'pilot',complete:true,attempted:1,ledger:{unsettled:[],stopped:null,total:1500000000}});
  stageSave('scored.jsonl',{...observation(families[0],{C:0,O:0,R:0,J:0},{valid:false}),version:'hr3-scorer-v1',protocol:'v0.3.4'});
  const journal = [
    {type:'configuration',configuration:{}},
    {type:'reserve',id:'settled',reserved:1500000000},
    {type:'settle',id:'settled',charged:1500000000}
  ];
  const journalSave = () => {let prior='';writeFileSync(join(stage,'ledger.jsonl'),journal.map(e=>{const data={...e,prior};const row={...data,digest:hash(data)};prior=row.digest;return canonical(row);}).join('\n')+'\n');};
  journalSave();
  const manifest=()=>stageSave('manifest.json',{files:Object.fromEntries(['run.json','summary.json','scored.jsonl','ledger.jsonl'].map(name=>{const bytes=readFileSync(join(stage,name));return [name,{sha256:hash(bytes),bytes:bytes.length}];}))});
  manifest();const out=join(root,'report.json');
  const report=writeBoundReport({stageDirectory:stage,inputs:root,out});
  assert.equal(report.metadata.actualSpendUSD,0);assert.equal(report.metadata.ledgerChargeUSD,1.5);
  assert.equal(report.metadata.frozenArtifacts['protocol/errata.md'].sha256,'frozen-errata-hash');
  assert.ok(!readFileSync(out,'utf8').includes(root));
  assert.throws(()=>writeBoundReport({stageDirectory:stage,inputs:root,out}),/EEXIST/);
  // Unknown final billing stays distinct from the already settled spend.
  run.offline=false;stageSave('run.json',run);
  journal.push({type:'reserve',id:'outstanding',reserved:2500000000},{type:'stop',reason:'cap_exceeded'});journalSave();
  stageSave('summary.json',{stage:'pilot',complete:false,attempted:1,ledger:{unsettled:['outstanding'],stopped:'cap_exceeded',total:4000000000}});manifest();
  const before=readFileSync(join(stage,'ledger.jsonl'),'utf8');
  const partial=writeBoundReport({stageDirectory:stage,inputs:root,out:join(root,'partial.json')});
  assert.equal(partial.stageStatus.complete,false);assert.equal(partial.stageStatus.stopReason,'cap_exceeded');
  assert.equal(partial.metadata.actualSpendUSD,null);assert.equal(partial.metadata.actualSpendKnown,false);
  assert.equal(partial.metadata.settledSpendUSD,1.5);assert.equal(partial.metadata.outstandingReservations.reservedUSD,2.5);
  assert.deepEqual(partial.metadata.outstandingReservations.ids,['outstanding']);
  assert.equal(partial.continuationApproval,false);assert.equal(partial.denominators.unexecuted,479);
  assert.ok(partial.tables.every(t=>t.cohortLabel.startsWith('partial observed cohort')));
  assert.equal(readFileSync(join(stage,'ledger.jsonl'),'utf8'),before);
  // A stopped run with all reservations settled reports known spend.
  journal.push({type:'settle',id:'outstanding',charged:500000000});journalSave();
  stageSave('summary.json',{stage:'pilot',complete:false,attempted:1,ledger:{unsettled:[],stopped:'cap_exceeded',total:2000000000}});manifest();
  const settled=writeBoundReport({stageDirectory:stage,inputs:root,out:join(root,'settled.json')});
  assert.equal(settled.metadata.actualSpendUSD,2);assert.equal(settled.stageStatus.complete,false);
  stageSave('summary.json',{stage:'pilot',complete:true,attempted:1,ledger:{unsettled:[],stopped:null,total:0}});
  assert.throws(()=>writeBoundReport({stageDirectory:stage,inputs:root,out}),/artifact_hash_mismatch/);
  delete run.frozenArtifacts;stageSave('run.json',run);manifest();
  assert.throws(()=>writeBoundReport({stageDirectory:stage,inputs:root,out}),/execution_time_hashes_required/);
});
