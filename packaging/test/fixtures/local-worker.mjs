// The only source-tree code is this synthetic host scaffold, loaded before the
// fence. Every subsequently loaded application module/asset must be installed.
import fs from 'node:fs';
import promises from 'node:fs/promises';
import { register,syncBuiltinESMExports } from 'node:module';
import { dirname,join } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
const settings = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if (settings.clock !== undefined) Date.now = () => settings.clock;
const { installed,trace,options,context,action } = settings;
fs.writeFileSync(trace,'',{ flag:'wx',mode:0o600 });
for (const api of [fs,promises]) for (const method of ['readFileSync','readFile']) {
  if (typeof api[method] !== 'function') continue;
  const original = api[method];
  api[method] = function(value,...args) {
    const path = value instanceof URL ? fileURLToPath(value) : String(value);
    if (path.startsWith(installed+'/')) fs.appendFileSync(trace,JSON.stringify({ path })+'\n');
    return original.call(this,value,...args);
  };
}
syncBuiltinESMExports();
register('data:text/javascript,'+encodeURIComponent(`
import {appendFileSync} from 'node:fs';import {fileURLToPath} from 'node:url';
let data;export function initialize(value){data=value}
export async function resolve(specifier,context,next){const result=await next(specifier,context);
if(result.url.startsWith('file:')){const path=fileURLToPath(result.url);
if(!path.startsWith(data.allowed+'/'))throw Error('installed_worker_source_fallback');
appendFileSync(data.trace,JSON.stringify({path})+'\\n');}return result;}
`),{ parentURL:import.meta.url,data:{ allowed:dirname(installed),trace } });
const { createLocalRawWorker } = await import(pathToFileURL(join(installed,'integrations/client/raw/local-worker.mjs')));
const result = await createLocalRawWorker(options)[action](context);
process.stdout.write(JSON.stringify(result)+'\n');
