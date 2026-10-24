#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,existsSync,mkdtempSync,openSync,closeSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,relative,join} from 'node:path';
import {hash,atomicJSON} from './common.mjs';
const root=fileURLToPath(new URL('.',import.meta.url)),repo=resolve(root,'../../..');
const read=name=>readFileSync(join(root,name));
const json=name=>JSON.parse(read(name));
const prefix=relative(repo,root)+'/';
const errataSHA256=hash(readFileSync(new URL('../protocol/errata.md',import.meta.url)));
const testLog=read('artifacts/a2-audit-harness-tests.tap').toString();
const actualExit=Number(read('artifacts/a2-audit-tests.exit').toString().trim());
assert.equal(actualExit,0,'Actual captured harness exit code must be zero');
assert.match(testLog,/# fail 0\b/);assert.match(testLog,/pilot verified: 60 families, 240 extractions, 480 scored observations/);
const tests=Number(testLog.match(/# tests (\d+)/)?.[1]);assert.ok(tests>=79);
const report=json('reports/cap-certification-a2.json'),budget=json('reports/budget-a2.json');
assert.equal(report.sources['evaluation/hr3/protocol/errata.md'],errataSHA256);
assert.equal(budget.sources['evaluation/hr3/protocol/errata.md'],errataSHA256);
assert.equal(json('reports/inspected-heldout-references.json').errataSHA256,errataSHA256);
assert.equal(json('reports/pre-development-projection.schema.json').properties.errataSHA256.const,errataSHA256);
for(const record of [report,budget])for(const [path,digest] of Object.entries(record.sources))assert.equal(hash(readFileSync(join(repo,path))),digest,path);
const prior='reports/freeze-pre-a2-audit.json';if(!existsSync(join(root,prior)))writeFileSync(join(root,prior),read('freeze.json'));
const verification={actualExit,tests,passed:tests,failed:0,fullFakePilot:{families:60,extractions:240,readerAnswers:480,actualSpendUSD:0},testLogSHA256:hash(testLog),capturedExitSHA256:hash(read('artifacts/a2-audit-tests.exit'))};
const components=['cap-certification.mjs','cap-stress-fixtures.mjs','inspected-references.mjs','projection-schema.mjs','budget-a2.mjs','freeze-a2.mjs','test/cap-certification.test.mjs','test/guard-certification.mjs','test/budget-a2.test.mjs','reports/cap-certification-a2.json','reports/inspected-heldout-references.json','reports/pre-development-projection.schema.json','reports/budget-a2.json','reports/budget-a2.md'];
const entry=name=>({bytes:read(name).length,sha256:hash(read(name))});
atomicJSON(join(root,'reports/a2-audit-freeze.json'),{version:'hr3-a2-audit-freeze-v1',errataSHA256,hashes:Object.fromEntries(components.map(n=>[n,entry(n)])),verification,capStatus:report.status,pilotBudgetStatus:budget.status,laterStageFeasibility:budget.laterStageFeasibility.status,paidReadiness:false});
// Independent inventories: git's complete tracked/untracked list versus an
// actual recursive filesystem walk, excluding only the documented artifacts
// directory and repository-wide *.log ignore rule.
const scratch=mkdtempSync(join(root,'artifacts/freeze-inventory-')),stdout=openSync(join(scratch,'stdout'),'wx'),stderr=openSync(join(scratch,'stderr'),'wx');
let gitPaths;
try{execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z','--',prefix],{cwd:repo,stdio:['ignore',stdout,stderr]});gitPaths=readFileSync(join(scratch,'stdout'),'utf8');}
finally{closeSync(stdout);closeSync(stderr);rmSync(scratch,{recursive:true,force:true});}
const gitFiles=[...new Set(gitPaths.split('\0').filter(Boolean).map(p=>p.slice(prefix.length)))].sort();
function walk(dir='') {return readdirSync(join(root,dir),{withFileTypes:true}).flatMap(e=>{
  const p=dir?dir+'/'+e.name:e.name;if(p==='artifacts'||p.endsWith('.log'))return [];
  return e.isDirectory()?walk(p):[p];
});}
const diskFiles=walk().sort();assert.deepEqual(gitFiles,diskFiles);
const payload={version:'hr3-harness-a2-audited-v1',protocol:{path:'../protocol/protocol-v0.3.4.md',sha256:hash(readFileSync(new URL('../protocol/protocol-v0.3.4.md',import.meta.url))),errata_sha256:errataSHA256,errata_version:'E-1/E-2/A-1/A-2 + non-author audit clarifications'},
  product_pin:json(prior).product_pin,product_paths:json(prior).product_paths,node:process.versions.node,
  file_count:diskFiles.length,file_inventory:diskFiles,hash_policy:'All delivered files except freeze.json itself; audit freeze does not hash its enclosing freeze.',
  hashes:Object.fromEntries(diskFiles.filter(n=>n!=='freeze.json').map(n=>[n,entry(n)])),cross_check:{routes:['git tracked + untracked nonignored paths','independent recursive filesystem walk'],count:diskFiles.length},
  verification,prior_verification_path:prior,capStatus:report.status,pilotBudgetStatus:budget.status,laterStageFeasibility:budget.laterStageFeasibility.status,
  paid_readiness:report.status==='PASS'?'Output-cap and pilot-budget gates pass; other protocol gates remain binding. Not paid authorization.':'Not certified: output-cap gate failed; other protocol gates remain binding.',network_calls:0,model_calls:0,credentials_read:false,actual_paid_usd:0,committed:false};
atomicJSON(join(root,'freeze.json'),payload);
for(const [name,digest] of Object.entries(json('freeze.json').hashes))assert.deepEqual(entry(name),digest);
process.stdout.write(JSON.stringify({errataSHA256,files:diskFiles.length,tests,capStatus:report.status,pilotBudgetStatus:budget.status})+'\n');
