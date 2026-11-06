import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { setup, guard, ok, ns, until } from './fixtures/semantic-turn-runtime.mjs';
import { semanticHandle } from '../context-semantic-coordinator.mjs';
import { supervisorOwner } from '../context-read-supervisor.mjs';

async function validation(t, options = {}) {
  const s = await setup(t, options), status = ok(await guard(s.coordinator.getOwnerSemanticStatus({ ownerId: ns.ownerId }, s.token), 'validation status'));
  const buffer = new SharedArrayBuffer(8), view = new Int32Array(buffer), turn = semanticHandle(s.coordinator).pumpTurn({ semanticOutstanding: buffer });
  s.f.workspace.defer(() => turn.detach());
  const input = { ownerId: ns.ownerId, expectedTargetDigest: status.firstCoverage.targetSetDigest, budget: { maxTargets: 1, maxMs: 5000 } };
  const db = new DatabaseSync(s.ledgerPath);s.f.workspace.defer(() => db.close());
  const ledger = () => db.prepare('SELECT state FROM semantic_owners WHERE owner_id=?').get(ns.ownerId).state;
  return { s, input, buffer, view, turn, ledger };
}
function intercept(t, callback) {
  const original = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function(message, ...args) {
    return callback(this, message, () => Reflect.apply(original, this, [message, ...args]));
  };
  t.after(() => { Worker.prototype.postMessage = original; });
}
const isValidation = m => m.kind === 'call' && m.method === 'validateOwnerSemanticCoverage';

// Port of both reviews' parity reproductions; additionally assert that no
// registration, ledger mutation or transient outstanding increment occurred.
for (const kind of ['pre-aborted', 'malformed', 'unknown-key', 'settlement-key']) test('validation rejects ' + kind + ' before registration and posting', async t => {
  const d = await validation(t), { s, input, turn, view } = d;
  const abort = new AbortController();abort.abort();
  const control = kind === 'pre-aborted' ? { signal: abort.signal } : kind === 'malformed' ? { signal: {} } : kind === 'unknown-key' ? { unexpected: true } : { semanticOutstanding: new SharedArrayBuffer(8) };
  const expected = await guard(s.coordinator.validateOwnerSemanticCoverage(input, s.token, control), 'public refused validation');
  assert.equal(expected.error.code, kind === 'pre-aborted' ? 'read_cancelled' : 'invalid_input');
  let posts = 0, registrations = 0, increments = 0;
  intercept(t, (_worker, message, post) => { if (isValidation(message)) posts++;return post(); });
  const { registry } = supervisorOwner(s.supervisor), register = registry.register, add = Atomics.add;
  const before = d.ledger();
  registry.register = function(...args) { registrations++;return Reflect.apply(register, this, args); };
  Atomics.add = function(array, index, value) { if (array.buffer === d.buffer && index === 0) increments++;return Reflect.apply(add, Atomics, [array, index, value]); };
  let actual;
  try { actual = await guard(turn.validate(input, s.token, control), 'private refused validation');await until(() => view[0] === 0, 'refused handler settled'); }
  finally { registry.register = register;Atomics.add = add; }
  assert.deepEqual(actual, expected);assert.equal(posts, 0);assert.equal(registrations, 0);assert.equal(increments, 0);
  assert.equal(view[0], 0);assert.equal(d.ledger(), before, 'refusal cannot mutate validation ledger');
});

test('internal validate preserves public validation cancellation behavior', async t => {
  const { s, input, turn, view } = await validation(t), abort = new AbortController();abort.abort();
  let calls = 0;intercept(t, (_worker, message, post) => { if (isValidation(message)) calls++;return post(); });
  const control = { signal: abort.signal };
  const publicResult = await guard(s.coordinator.validateOwnerSemanticCoverage(input, s.token, control), 'public aborted validation');
  assert.equal(publicResult.error.code, 'read_cancelled');assert.equal(calls, 0);
  const privateResult = await guard(turn.validate(input, s.token, control), 'private aborted validation');
  await until(() => view[0] === 0, 'private handler settled');
  assert.equal(calls, 0, 'check cancellation before increment and Worker post');assert.deepEqual(privateResult, publicResult);
});

test('mid-flight validation abort sends cancel and detaches after reply with a settled counter', async t => {
  const { s, input, turn, view } = await validation(t), abort = new AbortController();
  const cancels = [];let incoming, deliver, added = 0, removed = 0, counted;
  const add = abort.signal.addEventListener, remove = abort.signal.removeEventListener;
  abort.signal.addEventListener = function(...args) { added++;return Reflect.apply(add, this, args); };
  abort.signal.removeEventListener = function(...args) { removed++;return Reflect.apply(remove, this, args); };
  intercept(t, (worker, message, post) => {
    if (message.kind === 'cancel') cancels.push(message.id);
    if (isValidation(message)) {
      counted = view[0];const emit = worker.emit;
      worker.emit = function(event, response, ...rest) {
        if (event === 'message' && response.id === message.id) {
          worker.emit = emit;incoming = response;deliver = () => Reflect.apply(emit, worker, [event, response, ...rest]);return true;
        }
        return Reflect.apply(emit, this, [event, response, ...rest]);
      };
    }
    return post();
  });
  const pending = turn.validate(input, s.token, { signal: abort.signal });
  await until(() => incoming, 'held validation reply');
  abort.abort();const sent = cancels.length;
  deliver();const result = await guard(pending, 'cancelled validation');
  await until(() => view[0] === 0, 'cancelled validation settlement');
  assert.equal(sent, 1, 'abort listener sends cancellation immediately');assert.equal(result.error?.code, 'read_cancelled');
  assert.equal(counted, 1);assert.equal(added, 1);assert.equal(removed, 1);assert.equal(view[0], 0);
  abort.abort();assert.equal(cancels.length, 1);
});

test('cancellation during reply detach wins over a successful validation reply', async t => {
  const { s, input, turn, view } = await validation(t), abort = new AbortController();
  const remove = abort.signal.removeEventListener;let detached = 0, counted;
  // Abort after the listener was removed: only the shared reply re-check can
  // reject this reply. There is deliberately no abort callback left to run.
  abort.signal.removeEventListener = function(...args) {
    const result = Reflect.apply(remove, this, args);detached++;abort.abort();return result;
  };
  intercept(t, (_worker, message, post) => { if (isValidation(message)) counted = view[0];return post(); });
  const result = await guard(turn.validate(input, s.token, { signal: abort.signal }), 'reply-race validation');
  await until(() => view[0] === 0, 'reply-race settlement');
  assert.equal(detached, 1);assert.equal(abort.signal.aborted, true);
  assert.equal(result.error?.code, 'read_cancelled');assert.equal(counted, 1);assert.equal(view[0], 0);
});

test('private validation failed post rolls back count and abort listener', async t => {
  const { s, input, turn, view } = await validation(t), abort = new AbortController();let removed = 0;
  const remove = abort.signal.removeEventListener;
  abort.signal.removeEventListener = function(...args) { removed++;return Reflect.apply(remove, this, args); };
  intercept(t, (_worker, message, post) => {
    if (isValidation(message)) { assert.equal(view[0], 1);throw Object.assign(Error('synthetic post refusal'), { code: 'reader_failed' }); }
    return post();
  });
  const result = await guard(turn.validate(input, s.token, { signal: abort.signal }), 'failed validation post');
  assert.equal(result.error.code, 'reader_failed');assert.equal(view[0], 0);assert.equal(removed, 1);
});

test('abort during validation ledger work retains the count until handler settlement', async t => {
  const turnControl = new SharedArrayBuffer(64), state = new Int32Array(turnControl);
  const { s, input, turn, view } = await validation(t, {
    coordinatorHost: new URL('./fixtures/semantic-turn-host.mjs', import.meta.url).href,
    coordinatorConfiguration: { turnControl },
  });
  const release = () => { Atomics.store(state, 6, 1);Atomics.notify(state, 6); };
  s.f.workspace.defer(release);
  const abort = new AbortController();let replies = 0, cancels = 0;
  intercept(t, (worker, message, post) => {
    if (message.kind === 'cancel') cancels++;
    if (isValidation(message)) {
      const received = response => {
        if (response.id !== message.id) return;
        replies++;worker.off('message', received);
      };
      worker.on('message', received);
    }
    return post();
  });
  Atomics.store(state, 4, 2);
  const pending = turn.validate(input, s.token, { signal: abort.signal });
  let held, cancelled, sent;
  try {
    await until(() => state[5] === 1, 'validation ledger entered');
    assert.equal(view[0], 1, 'handler owns the outstanding count');assert.equal(replies, 0);
    abort.abort();held = view[0];sent = cancels;
    // Bounded microtask race: a missing abort listener cannot hang this probe.
    cancelled = await Promise.race([pending, Promise.resolve(null)]);
  } finally { release(); }
  await guard(pending, 'validation after ledger release');
  await until(() => view[0] === 0 && replies === 1, 'cancelled handler settlement');
  assert.equal(held, 1, 'abort resolves the API without settling ledger work');
  assert.equal(sent, 1);assert.equal(cancelled?.error?.code, 'read_cancelled');assert.equal(view[0], 0);
});
