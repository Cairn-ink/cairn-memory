import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../../../../core/index.mjs';
import { attestContentSafety } from '../../../../core/content-safety-schema.mjs';
import { migrateReceiptEventTime, migrateCardLineage } from '../../../../core/content-safety-migration.mjs';
import { copySqliteFixture, safetyFixture, quiescence } from '../../../../core/testing/content-safety-s2h-fixture.mjs';
import { localPlainPort } from '../../../../core/testing/raw-capture-fixtures.mjs';
import { rationaleModel } from '../../../../core/testing/rationale-model.mjs';
import { interpretation } from '../../../../core/testing/episode-capture-helpers.mjs';
import { createScopedCardAccess } from '../../../mcp/private-card-access.mjs';
import { fixture, ok } from './workspace.mjs';

export { ok };
export const forgottenText = 'forgetneedle synthetic victim';
export const stepText = 'stepneedle review forgotten evidence';
export const neighbourStep = 'neighbourstep review nearby evidence';
export const otherStep = 'independentstep review retained evidence';
export const range = { since: '1900-01-01T00:00:00.000Z', until: '2100-01-01T00:00:00.000Z', limit: 50 };
export function sql(path, work) {
  const db = new DatabaseSync(path);
  try { return work(db); } finally { db.close(); }
}
export async function setup(t, options = {}) {
  const f = fixture(t, { client: 'codex' });
  await f.core.close();
  let path = f.databasePath;
  if (options.layout !== 29) {
    const older = safetyFixture(t, 33); path = older.path;
    if (options.layout === 48) await older.migrate();
    if (options.layout === 53) {
      copySqliteFixture(path, older.backupPath);
      await (options.cardLineage ? migrateCardLineage : migrateReceiptEventTime)({ path, backupPath: older.backupPath,
        expected: { storeId: older.storeId, base: 33 }, quiescence });
    }
  }
  const namespace = f.namespace, client = f.client;
  const control = openMemoryCore({ path, rawConversations: { mode: 'off', readPolicy: () => ({ generation: 'synthetic', reason: null }) } });
  let authority;
  try {
    const current = ok(control.getLocalCaptureControl({ namespace, client }));
    const granted = ok(control.setLocalCaptureControl({ namespace, client, targetId: 'synthetic-oneshot',
      expectedStoreId: current.storeId, expectedRevision: current.revision, automaticCaptureEnabled: true, rawNoticeVersion: 'local-plain-v1' }));
    authority = { version: 'local-capture-authority-v1', targetId: granted.targetId, storeId: granted.storeId, namespace, client,
      expectedControlRevision: granted.revision, expectedConsentGeneration: granted.consentGeneration,
      expectedNamespaceGeneration: ok(control.getCaptureControl({ namespace })).generation,
      expectedRawRevision: ok(control.getRawCaptureControl({ ownerId: namespace.ownerId, client })).revision };
  } finally { await control.close(); }
  const base = rationaleModel();
  const model = { ...base,
    extract: ({ input }) => ({ items: input.messages.flatMap(message => {
      const labels = message.content.includes('[PAIR]') ? ['victim', 'survivor'] :
        message.content.includes('[VICTIM]') ? ['victim'] : message.content.includes('[SURVIVOR]') ? ['survivor'] :
        message.content.includes('[OTHER]') ? ['other'] : [];
      return labels.map(label => ({ content: label === 'victim' ? forgottenText : 'synthetic retained ' + label,
        kind: 'context', confidence: 0.7, sourceIndices: [message.index] }));
    }) }),
    interpretEpisode(request) {
      const result = interpretation(request), text = request.input.sources[0].text;
      const field = value => ({ value, anchors: [{ sourceIndex: 0, start: 0, end: text.length }] });
      return { ...result, gist: field(text), nextStep: field(text.includes('independent') ? otherStep : text.includes('neighbour') ? neighbourStep : stepText) };
    },
    select: ({ input }) => ({ refs: input.maps.flatMap(map => map.items.flatMap(item => {
      const ref = item.type === 'unfiled' ? item.ref : item.type === 'ref' && item.ref.childType === 'memory'
        ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
      return ref ? [{ namespaceIndex: map.namespaceIndex, ...ref }] : [];
    })).slice(0, input.maxRefs) }),
  };
  const config = { path, model, captureQualification: 'source-bound-v2', captureDeadlineMs: f.config.timeouts.captureMs,
    rawConversations: { mode: 'raw-v1', capBytes: f.config.raw.capBytes, configureCap: false,
      port: localPlainPort(), readPolicy: () => ({ generation: 'local-capture-v1', reason: null }), localAuthority: authority } };
  async function capture(sessionId, eventId, content, ordinal, offset = 0, episode = false) {
    const core = openMemoryCore({ ...config, ...(episode ? { captureEvidence: 'staged-v1',
      sessionEpisodes: { mode: 'episode-v1', draftEveryBatches: 2 } } : {}) });
    try {
      const request = f.request(eventId, content, ordinal);
      const value = ok(await core.captureRaw({ namespace, client, sessionId, eventId,
        messages: request.messages.map(message => ({ id: message.id, role: message.role, content: message.content,
          occurredAt: new Date(Date.now() + offset).toISOString(), messageOrdinal: ordinal, part: { ...message.part } })),
        ...(episode ? { episodeContext: { clientLabel: 'Synthetic client', generation: 'initial', origin: 'ordinary' } } : {}) }));
      ok(value.interpretation);
    } finally { await core.close(); }
  }
  if (options.differentMessages) {
    await capture('target', 'victim', '[VICTIM] ' + forgottenText, 1);
    await capture('target', 'survivor', '[SURVIVOR] retained evidence', 2);
  } else await capture('target', 'pair', '[PAIR] ' + forgottenText, 1);
  await capture('unrelated', 'other', '[OTHER] independent evidence', 1, -2 * 86400000);
  for (const session of options.noEpisodes ? [] : options.episodeOtherOnly ? ['independent'] : ['target', 'independent']) {
    for (const ordinal of [3, 4]) await capture(session, session + '-episode-' + ordinal,
      session === 'target' ? forgottenText + ' episode evidence' : 'independent episode evidence', ordinal,
      session === 'target' ? 0 : -3 * 86400000, true);
  }
  if (options.neighbour) for (const ordinal of [3, 4])
    await capture('neighbour', 'neighbour-' + ordinal, 'neighbour episode evidence', ordinal, 0, true);
  const state = sql(path, db => {
    const memories = db.prepare('SELECT * FROM memories WHERE deleted=0').all();
    const episodes = db.prepare('SELECT * FROM session_episodes WHERE deleted=0').all();
    const target = memories.find(row => row.content === forgottenText);
    assert.ok(target, 'the victim was captured');
    const targetReceipt = db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(target.id);
    const conversation = db.prepare(`SELECT c.* FROM raw_receipt_lineage l JOIN raw_conversations c ON c.id=l.conversation_id
      WHERE l.receipt_id=?`).get(targetReceipt.id);
    return { target, targetReceipt, conversation, episodes, layout: attestContentSafety(db) };
  });
  const cards = createScopedCardAccess(namespace, { actorId: 'synthetic-test' });
  const openReader = () => openMemoryCore({ ...config, privateCards: cards.configuration, rawSearch: false });
  let core = openReader();
  f.workspace.defer(async () => { cards.revoke(); await core.close(); });
  const cardIds = {};
  // Match the recording probe's real retained-receipt Card contributors.
  for (const label of ['survivor', 'other']) {
    const memory = sql(path, db => db.prepare('SELECT * FROM memories WHERE content=? AND deleted=0').get('synthetic retained ' + label));
    cardIds[label] = ok(await cards.call(core, 'createCardDraft', { actionId: 'draft-' + label, drafting: 'authored',
      input: { sourcePolicy: 'retained-receipts-v1', memoryRefs: [{ type: 'memory', namespace, memoryId: memory.id, revision: memory.revision }],
        title: 'Synthetic retained Card', body: 'Synthetic authored body.' } })).id;
  }
  return { ...f, ...state, path, config, model, cards, cardIds, get core() { return core; },
    async reopen() { await core.close(); core = openReader(); },
    async close() { await core.close(); },
    act(operation) {
      const input = { namespace, memoryId: state.target.id, expectedRevision: state.target.revision };
      return core[operation]({ ...input, ...(operation === 'correct' ? { content: 'synthetic corrected replacement', kind: 'context',
        receipt: { client: 'cairn-local-mcp', sessionId: 'explicit-tool', eventId: 'correction', role: 'user', excerpt: 'Explicit replacement.' } } : {}) });
    } };
}
