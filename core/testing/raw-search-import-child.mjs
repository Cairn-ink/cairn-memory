import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const [root,scratch]=process.argv.slice(2);process.chdir(scratch);Error.stackTraceLimit=50;
const rawCaller=()=>/[/\\]core[/\\]raw-search-[^/\\\n]*\.mjs/.test(new Error().stack);
// Settle the child's own loader and initialize its standard streams first.
void process.stdin;void process.stdout;void process.stderr;
await new Promise(setImmediate);await new Promise(setImmediate);
const timers=[],handles=[],listeners=[],files=readdirSync(scratch);
const resources=process.getActiveResourcesInfo().sort();
const before=new Map(process.eventNames().map(name=>[name,process.listeners(name)]));
for(const method of ['setTimeout','setInterval']){
  const schedule=globalThis[method];globalThis[method]=(...args)=>{
    const raw=rawCaller(),handle=schedule(...args);if(raw){timers.push(method);handles.push(handle);}return handle;
  };
}
for(const method of ['on','once','addListener','prependListener','prependOnceListener']){
  const add=process[method];process[method]=function(...args){if(rawCaller())listeners.push(String(args[0]));return add.apply(this,args);};
}
try{
  await import(pathToFileURL(join(root,'core/index.mjs')));
  await new Promise(setImmediate);
  assert.deepEqual(timers,[]);assert.deepEqual(listeners,[]);
  assert.deepEqual(process.getActiveResourcesInfo().sort(),resources);
  assert.deepEqual(readdirSync(scratch),files);
  assert.deepEqual(process.eventNames(),[...before.keys()]);
  for(const [name,values] of before)assert.deepEqual(process.listeners(name),values);
}finally{for(const handle of handles){clearTimeout(handle);clearInterval(handle);}}
