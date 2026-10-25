#!/usr/bin/env node
// The primary runs this final step outside the sandbox after all gates pass.
import assert from 'node:assert/strict';import {readFileSync,readdirSync,writeFileSync,existsSync} from 'node:fs';import {execFileSync} from 'node:child_process';
import {runtimeClosure} from './runtime-closure.mjs';
import {hash,atomicJSON} from './common.mjs';
const h='evaluation/hr3/harness',integration='evaluation/hr3/integration',read=p=>readFileSync(p),json=p=>JSON.parse(read(p));
const closure=runtimeClosure();
// Bind upstream source/schema artifacts as well as the actual dual-route module
// closure. This includes lazy public-contract schema validation and producer freeze.
const upstreamContractFiles=['evaluation/hr3/generator','evaluation/hr3/scorer'].flatMap(dir=>readdirSync(dir,{withFileTypes:true}).filter(e=>e.isFile()&&/\.(?:mjs|json)$/.test(e.name)).map(e=>dir+'/'+e.name)).sort();
const v=json(h+'/reports/a6-verification.json');assert.equal(v.status,'PASS_OFFLINE_PENDING_PRIMARY_FREEZE');
for(const c of v.commands){assert.equal(c.exitCode,0,c.command);for(const [path,digest] of Object.entries(c.logs))assert.equal(hash(read(path)),digest);}
for(const p of ['cap-certification-a6.json','request-certification-a6.json','context-certification-a6.json','embedding-certification-a6.json','conformance-certification-a6.json','allocation-certification-a6.json','accounting-certification-a6.json','privacy-scan-a6.json']){const r=json(h+'/reports/'+p);assert.equal(r.status,'PASS');assert.equal(r.runtimeClosureSHA256,hash(closure.files),'Certificate closure binding');for(const [path,digest] of Object.entries(r.sources))assert.equal(hash(read(path)),digest,path);}
const budget=json(h+'/reports/budget-a6.json');assert.equal(budget.availableCarryFits,true);for(const [path,digest] of Object.entries(budget.sources))assert.equal(hash(read(path)),digest,path);assert.equal(budget.accountingGate.completeFourthPilotMerged,true,'Primary must reconcile the complete accounting chain before final freeze');
const previous=h+'/reports/freeze-pre-a6.json';if(!existsSync(previous))writeFileSync(previous,read(h+'/freeze.json'));
const git=execFileSync('git',['ls-files','--cached','--others','-z','--',h,integration],{encoding:'utf8',maxBuffer:1<<28}).split('\0').filter(p=>p&&!p.startsWith(h+'/artifacts/')&&!p.startsWith(integration+'/artifacts/')&&!p.endsWith('.log')).sort();
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const p=dir+'/'+e.name;if(p===h+'/artifacts'||p===integration+'/artifacts'||p.endsWith('.log'))return [];return e.isDirectory()?walk(p):[p];});}
const disk=[...walk(h),...walk(integration).filter(p=>!p.startsWith(integration+'/artifacts/'))].sort();assert.deepEqual(git,disk);
atomicJSON(h+'/freeze.json',{version:'hr3-harness-a6-v1',status:'PASS',upstreamContractFiles,runtimeClosure:closure,runtimeClosureSHA256:hash(closure.files),sources:Object.fromEntries(Object.entries(closure.files).map(([p,s])=>[p,s.sha256])),protocol:'v0.3.4+A-4+A-4.1+A-4.2+A-1.1+A-6+A-6.1',errataSHA256:hash(read('evaluation/hr3/protocol/errata.md')),
 priorFreeze:previous,verification:{path:h+'/reports/a6-verification.json',sha256:hash(read(h+'/reports/a6-verification.json'))},
 crossCheck:{routes:['git tracked + untracked','recursive filesystem enumeration'],count:disk.length},
 hashes:Object.fromEntries([...new Set([...disk.filter(p=>p!==h+'/freeze.json'),...Object.keys(closure.files),...Object.keys(closure.externalFiles),...upstreamContractFiles])].sort().map(p=>[p,{bytes:read(p).length,sha256:hash(read(p))}])),
 paidReadiness:false,reviewRequired:true,networkCalls:0,paidCalls:0});
process.stdout.write(JSON.stringify({files:disk.length,status:'FROZEN',paidReadiness:false})+'\n');
