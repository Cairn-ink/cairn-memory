// External synthetic loader: replace the target exactly when capture is loaded.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
const loader = `import {unlinkSync,renameSync} from 'node:fs';
let data;export function initialize(value){data=value}
export async function resolve(specifier,context,next){
  const result=await next(specifier,context);
  if(result.url.endsWith('/adapters/local/capture.mjs')&&!data.changed){
    data.changed=true;
    if(data.replacement)renameSync(data.replacement,data.databasePath);else unlinkSync(data.databasePath);
  }return result;
}`;
register('data:text/javascript,' + encodeURIComponent(loader), { parentURL: import.meta.url,
  data: { databasePath: JSON.parse(readFileSync(process.env.SYNTHETIC_CONFIG, 'utf8')).databasePath,
    replacement: process.env.SYNTHETIC_REPLACEMENT } });
