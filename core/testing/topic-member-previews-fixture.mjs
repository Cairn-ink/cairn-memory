import assert from 'node:assert/strict';
import { createTopicTokens } from '../topic-snapshot.mjs';
import { createTopicMemberReader } from '../topic-members-reader.mjs';
import { createTopicPreviewReader } from '../topic-member-previews-reader.mjs';
import { createTopicMembersStorage } from '../topic-members-storage.mjs';
import { createTopicOverviewStorage } from '../topic-overview-storage.mjs';
import { createPreviewStorage } from '../topic-member-previews-storage.mjs';
import { membersInput } from '../topic-members-input.mjs';
import { namespace, ok } from './topic-members-fixture.mjs';
export const previews = { version: 'topic-member-previews-v1' };
export const base = { namespace, selection: { type: 'unfiled' }, accessRevision: 'preview-access', previews };
export function controlledPreviews(f, hooks = {}) {
  let time = 100, active = false, state, observations = [], transactions = 0;
  const meta = createTopicOverviewStorage(f.db), storage = createTopicMembersStorage(f.db), native = createPreviewStorage(f.db);
  const tokens = createTopicTokens({ now: () => time });
  const options = { storage, previewStorage: { setup: native.setup, source(row, request) {
    assert.ok(active); hooks.beforeSource?.(row); return native.source(row, request);
  } }, snapshot(ns) { hooks.onFence?.(++transactions); return meta.snapshot(ns); },
    transaction(work) {
      assert.equal(active, false); active = true; f.db.exec('BEGIN');
      try { const value = work(); f.db.exec('COMMIT'); return value; }
      catch (e) { f.db.exec('ROLLBACK'); throw e; } finally { active = false; }
    }, tokens, originBinding: (ns, captured) => ({ ns, captured }), now: () => time,
    observe(value) { observations.push(value); hooks.observe?.(value); },
    async yieldQuantum() { assert.equal(active, false); await hooks.onYield?.(); },
    prepare() {}, accept() {}, inspect(value) { state = value; }, ...hooks.overrides };
  const engine = hooks.wrapper ? createTopicMemberReader(options) : createTopicPreviewReader(options);
  return { storage, tokens, options, engine, get state() { return state; }, get observations() { return observations; },
    setTime(value) { time = value; }, reset() { observations = []; },
    read: (input = {}, deadline) => engine.read(membersInput({ ...base, ...input }, namespace.ownerId), deadline) };
}
export async function collectPreviews(reader, input = {}, check = () => {}) {
  let cursor; const items = [], pages = [];
  for (let i = 0; i < 10000; i++) {
    const result = typeof reader === 'function' ? await reader({ ...input, ...(cursor ? { cursor } : {}) }) :
      await reader.readTopicMembers({ ...base, ...input, ...(cursor ? { cursor } : {}) });
    const page = ok(result); check(page); pages.push(page); items.push(...page.items);
    if (!page.nextCursor) { assert.equal(page.coverage.complete, true); return { items, pages }; }
    cursor = page.nextCursor;
  }
  assert.fail('no finite preview progress');
}
