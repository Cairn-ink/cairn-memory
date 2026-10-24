import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { contextOptions } from '../context-read-input.mjs';
import { fixture, host, ns, ok, query } from '../test/card-current-fixture.mjs';

const fixtures = new URL('../test/fixtures/', import.meta.url);
export const frozen = JSON.parse(readFileSync(new URL('card-current-pre-u5c3.json', fixtures)));
export function frozenSource(kind) {
  const entry = frozen.files[kind], bytes = readFileSync(new URL(entry.fixture, fixtures));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  return bytes.toString('utf8');
}
export async function loadSource(source, sourceURL, transform = value => value, resolveBare = value => value) {
  const rewritten = transform(source).replace(/from\s+(['"])([^'"]+)\1/g, (_, quote, specifier) =>
    'from ' + quote + (specifier.startsWith('.') ? new URL(specifier, sourceURL).href : resolveBare(specifier)) + quote);
  return import('data:text/javascript;base64,' + Buffer.from(rewritten).toString('base64'));
}
const facadeURL = new URL('../context-read-facade.mjs', import.meta.url);
function testSeam(source) {
  // Export the actual initializer and replace only search with the identical
  // precomputed horizon. Canonical preparation, assembly and final reads stay
  // intact in both modules. Normal tests require no Git checkout/history.
  const declaration = 'function initializeContextFacade(path, options, { readOnly, database }) {';
  const search = 'await searchCandidates(input, access, deadlineAt, true)';
  assert.equal(source.split(declaration).length, 2);
  assert.equal(source.split(search).length, 2);
  return source.replace(declaration, 'export ' + declaration).replace(search, 'await database.search()');
}
const readers = Promise.all([
  loadSource(frozenSource('facade'), facadeURL, testSeam),
  loadSource(readFileSync(facadeURL, 'utf8'), facadeURL, testSeam),
]);
export async function legacyDeadlineControl(t, { stage, schema33 }) {
  let now = 0, active = false, bindings = 0, counterCalls = 0;
  t.mock.method(performance, 'now', () => now);
  const h = host({ counter: { id: 'synthetic-legacy-deadline', countTokens() { counterCalls++; return 1; } } });
  const f = fixture(t, { h, enabled: schema33 });
  const count = stage === 'before-preparation' ? 1 : 3;
  for (let i = 0; i < count; i++) f.card({ declare: false, body: 'finance legacy body ' + i });
  f.reopen(false);
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, schema33 ? 33 : 32);
  assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='card_current_dependencies'").get().n, schema33 ? 1 : 0);
  if (schema33) assert.equal(f.db.prepare('SELECT count(*) n FROM card_current_dependencies').get().n, 0);
  const horizon = ok(await f.call('findCandidates', query()));
  assert.equal(horizon.items.length, count);
  const original = DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype, 'prepare', function(sql) {
    const statement = original.call(this, sql);
    return new Proxy(statement, { get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      return (...args) => {
        const result = value.apply(target, args);
        if (active && stage === 'between-candidates' && key === 'all' &&
            /SELECT source_ref,position FROM card_bindings WHERE card_id=/.test(sql) && ++bindings === 2) now = 6000;
        return result;
      };
    } });
  });
  const [legacy, current] = await readers, outcomes = [];
  for (const reader of [legacy, current]) {
    now = 0; bindings = 0; counterCalls = 0;
    const db = new DatabaseSync(f.path); db.exec('PRAGMA busy_timeout=5000');
    const context = reader.initializeContextFacade(f.path, contextOptions(h.context), { readOnly: false, database: { db, assertFile() {},
      async search() { if (stage === 'before-preparation') now = 6000; return { ok: true, horizon, check() {} }; } } });
    try {
      active = true;
      const envelope = await context.methods.contextRead(query(), {});
      outcomes.push({ envelope, calls: counterCalls });
    } finally { active = false; context.close(); }
  }
  assert.equal(JSON.stringify(outcomes[1].envelope), JSON.stringify(outcomes[0].envelope), 'entire facade envelope matches 84b142f1');
  assert.equal(outcomes[1].calls, outcomes[0].calls);
  for (const { envelope } of outcomes) {
    const value = ok(envelope);
    assert.equal(value.metered.items.length, 0);
    assert.equal(value.diagnostics.stops.deadline, true);
    assert.equal(value.diagnostics.omitted.items, count);
    assert.equal(value.diagnostics.omitted.bodies, count);
    assert.equal(value.diagnostics.omitted.unavailable, 0);
  }
  return outcomes;
}
