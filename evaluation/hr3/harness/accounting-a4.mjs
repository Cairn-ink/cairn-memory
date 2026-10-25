#!/usr/bin/env node
// Supplemental A-4 accounting preparation. The existing carry manifest and
// every historical journal/configuration remain byte-for-byte unchanged.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {validate} from '../scorer/schema.mjs';
import {loadCarryForward,auditLedger} from './accounting.mjs';import {hash,canonical} from './common.mjs';
export const BASE_MANIFEST='evaluation/hr3/harness/reports/a3-carry-forward.json';
export const A4_MANIFEST='evaluation/hr3/harness/reports/a4-carry-forward.json';
export const A4_ACCOUNTING_INPUT='evaluation/hr3/harness/reports/accounting-input-a4.json';
function verified(spec){assert.ok(spec&&typeof spec.path==='string'&&!isAbsolute(spec.path)&&!spec.path.split(/[\\/]/).includes('..'),'Repository-relative accounting sources required');const bytes=readFileSync(spec.path);assert.equal(hash(bytes),spec.sha256,'Accounting source hash mismatch: '+spec.path);return bytes;}
export function prepareA4Accounting(inputPath=A4_ACCOUNTING_INPUT,{write=false}={}) {
 const baseBytes=readFileSync(BASE_MANIFEST),base=loadCarryForward(BASE_MANIFEST);
 if(!existsSync(inputPath))return {version:'hr3-a4-accounting-preparation-v1',complete:false,status:'BLOCKED_THIRD_PILOT_CHAIN_REQUIRED',carry:base,baseManifestUnchanged:true};
 const input=JSON.parse(readFileSync(inputPath));assert.deepEqual(validate(JSON.parse(readFileSync(new URL('./reports/accounting-input-a4.schema.json',import.meta.url))),input),[],'Malformed A-4 accounting input');assert.equal(input.version,'hr3-a4-accounting-input-v1');
 assert.equal(input.baseManifest.path,BASE_MANIFEST);verified(input.baseManifest);assert.equal(input.baseManifest.sha256,hash(baseBytes));
 assert.equal(input.preparationComplete,true);assert.ok(typeof input.attestation==='string'&&input.attestation.trim());
 assert.ok(Array.isArray(input.additionalPreparationReceipts));
 const ledger=auditLedger(verified(input.thirdPilotLedger).toString()),run=JSON.parse(verified(input.thirdPilotRun)),summary=JSON.parse(verified(input.thirdPilotSummary));
 assert.equal(run.offline,false,'Fake accounting cannot certify paid exposure');assert.equal(run.stage,'pilot');assert.equal(summary.stage,'pilot');
 assert.equal(canonical(ledger.events[0].configuration.carryForward),canonical(base),'Third pilot must inherit the exact verified base once');
 assert.equal(summary.ledger.total,ledger.exposure.total);assert.ok(ledger.events.some(e=>e.type==='reserve'));
 assert.equal(canonical(summary.ledger.embedding),canonical(ledger.exposure.embedding));
 assert.equal(canonical(summary.ledger.unsettled),canonical(ledger.exposure.unsettled));
 assert.ok(ledger.exposure.requestIds.every(id=>!id.startsWith('fake-')),'Fake provider IDs cannot enter paid accounting');
 const manifest={version:'hr3-carry-forward-v1',ledgers:[{...input.thirdPilotLedger,inheritedManifest:input.baseManifest}],
  preparation:{complete:true,attestation:input.attestation,receipts:input.additionalPreparationReceipts}};
 for(const receipt of input.additionalPreparationReceipts)verified(receipt);
 if(write)writeFileSync(A4_MANIFEST,JSON.stringify(manifest,null,2)+'\n');
 else {assert.ok(existsSync(A4_MANIFEST),'Prepare the supplemental manifest before consuming it');assert.equal(canonical(JSON.parse(readFileSync(A4_MANIFEST))),canonical(manifest));}
 const carry=loadCarryForward(A4_MANIFEST);assert.equal(hash(readFileSync(BASE_MANIFEST)),hash(baseBytes));
 assert.equal(carry.exposure.total,ledger.exposure.total+input.additionalPreparationReceipts.reduce((n,s)=>{const r=JSON.parse(verified(s));return n+r.settledNanodollars+r.outstandingNanodollars;},0));
 return {version:'hr3-a4-accounting-preparation-v1',complete:true,status:'COMPLETE_VERIFIED_CHAIN',carry,baseManifestUnchanged:true,
  input:{path:inputPath,sha256:hash(readFileSync(inputPath))},thirdLedger:input.thirdPilotLedger,sourceSpecs:[input.baseManifest,input.thirdPilotLedger,input.thirdPilotRun,input.thirdPilotSummary,...input.additionalPreparationReceipts]};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const r=prepareA4Accounting(process.argv[2]??A4_ACCOUNTING_INPUT,{write:true});writeFileSync('evaluation/hr3/harness/reports/accounting-a4.json',JSON.stringify(r,null,2)+'\n');process.stdout.write(JSON.stringify({status:r.status,complete:r.complete,exposureNanodollars:r.carry.exposure.total,baseManifestUnchanged:r.baseManifestUnchanged})+'\n');process.exitCode=r.complete?0:1;}
