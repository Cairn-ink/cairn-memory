import assert from 'node:assert/strict';
import { beginContentWriteSafety } from '../../../../core/content-write-safety.mjs';
import { registerContentWriteGuard } from '../../../../core/content-write-context.mjs';
import { contentReadSafety } from '../../../../core/content-safety.mjs';
import { attestContentSafety } from '../../../../core/content-safety-schema.mjs';
import { setup, sql, ok, range, forgottenText } from './forget-episode.mjs';

export { sql, ok, forgottenText };
export const layouts = [{ layout: 29 }, { layout: 33 }, { layout: 48 }, { layout: 53 }, { layout: 53, cardLineage: true }];
export const label = o => o.layout + (o.cardLineage ? ' lineage' : o.layout === 53 ? ' event time' : '');
export const callerText = 'Fresh lunar atlas entry.';
export const callerReceipt = { client: 'cairn-local-mcp', sessionId: 'explicit-tool', eventId: 'fresh-replacement',
  role: 'user', excerpt: 'A caller supplied replacement.' };
const encode = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) :
  item instanceof Uint8Array ? { base64: Buffer.from(item).toString('base64'), hex: Buffer.from(item).toString('hex') } : item);
export function noEcho(value, needles) {
  const text = encode(value);
  for (const needle of needles) for (const form of [needle, JSON.stringify(needle).slice(1, -1),
    Buffer.from(needle).toString('base64'), Buffer.from(needle).toString('hex')])
    assert.equal(text.includes(form), false, 'whole value must withhold ' + needle);
}
export function rows(f, connection) {
  const read = db => Object.fromEntries(db.prepare(`SELECT name FROM sqlite_schema
    WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map(({ name }) =>
    [name, db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all().map(encode).sort()]));
  return connection ? read(connection) : sql(f.path, read);
}
export function writtenRows(before, after) {
  return Object.fromEntries(Object.entries(after).flatMap(([table, values]) => {
    const previous = new Set(before[table] ?? []), added = values.filter(value => !previous.has(value));
    return added.length ? [[table, added.map(value => JSON.parse(value))]] : [];
  }));
}
export async function paired(t, options, operation) {
  const f = await setup(t, { ...options, noEpisodes: true, noCards: true });
  const survivor = sql(f.path, db => db.prepare("SELECT * FROM memories WHERE content='synthetic retained survivor' AND deleted=0").get());
  assert.ok(survivor, 'a same-message sibling exists');
  const receipt = sql(f.path, db => db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(survivor.id));
  const needles = [forgottenText, 'forgetneedle', receipt.excerpt, 'synthetic source evidence', survivor.content];
  for (const needle of needles) assert.equal((callerText + callerReceipt.excerpt).includes(needle), false, 'caller text is disjoint from withheld state');
  if (operation) ok(await f.act(operation));
  sql(f.path, db => {
    attestContentSafety(db);
    const decision = contentReadSafety(db, { namespace: f.namespace, intent: 'history',
      ref: { type: 'memory', namespace: f.namespace, memoryId: survivor.id, revision: survivor.revision } });
    assert.deepEqual(decision, operation && options.layout >= 48 ? { allowed: false,
      reason: operation === 'forget' ? 'user_forget' : 'correction_supersession' } : { allowed: true });
  });
  return { ...f, get core() { return f.core; }, survivor, receipt, needles };
}
export const correction = (f, content = callerText, patch = {}) => ({ namespace: f.namespace,
  memoryId: f.survivor.id, expectedRevision: f.survivor.revision, content, kind: 'context', receipt: callerReceipt, ...patch });
export async function correctAndScan(t, f, content = callerText, containsSpan = false) {
  const before = rows(f); let validations = 0, staged;
  registerContentWriteGuard((db, context) => {
    const state = beginContentWriteSafety(db, context);
    if (!state) return state;
    return { ...state, validate(result) {
      state.validate(result); // The real, unchanged guard must accept while the old span fact still exists.
      if (context.method === 'correct') { validations++; staged = rows(f, db); }
    } };
  });
  let result;
  try { result = await f.core.correct(correction(f, content)); }
  finally { registerContentWriteGuard(beginContentWriteSafety); }
  const needles = containsSpan ? [forgottenText, 'forgetneedle', f.survivor.content] : f.needles;
  noEcho(result, needles);
  const after = rows(f), written = writtenRows(before, after);
  noEcho(written, needles);
  if (staged) noEcho(writtenRows(before, staged), needles);
  assert.equal(result.ok, true, 'the survivor correction must commit: ' + JSON.stringify(result));
  if (f.layout.suppressionRevision) assert.equal(validations, 1, 'unchanged commit guard accepted the direct correction');
  const memory = ok(result).memory;
  assert.equal(memory.content, content);
  assert.equal(memory.revision, f.survivor.revision + 1);
  assert.deepEqual(sql(f.path, db => db.prepare('SELECT excerpt FROM receipts WHERE memory_id=?').all(memory.id)).map(row => row.excerpt), [callerReceipt.excerpt]);
  if (containsSpan) {
    // Only caller-supplied content may contain the span; every other written field is scanned.
    const remainder = structuredClone(written);
    assert.equal(remainder.memories.length, 1);
    assert.equal(remainder.memories[0].content, content);
    delete remainder.memories[0].content;
    noEcho(remainder, [f.receipt.excerpt, 'synthetic source evidence']);
    const acknowledgement = structuredClone(result);
    delete acknowledgement.value.memory.content;
    noEcho(acknowledgement, [f.receipt.excerpt, 'synthetic source evidence']);
  }
  t.diagnostic('CORRECTION_WRITES ' + JSON.stringify(Object.fromEntries(Object.entries(written).map(([table, values]) => [table, values.length]))));
  return memory;
}
export async function readAndScan(f, memory, needles = f.needles) {
  const namespace = f.namespace;
  const reads = [
    () => f.core.get({ namespace, memoryId: memory.id }),
    () => f.core.list({ namespace, limit: 50 }),
    () => f.core.fetch({ namespace, refs: [{ memoryId: memory.id, revision: memory.revision }] }),
    () => f.core.map({ namespace }),
    ...['event', 'receipt'].map(timeBasis => () => f.core.listEpisodes({ namespace, ...range, timeBasis })),
    ...[{}, { includeQualification: true }, { contextMode: 'rationale-evidence' }, { contextMode: 'source-evidence' }]
      .map(extra => () => f.core.recall({ readSet: [namespace], query: 'lunar', limit: 12, ...extra })),
    ...[{ nextSteps: true, procedural: false }, { nextSteps: true, procedural: true, background: true }]
      .map(groups => () => f.core.sessionStartContext({ namespace, groups, maxChars: 8000, maxTokens: 2000 })),
  ];
  for (const read of reads) { const result = await read(); noEcho(result, needles); ok(result); }
}
