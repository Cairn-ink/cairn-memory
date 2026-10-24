#!/usr/bin/env node
import { emit } from './deliver.mjs';

async function main() {
  const args=process.argv.slice(2), options={};
  for (let i=0;i<args.length;i+=2) {
    if (!['--split','--out','--seed'].includes(args[i]) || !args[i+1] || Object.hasOwn(options,args[i].slice(2))) throw new Error('Usage: node evaluation/hr3/generator/cli.mjs --split engineering|pilot|development|test --out EMPTY_DIR [--seed SEED]');
    options[args[i].slice(2)]=args[i+1];
  }
  if (!options.split || !options.out) throw new Error('--split and --out are required');
  const manifest=await emit(options);
  process.stdout.write(JSON.stringify({split:manifest.split,...manifest.counts,manifest:`${options.out}/manifest.json`,complete:manifest.gates.complete,goldFreezeApproval:manifest.gates.goldFreezeApproval})+'\n');
  if (!manifest.gates.complete) process.exitCode=1;
}
main().catch(error=>{process.stderr.write(`${error.code??'error'}: ${error.message}\n`);process.exitCode=1;});
