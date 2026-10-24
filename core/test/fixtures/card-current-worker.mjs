import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { openMemoryCore } from '../../index.mjs';
import { host } from '../role-fixture.mjs';
import { cardOptions } from '../card-current-fixture.mjs';
const h=host(),job=JSON.parse(readFileSync(process.argv[3],'utf8'));
if(job.rendezvous){writeFileSync(process.argv[3]+'.ready','ready');const deadline=Date.now()+20000;while(!existsSync(process.argv[3]+'.release')){if(Date.now()>deadline)throw Error('rendezvous timeout');await new Promise(resolve=>setTimeout(resolve,5));}}
const core=openMemoryCore({path:process.argv[2],methodPackages:h.methods,privateCards:cardOptions(h.authority,['declareCardCurrentDependencies','revalidateCardCurrentDependencies'].includes(job.method)),...(job.existingStore?{existingStore:job.existingStore}:{})});
try { const result=core[job.method](job.input,{});if(!result.ok && !job.expectedCodes?.includes(result.error.code))process.exitCode=1;process.stdout.write(JSON.stringify(result)); } finally {core.close();}
