// This smoke runs on the Node20 CI host as well as supported capture runtimes.
// The loader also makes an accidental eager SQLite dependency fail explicitly.
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === 'node:sqlite') throw Error('local_transport_eager_sqlite');
  return next(specifier, context);
}`), import.meta.url);
const { createLocalCaptureTransport } = await import('../../raw/local-transport.mjs');
const { readConfigurationSnapshot } = await import('../../../../adapters/local/configuration.mjs');
assert.equal(typeof createLocalCaptureTransport, 'function');
assert.equal(typeof readConfigurationSnapshot, 'function');
console.log('local transport pure import: no eager SQLite');
