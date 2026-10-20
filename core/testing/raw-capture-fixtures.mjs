import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { rationaleModel } from './rationale-model.mjs';
import { interpretation } from './episode-capture-helpers.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { localPlainPort, rawNamespace, rawRequest, splitRaw } from './raw-fixtures.mjs';

export { rawNamespace as ns, splitRaw, localPlainPort };
export const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
export const completed = result => ok(ok(result).interpretation);
export const config = kind => kind === 'episode' ? { captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1',
  sessionEpisodes: { mode: 'episode-v1', draftEveryBatches: 2 } }
  : kind === 'staged' ? { captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1' } : {};
export const request = (part, patch = {}, kind = 'ordinary') => rawRequest(part, {
  ...(kind === 'episode' ? { episodeContext: { clientLabel: 'Synthetic client', generation: 'initial', origin: 'ordinary' } } : {}), ...patch,
});
export function fixture(t, { kind = 'ordinary', model: overrides = {}, port = localPlainPort(), capBytes,
  policy = { generation: 'notice-1', reason: null }, coreOptions = {} } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'raw-capture-' }), path = join(workspace.path, 'store.sqlite');
  const calls = [];
  const base = { ...rationaleModel(), interpretEpisode: interpretation, ...overrides };
  const model = { ...base };
  for (const method of ['extract','qualifyCandidates','classify','interpretEpisode','reconcile']) {
    if (typeof base[method] === 'function') model[method] = async value => {
      calls.push({ method, input: structuredClone(value.input) });
      return base[method](value);
    };
  }
  let core;
  const reopen = () => {
    core?.close();
    core = openRawCaptureCore({ path, model, ...config(kind), ...coreOptions }, {
      mode: 'raw-v1', port, readPolicy: () => ({ ...policy }), ...(capBytes === undefined ? {} : { capBytes }),
    });
    return core;
  };
  reopen();
  workspace.defer(() => core.close());
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON');
  workspace.defer(() => db.close());
  return { path, db, calls, model, policy, workspace, reopen, get core() { return core; } };
}
export const count = (db, table) => db.prepare(`SELECT count(*) n FROM ${table}`).get().n;
export const usage = core => ok(core.getRawUsage({ ownerId: rawNamespace.ownerId }));
