import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { openMemoryCore } from '../contract.mjs';
import { openDatabase, STORAGE_BUSY_TIMEOUT_MS } from '../database.mjs';
import { cardHost } from '../testing/raw-source-fixtures.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

export const ns = { ownerId: 'synthetic-private-owner', scope: 'personal', projectId: null };
export const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
export const refusal = { ok: false, error: { code: 'content_safety_preflight_refused', retryable: false } };
export const receipt = (key = 'source') => ({ client: 'synthetic', sessionId: 'synthetic-session-secret',
  eventId: key, role: 'user', excerpt: 'Synthetic source text never disclosed.' });
export function fixture(t, version = 23, options = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'content-safety-' }), path = join(workspace.path, 'store.sqlite');
  const db = openDatabase(path, { privateCards: version !== 18, currentDependencies: version === 33 });
  db.exec(`PRAGMA busy_timeout=${STORAGE_BUSY_TIMEOUT_MS}`);
  const host = cardHost();
  const core = openMemoryCore({ path, ...(version !== 18 ? { privateCards: host.options } : {}), ...options });
  let closed = false, serial = 0;
  const f = { workspace, path, db, core,
    call: (method, input) => host.call(core, method, input),
    close() { if (!closed) { core.close(); db.close(); closed = true; } },
    admit(namespace = ns, label = String(++serial)) {
      return ok(core.admit({ namespace, memory: { content: `Synthetic memory secret ${label}.`, kind: 'context' }, receipts: [receipt(label)] })).memory;
    },
    draft(namespace = ns, memories, confirm = false) {
      const input = { title: 'Synthetic private title secret.', body: 'Synthetic private body secret.',
        ...(memories ? { sourcePolicy: 'retained-receipts-v1', memoryRefs: memories.map(memory => ({ type: 'memory', namespace, memoryId: memory.id, revision: memory.revision })) }
          : { authoredInput: { text: 'Synthetic authoredInput secret.', occurredAt: null } }) };
      const draft = ok(f.call('createCardDraft', { namespace, actionId: 'draft-' + (++serial), drafting: 'authored', input }));
      return confirm ? ok(f.call('confirmCardDraft', { namespace, cardId: draft.id, expectedRevision: draft.revision, actionId: 'confirm-' + (++serial) })) : draft;
    },
  };
  workspace.defer(() => f.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, version);
  return f;
}

// Independent implementation: hash complete bytes, using stat rather than the
// production child's streaming/fstat implementation. All data fds stay in child.
export function independentFiles(path) {
  const source = `import {readFileSync,statSync,existsSync} from 'node:fs'; import {createHash} from 'node:crypto';
    const path=process.argv[1]; console.log(JSON.stringify(['','-wal','-journal','-shm'].map(s=>{
      if(!existsSync(path+s))return {present:false}; const x=statSync(path+s,{bigint:true});
      return {present:true,dev:String(x.dev),ino:String(x.ino),size:String(x.size),sha256:createHash('sha256').update(readFileSync(path+s)).digest('hex')};})));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source, path], { encoding: 'utf8', env: {}, timeout: 10000 });
  assert.equal(child.error, undefined); assert.equal(child.status, 0); assert.equal(child.stderr, '');
  return JSON.parse(child.stdout);
}
