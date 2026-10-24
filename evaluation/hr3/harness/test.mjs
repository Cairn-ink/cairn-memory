#!/usr/bin/env node
import { useInstalledDependencies } from './dependencies.mjs';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!['--mcp-dependencies','--tokenizer-dependencies','--pilot-artifacts'].includes(args[i])||!args[i+1])throw Error('Invalid test option');options[args[i]]=args[i+1];}
useInstalledDependencies({mcp:options['--mcp-dependencies'],tokenizer:options['--tokenizer-dependencies']});
if(options['--pilot-artifacts'])globalThis.hr3PilotArtifacts=options['--pilot-artifacts'];
for(const file of ['ledger','research','extraction','product','runner'])await import(`./test/${file}.test.mjs`);
