// Synthetic state and fetch only; exercised in fresh processes to verify recovery
// after the reserving PID has actually exited, without clock-based coordination.
import assert from 'node:assert/strict';
import fsPromises, { readFile, writeFile, readdir } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createJsonPoster, hostedQuotaStatus, hostedTargetId } from '../../../../integrations/client/transport-hosted.mjs';
import { withWriteObserver } from '../../../../integrations/client/private-state.mjs';
import { startIfActive } from '../../../../integrations/client/control-state.mjs';
import { withFileLock } from '../../../../integrations/client/file-lock.mjs';

const [mode, root] = process.argv.slice(2);
const endpoint = 'https://synthetic.invalid';
const target = { root, targetId: hostedTargetId({ endpoint }) };
const statePath = join(root, 'hosted-quota', `${target.targetId}.json`);
if (mode === 'hold-quota-lock') {
  const release = new Promise(resolve => process.once('message', event => {
    assert.equal(event.kind, 'release'); resolve();
  }));
  assert.equal(await withFileLock(statePath + '.lock', async () => {
    process.send({ kind: 'lock-held' }); await release;
  }), true);
} else if (mode === 'recover') {
  const status = await hostedQuotaStatus(target);
  process.send({ kind: 'recovered', mode: status.operations.recall.mode });
} else {
  const controller = new AbortController();
  const reason = new Error('synthetic_cancelled');
  let command;
  const cancelled = new Promise(resolve => command = resolve);
  process.once('message', event => {
    assert.equal(event.kind, 'abort'); controller.abort(reason); command();
  });
  let attempts = 0;
  globalThis.fetch = async (_url, { signal }) => {
    attempts++;
    process.send({ kind: 'fetch-started' });
    return new Promise((resolve, reject) => {
      signal.throwIfAborted();
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  };
  const controlLock = join(root, 'control.lock');
  let unlock, holder, ownerBefore;
  const originalLink = fsPromises.link;
  if (mode === 'dispatch-lock') {
    let acquired;
    const ready = new Promise(resolve => acquired = resolve);
    const release = new Promise(resolve => unlock = resolve);
    holder = withFileLock(controlLock, async () => { acquired(); await release; });
    await ready; ownerBefore = await readFile(controlLock, 'utf8');
    fsPromises.link = async function (source, destination) {
      try { return await originalLink(source, destination); }
      catch (error) {
        if (destination === controlLock && error.code === 'EEXIST') {
          process.send({ kind: 'dispatch-wait' }); await cancelled;
        }
        throw error;
      }
    };
    syncBuiltinESMExports();
  }
  try {
    const post = createJsonPoster({ ...target, endpoint, token: 'synthetic-token' });
    const reply = await withWriteObserver(async ({ path }) => {
      if (path !== statePath) return;
      const state = JSON.parse(await readFile(path, 'utf8'));
      if (state.operations.recall.mode !== 'in_flight') return;
      process.send({ kind: 'reserved' });
      if (!['dispatch-lock', 'fetch-started'].includes(mode)) {
        await cancelled;
        if (mode === 'expired-before-fetch' || mode === 'successor') {
          if (mode === 'successor') state.operations.recall.attempt.token = randomUUID();
          else state.operations.recall.attempt.deadline = 0;
          await writeFile(path, JSON.stringify(state), { mode: 0o600 });
        }
      }
    }, () => post.reply('/api/memory/recall', { query: 'Synthetic question', limit: 6 },
      2000, undefined, controller.signal, async start => {
        if (mode !== 'dispatch-lock') return start();
        const dispatch = await startIfActive(root, 'initial', start, { signal: controller.signal });
        if (!dispatch.started) throw new Error('dispatch_not_started');
        return dispatch.operation;
      }));
    assert.equal(reply.status, 'unavailable');
    if (holder) {
      assert.equal(await readFile(controlLock, 'utf8'), ownerBefore);
      assert.equal((await readdir(root)).filter(name => name.startsWith('control.lock.owner-')).length, 1);
    }
    process.send({ kind: 'result', attempts,
      operation: JSON.parse(await readFile(statePath, 'utf8')).operations.recall });
  } finally {
    fsPromises.link = originalLink; syncBuiltinESMExports();
    unlock?.(); await holder;
  }
}
process.disconnect();
