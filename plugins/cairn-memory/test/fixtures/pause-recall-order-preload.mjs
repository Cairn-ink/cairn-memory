// Observe actual awaited preparation and final output without changing timing.
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const send = event => process.send?.({...event, ms: performance.now()});
for (const method of ['readFile', 'open']) {
  const original = fs[method];
  fs[method] = async function(path, ...args) {
    const result = await original.call(this, path, ...args);
    if (String(path).endsWith('/project-key')) send({kind:'prepared',part:'project'});
    if (String(path).includes('/hosted-quota/')) send({kind:'prepared',part:'quota'});
    return result;
  };
}
const originalLink = fs.link;
fs.link = async function(source, target) {
  if ((String(target).endsWith('/control.lock') || String(target).endsWith('.gate')) && recallStarted) send({kind:'output-gate'});
  return originalLink.call(this, source, target);
};
syncBuiltinESMExports();
let recallStarted = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, options) => {
  const route = new URL(url).pathname.split('/').at(-1);
  send({kind:'fetch',route});
  if (route === 'recall') recallStarted = true;
  return originalFetch(url, options);
};
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (...args) => { send({kind:'output'}); return originalWrite(...args); };
process.channel?.unref();
