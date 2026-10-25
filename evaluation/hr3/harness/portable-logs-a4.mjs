#!/usr/bin/env node
// Publish portable diagnostics only. Never touch provider bodies, deliveries,
// states, caches, input data, journals, or any pre-existing diagnostic file.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {hash,atomicJSON} from './common.mjs';
const h='evaluation/hr3/harness',baseline=JSON.parse(readFileSync(process.argv[2],'utf8')),root=process.cwd();
const changed=[];
function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())walk(p);else if(e.isFile()&&!Object.hasOwn(baseline,p)&&/\.(stdout|stderr|tap|log)$/.test(p)){
 const raw=readFileSync(p,'utf8'),portable=raw.split('file://'+root+'/').join('').split(root+'/').join('');
 if(raw!==portable){writeFileSync(p,portable);changed.push({path:p,beforeSHA256:hash(raw),afterSHA256:hash(portable)});}
}}}walk(h);
const report={version:'hr3-a4-portable-diagnostics-v1',policy:'Only newly generated diagnostics have workspace-root prefixes removed; exact provider bodies, returned P blocks, inputs, states, caches and journals are unchanged. Actual child exit codes are unchanged.',files:changed,count:changed.length};
const path=h+'/reports/portable-diagnostics-a4.json';atomicJSON(path,report);
const verificationPath=h+'/reports/a4-verification.json',v=JSON.parse(readFileSync(verificationPath));
for(const c of v.commands)for(const p of Object.keys(c.logs??{}))c.logs[p]=hash(readFileSync(p));
v.diagnosticPathNormalization={path,sha256:hash(readFileSync(path)),files:changed.length};atomicJSON(verificationPath,v);
process.stdout.write(JSON.stringify({files:changed.length,scientificArtifactsChanged:0,exitCodesChanged:0})+'\n');
