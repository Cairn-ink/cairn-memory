#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,relative,join} from 'node:path';
import {hash,atomicJSON} from './common.mjs';
const root=fileURLToPath(new URL('.',import.meta.url)),repo=resolve(root,'../../..');
const read=name=>readFileSync(join(root,name)),json=name=>JSON.parse(read(name));
const verification=json('reports/a3-verification.json');
assert.equal(verification.status,'PASS');assert.ok(verification.commands.length>=14);
for(const command of verification.commands) {
  assert.equal(command.exitCode,0,command.command);
  for(const [stream,digest] of Object.entries(command.logs))assert.equal(hash(readFileSync(join(repo,stream))),digest);
}
const errataSHA256=hash(readFileSync(new URL('../protocol/errata.md',import.meta.url)));
const certificate=json('reports/cap-certification-a2.json'),budget=json('reports/budget-a2.json'),requestCertificate=json('reports/request-certification-a3.json');
assert.equal(requestCertificate.status,'PASS');assert.equal(requestCertificate.privacy.hits,0);
const privacyReport=json('reports/privacy-scan-a3.json');assert.equal(privacyReport.status,'PASS');assert.equal(privacyReport.readerRequests.total,480);assert.equal(privacyReport.productPayloads.hits,0);assert.equal(privacyReport.pReturnedContextUnchanged,true);
assert.equal(certificate.status,'PASS');assert.equal(budget.status,'PASS_PILOT_BUDGET');assert.equal(budget.a3PilotRerun.pass,true);assert.equal(budget.a3PilotRerun.realRerunAllowed,true);
for(const report of [certificate,budget,requestCertificate,privacyReport])for(const [path,digest] of Object.entries(report.sources))assert.equal(hash(readFileSync(join(repo,path))),digest,path);
assert.equal(certificate.sources['evaluation/hr3/protocol/errata.md'],errataSHA256);
assert.equal(json('reports/inspected-heldout-references.json').errataSHA256,errataSHA256);
assert.equal(json('reports/pre-development-projection.schema.json').properties.errataSHA256.const,errataSHA256);
const prior='reports/freeze-pre-a3.json';if(!existsSync(join(root,prior)))writeFileSync(join(root,prior),read('freeze.json'));
const prefix=relative(repo,root)+'/';
const gitFiles=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z','--',prefix],{cwd:repo,encoding:'utf8'}).split('\0').filter(Boolean).map(p=>p.slice(prefix.length)))].sort();
function walk(dir='') {
  return readdirSync(join(root,dir),{withFileTypes:true}).flatMap(e=>{
    const p=dir?dir+'/'+e.name:e.name;if(p==='artifacts'||p.endsWith('.log'))return [];
    return e.isDirectory()?walk(p):[p];
  });
}
const diskFiles=walk().sort();assert.deepEqual(gitFiles,diskFiles);
const entry=name=>({bytes:read(name).length,sha256:hash(read(name))});
const priorFreeze=json(prior);
const payload={version:'hr3-harness-a3-audited-v2',protocol:{...priorFreeze.protocol,errata_sha256:errataSHA256,errata_version:'revised E-1/E-2/A-1/A-2/A-3'},
  product_pin:priorFreeze.product_pin,product_paths:priorFreeze.product_paths,node:process.versions.node,
  file_count:diskFiles.length,file_inventory:diskFiles,hash_policy:'All delivered files except freeze.json itself; artifacts/ and ignored *.log files excluded.',
  hashes:Object.fromEntries(diskFiles.filter(n=>n!=='freeze.json').map(n=>[n,entry(n)])),
  cross_check:{routes:['git tracked + untracked nonignored paths','independent recursive filesystem walk'],count:diskFiles.length},
  verification:{path:'reports/a3-verification.json',sha256:hash(read('reports/a3-verification.json')),commands:verification.commands.length,allExitCodes:0},
  prior_verification_path:prior,capStatus:certificate.status,pilotBudgetStatus:budget.status,
  requestInputCaps:requestCertificate.inputCaps,requestInputStatus:requestCertificate.status,carryForward:budget.a3PilotRerun.carryForward,preparationComplete:budget.a3PilotRerun.preparationComplete,
  laterStageFeasibility:budget.laterStageFeasibility.status,paid_readiness:false,
  network_calls:0,model_calls:0,credentials_read:false,actual_paid_usd:0,committed:false};
atomicJSON(join(root,'freeze.json'),payload);
for(const [name,digest] of Object.entries(json('freeze.json').hashes))assert.deepEqual(entry(name),digest);
process.stdout.write(JSON.stringify({errataSHA256,files:diskFiles.length,crossChecked:'git inventory vs filesystem walk',capStatus:certificate.status,pilotBudgetStatus:budget.status})+'\n');
