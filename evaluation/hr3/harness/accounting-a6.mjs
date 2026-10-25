#!/usr/bin/env node
// Immutable ledger reconciliation only. This does not attest to any unrecorded
// preparation calls or produce a primary/non-author execution attestation.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {auditLedger,loadCarryForward} from './accounting.mjs';
import {canonical,hash} from './common.mjs';
import {INPUT_CAPS,OUTPUT_CAPS,READER_INPUT_CAPS} from './requests.mjs';
export const A6_ACCOUNTING_INPUT='evaluation/hr3/harness/reports/accounting-input-a6.json';
export const A6_CARRY='evaluation/hr3/harness/reports/a6-carry-forward.json';
export function accountingA6({write=false}={}) {
  const input=JSON.parse(readFileSync(A6_ACCOUNTING_INPUT));assert.equal(input.version,'hr3-accounting-a6-input-v1');
  function verified(s){assert.ok(s&&!isAbsolute(s.path)&&!s.path.split(/[\\/]/).includes('..'));const b=readFileSync(s.path);assert.equal(hash(b),s.sha256,s.path);if(s.bytes!==undefined)assert.equal(b.length,s.bytes);return b;}
  const before=verified(input.baseManifest),base=loadCarryForward(input.baseManifest.path);
  const ledger=auditLedger(verified(input.fourthPilotLedger).toString()),run=JSON.parse(verified(input.fourthPilotRun)),summary=JSON.parse(verified(input.fourthPilotSummary));
  assert.equal(run.offline,false);assert.equal(run.stage,'pilot');assert.equal(summary.stage,'pilot');assert.equal(summary.complete,true);
  assert.equal(canonical(ledger.events[0].configuration.carryForward),canonical(base));
  assert.equal(summary.ledger.total,ledger.exposure.total);assert.equal(canonical(summary.ledger.embedding),canonical(ledger.exposure.embedding));
  assert.equal(canonical(summary.ledger.unsettled),canonical(ledger.exposure.unsettled));assert.equal(summary.ledger.failures,ledger.exposure.failures);
  assert.ok(ledger.exposure.requestIds.every(id=>!id.startsWith('fake-')));
  // Retain every ancestor, unknown charge and full reservation. A fresh primary
  // preparation-completeness record is not supplied by these three run files;
  // the prospective manifest cannot silently turn that absence into approval.
  let preparation={complete:false,receipts:[]};
  if(input.preparation!==undefined){const p=input.preparation;assert.equal(p.suppliedBy,'primary');assert.equal(p.testOnly,false);assert.equal(p.complete,true);assert.ok(typeof p.attestation==='string'&&p.attestation.trim());assert.ok(Array.isArray(p.receipts));for(const receipt of p.receipts)verified(receipt);preparation={complete:true,attestation:p.attestation,receipts:p.receipts};}
  const manifest={version:'hr3-carry-forward-v1',ledgers:[{path:input.fourthPilotLedger.path,sha256:input.fourthPilotLedger.sha256,inheritedManifest:input.baseManifest}],preparation};
  if(write)writeFileSync(A6_CARRY,JSON.stringify(manifest,null,2)+'\n');
  const carry=loadCarryForward(A6_CARRY);assert.equal(canonical(JSON.parse(readFileSync(A6_CARRY))),canonical(manifest));
  assert.equal(carry.exposure.total,ledger.exposure.total+preparation.receipts.reduce((n,s)=>{const r=JSON.parse(verified(s));return n+r.settledNanodollars+r.outstandingNanodollars;},0));assert.equal(hash(readFileSync(input.baseManifest.path)),hash(before));
  const extraction=480*(INPUT_CAPS.extraction*400+OUTPUT_CAPS.extraction*1600);
  const reader=240*(Object.values(READER_INPUT_CAPS).reduce((n,x)=>n+x,0)*400+4*OUTPUT_CAPS.reader*1600);
  const remainingEmbedding=(128000000-carry.exposure.embedding.research-carry.exposure.embedding.product)*20;
  const entireEmbedding=128000000*20,incremental=extraction+reader+entireEmbedding,cumulative=carry.exposure.total+incremental;
  assert.ok(remainingEmbedding>=0);assert.ok(cumulative<=50e9);
  const sourceSpecs=[input.baseManifest,input.fourthPilotLedger,input.fourthPilotRun,input.fourthPilotSummary,...preparation.receipts];
  return {version:'hr3-accounting-a6-preflight-v1',status:'VERIFIED_FOUR_PILOT_LEDGER_CHAIN',completeLedgerChain:true,
    preparationComplete:carry.preparationComplete,preparationAttestation:carry.preparationAttestation??'NOT_SUPPLIED_FOR_POST_PILOT_FOUR',paidAuthorization:false,
    ledgerRecords:ledger.events.length,carry,sourceSpecs,input:{path:A6_ACCOUNTING_INPUT,sha256:hash(readFileSync(A6_ACCOUNTING_INPUT))},
    priorExposureNanodollars:base.exposure.total,additionalExposureNanodollars:ledger.exposure.total-base.exposure.total,
    planning:{status:'A6_1_CONSERVATIVE_ARITHMETIC_REQUEST_CERTIFICATE_REQUIRED',attemptsPerCall:2,primaryModelsUnchanged:true,
      cumulativePilotCapNanodollars:50e9,extractionNanodollars:extraction,readerNanodollars:reader,remainingEmbeddingNanodollars:remainingEmbedding,entireEmbeddingNanodollars:entireEmbedding,incrementalBoundNanodollars:incremental,
      cumulativeBoundNanodollars:cumulative,remainingAllowanceCumulativeBoundNanodollars:carry.exposure.total+extraction+reader+remainingEmbedding,limitsAuthority:'A-6.1',limitsChanged:true},
    baseManifestUnchanged:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const r=accountingA6({write:true});writeFileSync('evaluation/hr3/harness/reports/accounting-a6.json',JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({status:r.status,exposureNanodollars:r.carry.exposure.total,settledNanodollars:r.carry.exposure.settled,outstandingNanodollars:r.carry.exposure.outstanding,budget:r.planning}));}
