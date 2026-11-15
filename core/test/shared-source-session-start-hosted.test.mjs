import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { migrateReceiptEventTime } from '../content-safety-migration.mjs';
import { copySqliteFixture, quiescence } from '../testing/content-safety-s2h-fixture.mjs';
import { lineageHost } from '../testing/card-lineage-fixture.mjs';
import { options as episodeOptions } from '../testing/episode-helpers.mjs';
import { interpretation } from '../testing/episode-capture-helpers.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

import { conforms, parseSessionStartResponse, utcInstant } from '../../plugins/cairn-memory/lib/hosted-contract.mjs';
import { HOSTED_SCHEMAS } from '../../plugins/cairn-memory/lib/hosted-schemas.mjs';

// Real production calls, synthetic stores, and a required local o200k tokenizer.
// No git history, test-module imports, model calls, or adapter-only bare imports.
const ns = { ownerId: 'synthetic', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const support = id => ({ client: 'synthetic', sessionId: 'synthetic-session-' + id,
  eventId: 'synthetic-event-' + id, role: 'user', excerpt: 'Synthetic support ' + id });
const deny = (f, ...needles) => { for (const needle of needles) f.tokenizer.needles.add(needle); };
const absent = (result, needles) => {
  for (const needle of needles) assert.equal(JSON.stringify(result).includes(needle), false, 'whole reply excludes ' + needle);
};

async function fixture(t, layout) {
  const { createContextCounter } = await import('../../adapters/openai/context-counter.mjs');
  const counter = await createContextCounter(); // Required: the core CI job installs this adapter.
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-01T00:00:00.000Z') });
  const ws = createTestWorkspace(t, { prefix: 'shared-session-hosted-' });
  const path = join(ws.path, 'store.sqlite'), host = lineageHost();
  const tokenizer = { reads: [], hostedInputs: [], active: null, needles: new Set() };
  const hostedCounter = { countTokens: text => {
    tokenizer.hostedInputs.push({ text, needles: [...tokenizer.needles] });
    return counter.countTokens(text);
  } };
  const model = { ...rationaleModel(), items: [], extract: () => ({ items: model.items }),
    interpretEpisode: interpretation, countTokens: text => { tokenizer.active?.texts.push(text); return counter.countTokens(text); } };
  // Scan every recorded input outside the engine's callback error mapping.
  t.after(() => {
    for (const { texts, needles } of tokenizer.reads) for (const text of texts) {
      for (const needle of needles) assert.equal(text.includes(needle), false, 'tokenizer input excludes a withheld needle');
    }
    for (const { text, needles } of tokenizer.hostedInputs) for (const needle of needles)
      assert.equal(text.includes(needle), false, 'hosted tokenizer input excludes a withheld needle');
  });
  // Match the production opener/seed/event-time migration; Card lineage stays off.
  const initial = openMemoryCore({ path, model, ...episodeOptions, ...(layout === 18 ? {} : {
    privateCards: { ...host.options, currentDependencies: { version: 'card-current-dependencies-v1' } },
    methodPackages: { version: 'method-packages-local-v1', storage: 'local-plain-v1', authority: host.options.authority },
  }) });
  try {
    ok(await initial.capture({ namespace: ns, client: 'synthetic', sessionId: 'synthetic-fixture-session',
      eventId: 'synthetic-fixture-episode', episodeContext: { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' },
      messages: [{ id: 'synthetic-fixture-message', role: 'user', content: 'Synthetic fixture Episode support',
        occurredAt: '2026-01-01T00:00:00.000Z' }] }));
  } finally { initial.close(); }
  if (layout === 53) {
    const inspect = new DatabaseSync(path);
    let storeId;
    try { storeId = inspect.prepare('SELECT store_id FROM store_metadata').get().store_id; }
    finally { inspect.close(); }
    const backupPath = join(ws.path, 'offline.sqlite');
    copySqliteFixture(path, backupPath);
    await migrateReceiptEventTime({ path, backupPath, expected: { storeId, base: 33 }, quiescence });
  }
  const db = new DatabaseSync(path); ws.defer(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, layout);
  if (layout === 53) {
    const control = db.prepare('SELECT * FROM content_safety_control').get();
    assert.equal(control.receipt_event_time, 1);
    assert.equal(control.card_lineage_revision, 0);
  }
  const core = openMemoryCore({ path, model, decisionReview: 'required-v1' }); ws.defer(() => core.close());
  return { core, model, tokenizer, counter: hostedCounter, db, path, ws, tick: () => t.mock.timers.tick(1) };
}

function admit(f, content, kind, receipts = [support(content)], procedural) {
  f.tick();
  return { ...ok(f.core.admit({ namespace: ns, memory: { content, kind }, receipts,
    ...(procedural ? { procedural } : {}) })).memory, content };
}
const rows = (f, memory) => f.db.prepare('SELECT * FROM receipts WHERE memory_id=? ORDER BY created_at,id').all(memory.id);
const projected = receipts => receipts.map(({ id, role, excerpt }) => ({ id, role, excerpt }));
const get = (f, memory) => ok(f.core.get({ namespace: ns, memoryId: memory.id, receiptLimit: 50,
  includeQualification: true }));
function withhold(f, memory, operation, address) {
  const old = rows(f, memory), input = { namespace: ns, memoryId: memory.id, expectedRevision: memory.revision };
  assert.equal(operation, 'forget');
  ok(f.core.forget(input));
  return [memory.content, memory.id, ...old.flatMap(row => [row.id, row.receipt_key, row.excerpt, row.session_id, row.event_id])];
}

// A diagnostic interpreter for the canonical schema's closed keyword set. The
// hosted parser independently validates its frozen copy and semantic invariants.
const canonical = JSON.parse(readFileSync(new URL('../../schemas/session-start-response.schema.json', import.meta.url), 'utf8'));
function schemaErrors(value, root = canonical) {
  const known = new Set(['$schema', '$id', '$defs', '$ref', 'title', 'description', 'default', 'type',
    'oneOf', 'anyOf', 'const', 'enum', 'required', 'properties', 'additionalProperties', 'minItems',
    'maxItems', 'items', 'minLength', 'maxLength', 'pattern', 'format', 'minimum', 'maximum']);
  function inventory(schema) {
    for (const [key, sub] of Object.entries(schema)) {
      assert.ok(known.has(key), 'unimplemented schema keyword: ' + key);
      if (key === 'properties' || key === '$defs') Object.values(sub).forEach(inventory);
      if (key === 'oneOf' || key === 'anyOf') sub.forEach(inventory);
      if (key === 'items') inventory(sub);
    }
  }
  inventory(root);
  const object = input => input !== null && typeof input === 'object' && !Array.isArray(input);
  function check(schema, input, path) {
    if (schema.$ref) return check(root.$defs[schema.$ref.slice('#/$defs/'.length)], input, path);
    const errors = [], error = keyword => errors.push({ path, keyword });
    for (const keyword of ['oneOf', 'anyOf']) if (schema[keyword]) {
      const branches = schema[keyword].map(branch => check(branch, input, path));
      const valid = branches.filter(branch => branch.length === 0).length;
      if (!valid) errors.push(...branches.reduce((best, branch) => branch.length < best.length ? branch : best));
      else if (keyword === 'oneOf' && valid !== 1) error(keyword);
    }
    if (Object.hasOwn(schema, 'const') && input !== schema.const) error('const');
    if (schema.enum && !schema.enum.includes(input)) error('enum');
    if (schema.type && ![schema.type].flat().some(type => ({ object: object(input), array: Array.isArray(input),
      null: input === null, string: typeof input === 'string', boolean: typeof input === 'boolean',
      integer: Number.isSafeInteger(input), number: typeof input === 'number' && Number.isFinite(input) })[type])) {
      error('type'); return errors;
    }
    if (object(input)) {
      for (const key of schema.required ?? []) if (!Object.hasOwn(input, key)) errors.push({ path: path + '/' + key, keyword: 'required' });
      for (const [key, sub] of Object.entries(input)) {
        if (Object.hasOwn(schema.properties ?? {}, key)) errors.push(...check(schema.properties[key], sub, path + '/' + key));
        else if (schema.additionalProperties === false) errors.push({ path: path + '/' + key, keyword: 'additionalProperties' });
      }
    }
    if (Array.isArray(input)) {
      if (input.length < (schema.minItems ?? 0)) error('minItems');
      if (input.length > (schema.maxItems ?? Infinity)) error('maxItems');
      if (schema.items) input.forEach((item, i) => errors.push(...check(schema.items, item, path + '/' + i)));
    }
    if (typeof input === 'string') {
      if ([...input].length < (schema.minLength ?? 0)) error('minLength');
      if ([...input].length > (schema.maxLength ?? Infinity)) error('maxLength');
      if (schema.pattern && !new RegExp(schema.pattern).test(input)) error('pattern');
      if (schema.format) { assert.equal(schema.format, 'date-time'); if (!utcInstant(input)) error('format'); }
    }
    if (typeof input === 'number') {
      if (input < (schema.minimum ?? -Infinity)) error('minimum');
      if (input > (schema.maximum ?? Infinity)) error('maximum');
    }
    return errors;
  }
  return check(root, value, '');
}

// Mirrors the hosted wire layer exactly: clone, insert only the specified
// receipt in empty Memory receipt lists, and change no other field or group.
function applyHostedPlaceholder(reply) {
  const value = structuredClone(reply);
  for (const name of ['procedural', 'background']) for (const item of value.groups[name].items) {
    if (item.receipts.length === 0) item.receipts = [{ id: 'withheld', role: 'user', excerpt: '[source not available]' }];
  }
  return value;
}

const emptyGroup = enabled => ({ enabled, returned: 0, complete: true,
  budget_exhausted: false, status: enabled ? 'complete' : 'disabled', items: [] });
// The core API predates the hosted envelope. Compose only its fixed version and
// empty commitments group here; all three engine groups, items, flags and framing
// are used verbatim. Both Memory groups are requested together. This is packaging,
// not another item repair; a missing/omitted background group is an error here.
function hostedEnvelope(result) {
  const value = ok(result);
  assert.deepEqual(Object.keys(value.groups), ['nextSteps', 'procedural', 'background']);
  assert.equal(Object.hasOwn(value, 'backgroundOmitted'), false);
  assert.deepEqual(schemaErrors(value).filter(error => error.keyword !== 'minItems'), [
    { path: '/version', keyword: 'required' }, { path: '/groups/commitments', keyword: 'required' },
  ], 'raw core output has a different fixed envelope; no other schema failure may be hidden by packaging');
  return { version: 1, ...value, groups: { ...value.groups, commitments: emptyGroup(false) } };
}
function read(f, patch = {}) {
  const record = { texts: [], needles: [...f.tokenizer.needles] };
  f.tokenizer.reads.push(record);
  assert.equal(f.tokenizer.active, null);
  f.tokenizer.active = record;
  try { return f.core.sessionStartContext({ namespace: ns,
    groups: { nextSteps: true, procedural: true, background: true }, maxTokens: 2000, maxChars: 8000, ...patch }); }
  finally { f.tokenizer.active = null; }
}
const request = { version: 1, max_tokens: 2000, max_chars: 8000 };
const limits = f => ({ ownerId: ns.ownerId, countTokens: f.counter.countTokens });
function accepted(f, reply, input = request) {
  assert.deepEqual(canonical, HOSTED_SCHEMAS['session-start-response']);
  assert.deepEqual(schemaErrors(reply), []);
  assert.equal(conforms('session-start-response', reply), true);
  assert.equal(parseSessionStartResponse(reply, input, limits(f)), reply);
  for (const group of Object.values(reply.groups)) assert.equal(group.returned, group.items.length);
  assert.ok(Object.values(reply.groups).reduce((sum, group) => sum + group.returned, 0) <= 12);
  absent(reply, [...f.tokenizer.needles]);
}
function validate(f, result) {
  const reply = hostedEnvelope(result), emptyPaths = [];
  for (const name of ['procedural', 'background']) reply.groups[name].items.forEach((item, i) => {
    if (!item.receipts.length) emptyPaths.push('/groups/' + name + '/items/' + i + '/receipts');
  });
  const repaired = applyHostedPlaceholder(reply), expected = structuredClone(reply);
  for (const name of ['procedural', 'background']) expected.groups[name].items.forEach(item => {
    if (!item.receipts.length) item.receipts.push({ id: 'withheld', role: 'user', excerpt: '[source not available]' });
  });
  assert.deepEqual(repaired, expected, 'placeholder changes only the empty receipt lists');
  if (emptyPaths.length) {
    const errors = schemaErrors(reply);
    assert.deepEqual(errors.map(error => error.path).sort(), emptyPaths.sort());
    assert.ok(errors.every(error => error.keyword === 'minItems'), 'the only schema failure is receipt minItems');
    assert.equal(conforms('session-start-response', reply), false);
    assert.throws(() => parseSessionStartResponse(reply, request, limits(f)), /invalid_reply/);
    // Independently relax only minItems in a test-local schema clone. Never edit
    // the published schema. All remaining canonical constraints must pass.
    const relaxed = structuredClone(canonical);
    relaxed.$defs.contextMemory.properties.receipts.minItems = 0;
    assert.deepEqual(schemaErrors(reply, relaxed), []);
  }
  accepted(f, repaired);
  return repaired;
}

// Mirrors hosted whole-item fit trimming after placeholders: last item of the
// last nonempty Memory group first, with the engine's existing truncated-group
// vocabulary. Exhaustion without acceptance is a wire-layer finding, not a repair.
function trimHostedMemoryItemsToFit(reply, input, parserLimits) {
  const value = structuredClone(reply);
  let popped = 0;
  const fits = () => {
    const text = JSON.stringify(value), background = JSON.stringify(value.groups.background.items);
    const totalTokens = parserLimits.countTokens(text), backgroundTokens = parserLimits.countTokens(background);
    return text.length <= input.max_chars && Buffer.byteLength(text) <= 24000 && background.length <= 2000 &&
      Number.isSafeInteger(totalTokens) && totalTokens >= 0 && totalTokens <= input.max_tokens &&
      Number.isSafeInteger(backgroundTokens) && backgroundTokens >= 0 && backgroundTokens <= 500;
  };
  assert.deepEqual(schemaErrors(value), [], 'trimming must not repair schema failures');
  while (!fits()) {
    const name = ['background', 'procedural'].find(name => value.groups[name].items.length);
    assert.ok(name, 'wire-layer finding: whole-Memory trimming cannot make this reply acceptable');
    const group = value.groups[name];
    group.items.pop(); group.returned = group.items.length;
    Object.assign(group, { complete: false, budget_exhausted: true, status: 'budget_exhausted' });
    popped++;
  }
  assert.doesNotThrow(() => parseSessionStartResponse(value, input, parserLimits),
    'wire-layer finding: size trimming leaves an invalid group or evidence contract');
  return { value, popped };
}

for (const layout of [53, 18, 33]) for (const kind of ['fact', 'instruction'])
test(`hosted accepts a short ${kind} with zero delivered receipts, layout ${layout}`, async t => {
  const f = await fixture(t, layout), shared = support('zero-' + kind);
  const memory = admit(f, 'Synthetic zero receipt ' + kind, kind, [shared]);
  const hidden = rows(f, memory), donor = admit(f, 'Synthetic retired zero donor', 'decision', [shared]);
  deny(f, ...withhold(f, donor, 'forget', shared), ...hidden.flatMap(row => [row.id, row.receipt_key]));
  const result = read(f), group = kind === 'fact' ? 'background' : 'procedural';
  assert.deepEqual(ok(result).groups[group].items.map(item => item.memory.id), [memory.id]);
  assert.deepEqual(ok(result).groups[group].items[0].receipts, []);
  assert.deepEqual(get(f, memory).receipts, []);
  const reply = validate(f, result);
  assert.deepEqual(reply.groups[group].items[0].receipts, [{ id: 'withheld', role: 'user', excerpt: '[source not available]' }]);
});

for (const layout of [53, 18, 33]) for (const kind of ['instruction', 'preference'])
for (const anchorOnRemaining of [false, true])
test(`hosted short ${kind} with ${anchorOnRemaining ? 'remaining' : 'withheld'} tag anchor, layout ${layout}`, async t => {
  const f = await fixture(t, layout), shared = support('tag-shared'), remaining = support('tag-remaining');
  const memory = admit(f, 'Synthetic tagged hosted ' + kind, kind, [shared, remaining], {
    anchors: [{ receiptIndex: anchorOnRemaining ? 1 : 0, start: 0, end: (anchorOnRemaining ? remaining : shared).excerpt.length }],
  });
  const before = get(f, memory), hidden = rows(f, memory).find(row => row.excerpt === shared.excerpt);
  const donor = admit(f, 'Synthetic retired tag donor', 'decision', [shared]);
  deny(f, ...withhold(f, donor, 'forget', shared), hidden.id, hidden.receipt_key);
  if (kind === 'preference' && !anchorOnRemaining) deny(f, memory.id, memory.content);
  const result = read(f), group = ok(result).groups.procedural;
  if (kind === 'preference' && !anchorOnRemaining) {
    assert.deepEqual(group.items, []);
    assert.equal(group.returned, 0);
    assert.equal(group.status, 'complete');
    assert.deepEqual(read(f), result, 'both snapshots and repeated calls retain private absence');
  } else {
    assert.equal(group.returned, 1);
    const item = group.items[0];
    assert.deepEqual(item.receipts, projected(get(f, memory).receipts));
    assert.equal(item.receipts.length, 1);
    if (anchorOnRemaining) {
      assert.deepEqual(item.procedural, before.procedural);
      for (const anchor of item.procedural.anchors) assert.ok(item.receipts.some(receipt => receipt.id === anchor.receiptId));
    } else assert.equal(Object.hasOwn(item, 'procedural'), false);
  }
  const reply = validate(f, result);
  if (anchorOnRemaining) {
    const broken = structuredClone(reply);
    broken.groups.procedural.items[0].procedural.anchors[0].receiptId = 'synthetic-nondelivered-receipt';
    assert.deepEqual(schemaErrors(broken), [], 'semantic negative control remains structurally valid');
    assert.throws(() => parseSessionStartResponse(broken, request, limits(f)), /invalid_reply/);
  }
});

for (const layout of [53, 18, 33])
test(`hosted selection covers every Memory kind and supported tag state, layout ${layout}`, async t => {
  const f = await fixture(t, layout), expected = { procedural: [], background: [] };
  for (const [kind, tag] of [['fact', null], ['context', null], ['decision', null],
    ['preference', null], ['preference', false], ['preference', true],
    ['instruction', null], ['instruction', false], ['instruction', true]]) {
    const source = support(kind + '-' + tag);
    const memory = admit(f, 'Synthetic kind ' + kind + ' tag ' + tag, kind, [source],
      tag === true ? { anchors: [{ receiptIndex: 0, start: 0, end: source.excerpt.length }] } : undefined);
    if (tag === false) ok(f.core.setProceduralMemory({ namespace: ns, memoryId: memory.id,
      expectedRevision: memory.revision, expectedTagRevision: 0, procedural: null }));
    if (kind === 'instruction' || (kind === 'preference' && tag === true)) expected.procedural.unshift({ memory, tag });
    if (kind === 'fact' || kind === 'context') expected.background.unshift({ memory, tag });
  }
  const reply = validate(f, read(f));
  for (const name of ['procedural', 'background']) {
    assert.deepEqual(reply.groups[name].items.map(item => item.memory.id), expected[name].map(item => item.memory.id));
    reply.groups[name].items.forEach((item, i) => {
      const tag = expected[name][i].tag;
      if (tag === null) assert.equal(Object.hasOwn(item, 'procedural'), false);
      else if (tag === false) assert.deepEqual(item.procedural, { tagRevision: 1, procedural: false, origin: null, anchors: [] });
      else {
        assert.equal(item.procedural.procedural, true);
        assert.notEqual(item.procedural.origin, null);
        assert.ok(item.procedural.anchors.length > 0);
      }
    });
  }
});

for (const layout of [53, 18, 33]) for (const withheldCount of [1, 2])
test(`hosted next step with ${withheldCount} of two sources withheld is omitted, layout ${layout}`, async t => {
  const f = await fixture(t, layout);
  const episodic = openMemoryCore({ path: f.path, model: f.model, ...episodeOptions }); f.ws.defer(() => episodic.close());
  f.model.interpretEpisode = input => ({ ...interpretation(input), nextStep: { value: 'Synthetic independent source action',
    anchors: [{ sourceIndex: 0, start: 0, end: input.input.sources[0].text.length }] } });
  f.tick();
  const independent = ok(await episodic.capture({ namespace: ns, client: 'synthetic', sessionId: 'synthetic-independent-step',
    eventId: 'synthetic-independent-step-capture', episodeContext: { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' },
    messages: [{ id: 'synthetic-independent-step-source', role: 'user', content: 'Synthetic independent step source' }] }));
  f.model.interpretEpisode = input => ({ ...interpretation(input), nextStep: { value: 'Synthetic two source action',
    anchors: input.input.sources.map((source, sourceIndex) => ({ sourceIndex, start: 0, end: source.text.length })) } });
  f.tick();
  const capture = ok(await episodic.capture({ namespace: ns, client: 'synthetic', sessionId: 'synthetic-two-sources',
    eventId: 'synthetic-two-source-capture', episodeContext: { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' },
    messages: [0, 1].map(i => ({ id: 'synthetic-source-' + i, role: 'user', content: 'Synthetic step source ' + i })) }));
  const before = validate(f, read(f)), intact = before.groups.nextSteps.items[0];
  assert.equal(intact.episodeId, capture.episode.id);
  assert.equal(intact.sources.length, 2);
  assert.equal(intact.nextStep.anchors.length, 2);
  for (const anchor of intact.nextStep.anchors) assert.ok(intact.sources.some(source =>
    source.id === anchor.sourceId && source.digest === anchor.digest));
  const sources = f.db.prepare(`SELECT e.client,e.session_key AS sessionId,s.message_id AS eventId,s.role,s.text AS excerpt
    FROM episode_sources s JOIN session_episodes e ON e.id=s.origin_episode_id WHERE s.episode_id=? ORDER BY s.id`).all(capture.episode.id);
  for (const [i, source] of sources.slice(0, withheldCount).entries()) {
    const donor = admit(f, 'Synthetic retired step donor ' + i, 'decision', [source]);
    deny(f, ...withhold(f, donor, 'forget', source), intact.sources.find(item => item.text === source.excerpt).id);
  }
  deny(f, capture.episode.id, 'Synthetic two source action');
  const result = read(f), reply = validate(f, result);
  assert.deepEqual(reply.groups.nextSteps.items.map(item => item.episodeId), [independent.episode.id]);
  assert.equal(reply.groups.nextSteps.returned, 1);
  assert.equal(reply.groups.nextSteps.status, 'complete');
  for (const item of reply.groups.nextSteps.items) for (const anchor of item.nextStep.anchors) assert.ok(item.sources.some(source =>
    source.id === anchor.sourceId && source.digest === anchor.digest));
});

for (const layout of [53, 18, 33]) for (const kind of ['fact', 'instruction'])
test(`hosted captured three Memories preserve two siblings and an independent ${kind}, layout ${layout}`, async t => {
  const f = await fixture(t, layout);
  f.model.items = ['Synthetic hosted sibling one', 'Synthetic hosted sibling two', 'Synthetic hosted retired sibling']
    .map(content => ({ content, kind, confidence: .9, sourceIndices: [0] }));
  f.tick();
  const captured = ok(await f.core.capture({ namespace: ns, client: 'synthetic', sessionId: 'synthetic-hosted-shared',
    eventId: 'synthetic-hosted-capture', messages: [{ id: 'synthetic-hosted-message', role: 'user',
      content: 'Synthetic hosted shared source needle' }] }));
  assert.equal(captured.admission.memories.length, 3);
  const [first, second, retired] = captured.admission.memories;
  f.model.items = [{ content: 'Synthetic independent hosted Memory', kind, confidence: .8, sourceIndices: [0] }];
  f.tick();
  const independent = ok(await f.core.capture({ namespace: ns, client: 'synthetic', sessionId: 'synthetic-hosted-independent',
    eventId: 'synthetic-hosted-independent-capture', messages: [{ id: 'synthetic-hosted-independent-message', role: 'user',
      content: 'Synthetic hosted independent source' }] })).admission.memories[0];
  const hidden = [first, second, retired].flatMap(memory => rows(f, memory));
  ok(f.core.forget({ namespace: ns, memoryId: retired.id, expectedRevision: retired.revision }));
  deny(f, retired.id, 'Synthetic hosted retired sibling', ...hidden.flatMap(row =>
    [row.id, row.receipt_key, row.excerpt, row.session_id, row.event_id]));
  const result = read(f), reply = validate(f, result), name = kind === 'fact' ? 'background' : 'procedural';
  assert.equal(reply.groups[name].returned, 3);
  assert.equal(reply.groups[name].status, 'complete');
  for (const memory of [first, second, independent]) {
    const item = ok(result).groups[name].items.find(item => item.memory.id === memory.id), expected = get(f, memory);
    assert.ok(item);
    assert.equal(item.memory.content, expected.memory.content);
    assert.deepEqual(item.receipts, projected(expected.receipts));
  }
  assert.deepEqual(ok(result).groups[name].items.filter(item => item.memory.id !== independent.id).map(item => item.receipts), [[], []]);
  absent(result, [...f.tokenizer.needles]);
});

for (const layout of [53, 18, 33])
test(`hosted placeholders followed by whole item trimming fit the same exact reply budget, layout ${layout}`, async t => {
  const f = await fixture(t, layout), shared = support('budget-shared');
  const first = admit(f, 'Synthetic budget first', 'fact', [shared]);
  const second = admit(f, 'Synthetic budget second', 'fact', [shared]);
  const donor = admit(f, 'Synthetic retired budget donor', 'decision', [shared]);
  const hidden = [first, second].flatMap(memory => rows(f, memory));
  deny(f, ...withhold(f, donor, 'forget', shared), ...hidden.flatMap(row => [row.id, row.receipt_key]));
  const initial = hostedEnvelope(read(f));
  const exactRequest = { ...request, max_chars: JSON.stringify(initial).length };
  const result = read(f, { maxChars: exactRequest.max_chars });
  const before = hostedEnvelope(result);
  validate(f, result); // Includes the minItems-only negative control before repair.
  assert.deepEqual(before, initial, 'the engine fits the same requested character budget without any placeholder reservation');
  assert.equal(JSON.stringify(before).length, exactRequest.max_chars);
  assert.equal(before.groups.background.returned, 2);
  assert.ok(before.groups.background.items.every(item => item.receipts.length === 0));
  const after = applyHostedPlaceholder(before);
  assert.throws(() => parseSessionStartResponse(after, exactRequest, limits(f)), /invalid_reply/);
  const { value, popped } = trimHostedMemoryItemsToFit(after, exactRequest, limits(f));
  assert.equal(popped, 1, 'one whole Memory pays for both placeholders and truncation flags');
  assert.equal(value.groups.background.returned, 1);
  assert.equal(value.groups.background.complete, false);
  assert.equal(value.groups.background.budget_exhausted, true);
  assert.equal(value.groups.background.status, 'budget_exhausted');
  accepted(f, value, exactRequest);
  // Per-placeholder deltas use the real surrounding JSON, not a token estimate.
  let previous = before;
  const deltas = [];
  for (let i = 0; i < 2; i++) {
    const next = structuredClone(previous);
    next.groups.background.items[i].receipts = after.groups.background.items[i].receipts;
    deltas.push({ chars: JSON.stringify(next).length - JSON.stringify(previous).length,
      tokens: f.counter.countTokens(JSON.stringify(next)) - f.counter.countTokens(JSON.stringify(previous)) });
    previous = next;
  }
  assert.deepEqual(deltas, [{ chars: 66, tokens: 18 }, { chars: 66, tokens: 18 }]);
  t.diagnostic('HOSTED_PLACEHOLDER_BUDGET ' + JSON.stringify({ layout, engineEnvelopeChars: JSON.stringify(result).length,
    beforeChars: JSON.stringify(before).length, afterChars: JSON.stringify(after).length, trimmedChars: JSON.stringify(value).length,
    beforeTokens: f.counter.countTokens(JSON.stringify(before)), afterTokens: f.counter.countTokens(JSON.stringify(after)),
    trimmedTokens: f.counter.countTokens(JSON.stringify(value)), popped, deltas }));
});
