#!/usr/bin/env node
import { useInstalledDependencies } from './dependencies.mjs';
const args=process.argv.slice(2),options={};
try {
  for(let i=0;i<args.length;i+=2){if(!['--carry-forward','--bound-report','--stage','--inputs','--out','--mcp-dependencies','--tokenizer-dependencies'].includes(args[i])||!args[i+1]||Object.hasOwn(options,args[i]))throw Error('Invalid option');options[args[i]]=args[i+1];}
  if(!options['--inputs']||!options['--out'])throw Error('Usage: node evaluation/hr3/harness/cli.mjs --stage smoke|pilot --inputs GENERATED_PILOT --out EMPTY_DIR [--mcp-dependencies EXISTING_NODE_MODULES --tokenizer-dependencies EXISTING_NODE_MODULES]');
  if(options['--bound-report']) {
    if(options['--carry-forward']||options['--stage']||options['--mcp-dependencies']||options['--tokenizer-dependencies'])throw Error('Bound reporting uses only recorded local artifacts; execution options are invalid');
    const {writeBoundReport}=await import('./bounds.mjs');
    const report=writeBoundReport({stageDirectory:options['--bound-report'],inputs:options['--inputs'],out:options['--out']});
    process.stdout.write(JSON.stringify({label:report.label,stageStatus:report.stageStatus,denominators:report.denominators,tables:report.tables.length,actualSpendUSD:report.metadata.actualSpendUSD})+'\n');
  } else {
  useInstalledDependencies({mcp:options['--mcp-dependencies'],tokenizer:options['--tokenizer-dependencies']});
  const {run}=await import('./runner.mjs');
  const result=await run({stage:options['--stage']??'smoke',inputs:options['--inputs'],out:options['--out'],carryForward:options['--carry-forward']??null,progress:p=>process.stdout.write(JSON.stringify({progress:p.family,batch:p.batch,scored:p.observations})+'\n')});
  process.stdout.write(JSON.stringify({complete:true,observations:result.observations.length,ledger:result.ledger})+'\n');
  }
}catch(error){process.stderr.write((error.code??'error')+': '+error.message+'\n');process.exitCode=1;}
