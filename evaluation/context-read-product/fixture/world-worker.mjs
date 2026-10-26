// Fixture executable only. No application imports until deterministic entropy is installed.
import assert from 'node:assert/strict';
import crypto, { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { existsSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { parameters, seed as frozenSeed, namespaces, key, fit, bodyUnits, memoryContent, cardContent, receipts } from './content.mjs';

const options = JSON.parse(process.argv[2]);
const { path, world, schema } = options;
assert.ok(parameters.worlds[world] && parameters.schemas.includes(schema));
assert.equal(existsSync(path), false, 'refuse to overwrite a store');
const selectedSeed = options.seed ?? frozenSeed.seed;
let domain = 'bootstrap', sequence = 0;
const hash = value => createHash('sha256').update(value).digest('hex');
function entropy(size) {
  const blocks = [];
  while (Buffer.concat(blocks).length < size) blocks.push(createHash('sha256')
    .update(JSON.stringify([selectedSeed, domain, sequence++])).digest());
  return Buffer.concat(blocks).subarray(0, size);
}
crypto.randomBytes = size => entropy(size);
crypto.randomUUID = () => {
  const bytes = entropy(16); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
// Fast ordinary verification uses the public :memory: opener. Capture its connection
// solely for read-only physical assertions before public close; no SQL write bypass.
let memoryConnection;
if (options.inMemory) {
  const sqlite = (await import('node:sqlite')).default;
  const nativePrepare = sqlite.DatabaseSync.prototype.prepare;
  sqlite.DatabaseSync.prototype.prepare = function (...args) {
    memoryConnection ??= this;
    return Reflect.apply(nativePrepare, this, args);
  };
}
syncBuiltinESMExports();
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [frozenSeed.epoch])); }
  static now() { return RealDate.parse(frozenSeed.epoch); }
};
const { openMemoryCore } = await import('../../../core/contract.mjs');
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const tokens = new WeakMap(), grants = new WeakMap();
const authority = {
  authorize(request, token) {
    const expected = tokens.get(token);
    if (!expected || expected.method !== request.method || !isDeepStrictEqual(expected.input, request.input)) return null;
    const grant = {}, { input, ...binding } = request; grants.set(grant, binding); return grant;
  },
  isCurrent: grant => grants.has(grant) ? { ...grants.get(grant), accessGeneration: 1 } : null,
};
const privateCards = { version: 'private-cards-local-v1', source: 'submitted-note-v1', storage: 'local-plain-v1',
  disclosure: 'explicit-submitted-note-v1', authority,
  ...(schema === 33 ? { currentDependencies: { version: 'card-current-dependencies-v1' } } : {}) };
const core = openMemoryCore({ path: options.inMemory ? ':memory:' : path, ...(schema >= 23 ? { privateCards } : {}),
  ...(schema === 33 ? { methodPackages: { version: 'method-packages-local-v1', storage: 'local-plain-v1', authority } } : {}) });
function call(label, method, input, card = false) {
  domain = label; sequence = 0;
  const token = {}; if (card) tokens.set(token, { method, input: structuredClone(input) });
  return ok(core[method](input, ...(card ? [token] : [])));
}
const records = [], mocs = [], links = [];
let physical;
function inspect(db) {
  const result = { schema: db.prepare('PRAGMA user_version').get().user_version,
    memories: db.prepare('SELECT count(*) AS n FROM memories').get().n,
    mocs: db.prepare('SELECT count(*) AS n FROM mocs').get().n,
    cards: schema >= 23 ? db.prepare('SELECT count(*) AS n FROM private_cards').get().n : 0 };
  assert.equal(result.schema, schema); assert.equal(result.memories, parameters.worlds[world].memories);
  assert.equal(result.mocs, parameters.worlds[world].mocs);
  assert.equal(result.cards, schema === 18 ? 0 : parameters.worlds[world].cards);
  return result;
}
try {
  for (let c = 0; c < parameters.worlds[world].cohorts; c++) {
    for (let n = 0; n < 4; n++) {
      const namespace = namespaces[n], local = []; let epoch;
      const admit = (i, previous) => {
        const logicalKey = key(c, n, 'm', i), content = memoryContent(c, n, i), proof = receipts(c, n, i);
        const saved = previous ? call(logicalKey, 'supersede', { namespace, memoryId: previous.id,
          expectedRevision: previous.revision, replacement: { content: content.submitted, kind: 'decision' }, receipts: proof })
          : call(logicalKey, 'admit', { namespace, memory: { content: content.submitted,
            kind: content.groundTruth?.adoptionStatus ? 'decision' : ['fact', 'preference', 'decision', 'instruction', 'context'][i % 5] }, receipts: proof });
        epoch = saved.indexRevision;
        const row = { logicalKey, type: 'memory', namespace, id: saved.memory.id, revision: saved.memory.revision,
          bodyRevision: 0, truth: content.truth.normalize('NFKC'), expectedUnits: bodyUnits('m', i),
          ...(content.groundTruth ? { groundTruth: content.groundTruth } : {}),
          submittedLeadingWhitespace: /^\s/.test(content.submitted),
          currentness: previous ? 'current' : i < 3 ? 'historical' : 'current' };
        local.push(row); records.push(row); return row;
      };
      for (let i = 0; i < 275; i++) admit(i);
      for (let i = 0; i < 3; i++) {
        const replacement = admit(275 + i, local[i]);
        links.push({ previous: local[i].logicalKey, replacement: replacement.logicalKey });
      }
      const roots = [], children = [];
      const place = (label, items) => {
        const value = call(label, 'applyPlacement', { namespace, expectedIndexRevision: epoch,
          expectedMemoryRevisions: items.map(item => ({ memoryId: item.memoryId,
            revision: ok(core.get({ namespace, memoryId: item.memoryId })).memory.revision })), proposal: { items } });
        epoch = value.indexRevision;
        for (const moc of value.createdMocs) mocs.push({ cohort: c, namespace, ...moc });
        for (const ref of value.refs) {
          const parent = mocs.find(row => row.id === ref.parentId); if (parent) parent.revision = ref.parentRevision;
          const child = ref.childType === 'moc' && mocs.find(row => row.id === ref.childId); if (child) child.revision = ref.childRevision;
        }
        return value;
      };
      const active = local.filter(row => row.currentness === 'current');
      for (let i = 0; i < 15; i++) {
        const newRoot = i < parameters.perNamespacePerCohort.l2ByNamespace[n];
        const value = place(`c${c}/n${n}/topic${i}`, [{ memoryId: active[i].id, parentIds: [], newL1: {
          title: `合成主題 ${c}-${n}-${i}`, parentL2Ids: newRoot ? [] : [roots[i % roots.length]],
          ...(newRoot ? { newL2Title: `合成領域 ${c}-${n}-${i}` } : {}) } }]);
        children.push(value.createdMocs.find(row => row.level === 'L1').id);
        const root = value.createdMocs.find(row => row.level === 'L2'); if (root) roots.push(root.id);
      }
      epoch = call(`c${c}/n${n}/shared-topic`, 'linkMocs', { namespace, expectedIndexRevision: epoch,
        parentId: roots[1], expectedParentRevision: mocs.find(row => row.id === roots[1]).revision,
        childId: children[0], expectedChildRevision: mocs.find(row => row.id === children[0]).revision }).indexRevision;
      for (let start = 15; start < active.length; start += 5) {
        const batch = active.slice(start, start + 5).filter((row, offset) => (start + offset) % 9 !== 0);
        if (batch.length) place(`c${c}/n${n}/place${start}`, batch.map((row, offset) => ({ memoryId: row.id,
          parentIds: [children[(start + offset) % 15], children[(start + offset + 4) % 15]] })));
      }
      if (schema >= 23) for (let i = 0; i < 24; i++) {
        const logicalKey = key(c, n, 'k', i), content = cardContent(c, n, i);
        const noteText = fit(`合成來源 ${c}/${n}/${i}：${content.truth}`,
          parameters.perNamespacePerCohort.sourceNoteUnitsCycle[i % 4]);
        const draft = call(logicalKey, 'createCardDraft', { namespace, actionId: logicalKey + '-draft', drafting: 'authored',
          input: { title: `合成知識卡 ${c}-${n}-${i}`, body: content.submitted,
            authoredInput: { text: noteText, occurredAt: null } } }, true);
        call(logicalKey + '-confirm', 'confirmCardDraft', { namespace, cardId: draft.id, expectedRevision: draft.revision,
          actionId: logicalKey + '-confirm', applicability: 'current' }, true);
        records.push({ logicalKey, type: 'card', namespace, id: draft.id, truth: content.truth,
          ...(content.groundTruth ? { groundTruth: content.groundTruth } : {}),
          expectedUnits: bodyUnits('k', i), currentness: 'current', submittedLeadingWhitespace: /^\s/.test(content.submitted) });
      }
      appendFileSync(options.progressPath, JSON.stringify({ fixture: world, schema, cohort: c, namespace: n, complete: true }) + '\n', { mode: 0o600 });
    }
  }
  // Public inspection supplies final revisions, canonical bodies and receipt lengths.
  for (const row of records) {
    const value = row.type === 'memory' ? ok(core.get({ namespace: row.namespace, memoryId: row.id }))
      : call('inspect', 'getCard', { namespace: row.namespace, cardId: row.id, responseByteLimit: 65536 }, true);
    const item = value.memory ?? value.card, body = item.content ?? item.body;
    row.revision = item.revision; row.bodyRevision = item.bodyRevision ?? 0;
    row.bodyUnits = body.length; row.bodyBytes = Buffer.byteLength(body); row.bodySha256 = hash(body);
    row.storedLeadingWhitespace = /^\s/.test(body); row.hasZWJ = body.includes('\u200d');
    row.hasCombiningMark = /\p{M}/u.test(body);
    assert.equal(body.length, row.expectedUnits, row.logicalKey);
    if (row.type === 'memory') {
      row.receipts = value.receipts.map(r => ({ id: r.id, units: r.excerpt.length,
        bytes: Buffer.byteLength(r.excerpt), sha256: hash(r.excerpt), role: r.role }));
      assert.equal(item.state, row.currentness === 'historical' ? 'historical' : 'active');
    } else {
      assert.equal(item.state, 'confirmed'); assert.equal(item.support.status, 'eligible');
      assert.equal(item.support.applicability, 'current');
      row.sourceNoteUnits = parameters.perNamespacePerCohort.sourceNoteUnitsCycle[Number(row.logicalKey.split('k')[1]) % 4];
    }
  }
  if (options.inMemory) physical = inspect(memoryConnection);
} finally { ok(core.close()); }
// Read-only physical attestation; no direct SQL writes or schema installers.
if (!options.inMemory) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path, { readOnly: true, timeout: 5000 });
  try { physical = inspect(db); } finally { db.close(); }
}
const logical = { version: parameters.version, seed: selectedSeed, world, namespaces, records, mocs, links };
writeFileSync(options.outputPath, JSON.stringify({ ...logical, logicalSha256: hash(JSON.stringify(logical)), physical,
  canonicalBytes: options.inMemory ? null : statSync(path).size }), { mode: 0o600, flag: 'wx' });
