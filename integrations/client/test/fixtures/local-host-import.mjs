// Node20 pure import must not load SQLite; it does not support capture.
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,'+encodeURIComponent(`
export async function resolve(specifier,context,next){
  if(specifier==='node:sqlite')throw Error('local_host_eager_sqlite');
  return next(specifier,context);
}`),import.meta.url);
const {createLocalRawHost}=await import('../../raw/local-host.mjs');
const {runLocalHostCli}=await import('../../raw/local-host-cli.mjs');
assert.equal(typeof createLocalRawHost,'function');assert.equal(typeof runLocalHostCli,'function');
console.log('local host pure import: no eager SQLite');
