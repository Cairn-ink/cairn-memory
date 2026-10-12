import { createHash } from 'node:crypto';
import { types } from 'node:util';

// Pure normalized-data helpers. These do not establish runtime provenance,
// firstness, judge independence, semantic support or an execution capability.
const SET_VERSION = 'first-answer-packet-set-v1';
const PACKET_VERSION = 'first-answer-judge-packet-v1';
const RESPONSE_VERSION = 'first-answer-judgment-v1';
const JUDGES = ['A', 'B'];
const BOUNDS = Object.freeze({ items: 48, claimCount: 128, rationaleUtf16: 1600,
  references: 16, rawBytes: 4 * 1024 * 1024 });
const BINDING_KEYS = ['sourcesSha256', 'rubricSha256', 'preparationManifestSha256',
  'runManifestSha256', 'resultSha256', 'runtimeCommitSha'];
const RUBRIC_KEYS = ['id', 'answerability', 'expectedProposition', 'acceptableQualifiedAnswer',
  'unanswerabilityReason', 'factualClaims', 'anchors', 'requiredEvidenceSets',
  'unsupportedConclusions', 'staleUse', 'severeConditions', 'provenance', 'ambiguity', 'optionalContextClaims'];
const FIELD_NAMES = ['correctness', 'support', 'unsupportedClaims', 'staleClaims'];
const INSTRUCTION = 'Assess every item independently using only its own shown material, not another item or another judge. '
  + 'Original sources and rubric are for correctness, stale use and predefined severe conditions. '
  + 'Support and unsupported-claim decisions concern only the literal answer and actual packed passages; '
  + 'full original sources were not necessarily supplied to the answering model. '
  + 'Recorded roles are attribution, not authentication. Preserve uncertainty. '
  + 'Return one first-answer-judgment-v1 JSON response with this packet payload hash supplied by the caller. '
  + 'Known fields require a rationale and at least one allowed reference; unknown fields may have no references. '
  + 'Reference offsets are nonempty UTF-16 ranges within the identified item-local text. '
  + 'Identical questions or sources may reveal counterparts; no perfect concealment is claimed.';
const LIMITATIONS = ['Normalized inputs are not verified provenance or runtime capabilities.',
  'Firstness and independent judge execution require external execution provenance.',
  'Opaque labels conceal direct arm/pair mapping, not clues in identical questions or sources.',
  'Reference validity and judge agreement do not prove semantic truth or support.'];
const sha = text => createHash('sha256').update(text).digest('hex');
const fail = () => { throw new TypeError('invalid_judging_input'); };
const requireTrue = condition => { if (!condition) fail(); };
const hash = value => sha(JSON.stringify(value));
const freeze = value => { if (value && typeof value === 'object') {
  Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

// Descriptor-first bounded JSON snapshot: never evaluate caller accessors,
// proxies, inherited JSON hooks, sparse arrays or custom object prototypes.
function clean(value, state = { nodes: 0, bytes: 0, ancestors: new WeakSet() }, depth = 0) {
  requireTrue(++state.nodes <= 300000 && depth <= 24);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') { requireTrue(Number.isFinite(value)); return value; }
  if (typeof value === 'string') { state.bytes += Buffer.byteLength(value);
    requireTrue(value.isWellFormed() && state.bytes <= 32 * 1024 * 1024); return value; }
  requireTrue(value && typeof value === 'object' && !types.isProxy(value) && !state.ancestors.has(value));
  requireTrue(!Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON')
    && !Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON'));
  const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
  requireTrue(array ? proto === Array.prototype : proto === Object.prototype || proto === null);
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  requireTrue(keys.length <= 300000 - state.nodes);
  state.ancestors.add(value); let result;
  if (array) {
    const length = descriptors.length?.value;
    requireTrue(Number.isSafeInteger(length) && length >= 0 && keys.length === length + 1);
    result = [];
    for (let i = 0; i < length; i++) { const d = descriptors[String(i)];
      requireTrue(d && d.enumerable && Object.hasOwn(d, 'value')); result.push(clean(d.value, state, depth + 1)); }
  } else {
    result = Object.create(null);
    for (const key of keys) { const d = descriptors[key];
      requireTrue(typeof key === 'string' && !['__proto__', 'prototype', 'constructor', 'toJSON'].includes(key)
        && d.enumerable && Object.hasOwn(d, 'value'));
      state.bytes += Buffer.byteLength(key); requireTrue(state.bytes <= 32 * 1024 * 1024);
      result[key] = clean(d.value, state, depth + 1);
    }
  }
  state.ancestors.delete(value); return result;
}
function fields(value, keys) {
  requireTrue(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
  return value;
}
function text(value, maximum = 16384, empty = false) {
  requireTrue(typeof value === 'string' && value.isWellFormed() && value.length <= maximum && (empty || value.length > 0));
  return value;
}
function list(value, maximum, minimum = 0) {
  requireTrue(Array.isArray(value) && value.length >= minimum && value.length <= maximum); return value;
}
function integer(value, minimum, maximum) {
  return Number.isSafeInteger(value) && !Object.is(value, -0) && value >= minimum && value <= maximum;
}
function bindings(value) {
  fields(value, BINDING_KEYS);
  for (const key of BINDING_KEYS) requireTrue(typeof value[key] === 'string'
    && (key === 'runtimeCommitSha' ? /^[a-f0-9]{40}$/u : /^[a-f0-9]{64}$/u).test(value[key]));
}

function responseSchema() {
  const reference = { type: 'object', additionalProperties: false, required: ['targetId', 'start', 'end'],
    properties: { targetId: { type: 'string', maxLength: 96 }, start: { type: 'integer', minimum: 0 },
      end: { type: 'integer', minimum: 1 } } };
  const field = count => ({ type: 'object', additionalProperties: false,
    required: ['value', 'rationale', 'refs'], properties: {
      value: count ? { anyOf: [{ type: 'integer', minimum: 0, maximum: 128 }, { type: 'null' }] }
        : { enum: ['yes', 'no', 'unknown'] },
      rationale: { type: 'string', maxLength: 1600 }, refs: { type: 'array', maxItems: 16, items: reference } } });
  return { type: 'object', additionalProperties: false, required: ['version', 'packetSha256', 'items'],
    properties: { version: { const: RESPONSE_VERSION }, packetSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      items: { type: 'array', maxItems: 48, items: { type: 'object', additionalProperties: false,
        required: ['itemId', ...FIELD_NAMES, 'severe'], properties: {
          itemId: { type: 'string', pattern: '^item-[a-f0-9]{32}$' }, correctness: field(false), support: field(false),
          unsupportedClaims: field(true), staleClaims: field(true), severe: { type: 'array', maxItems: 8,
            items: { ...field(false), required: ['conditionId', 'value', 'rationale', 'refs'],
              properties: { conditionId: { type: 'string', maxLength: 96 }, ...field(false).properties } } } } } } } };
}

function validateItem(item) {
  fields(item, ['slotId', 'question', 'sources', 'rubric', 'passages', 'answer']);
  text(item.slotId, 128); fields(item.question, ['text', 'date']); text(item.question.text); text(item.question.date, 128);
  text(item.answer); const sourceIds = new Map();
  for (const source of list(item.sources, 12, 1)) {
    fields(source, ['id', 'eventTime', 'messages']); text(source.id, 128); text(source.eventTime, 128);
    requireTrue(!sourceIds.has(source.id)); sourceIds.set(source.id, source);
    const [message] = list(source.messages, 1, 1); fields(message, ['role', 'content']);
    requireTrue(['user', 'assistant'].includes(message.role)); text(message.content);
  }
  for (const passage of list(item.passages, 12)) { fields(passage, ['recordedRole', 'text']);
    requireTrue(['user', 'assistant'].includes(passage.recordedRole)); text(passage.text); }
  const r = fields(item.rubric, RUBRIC_KEYS); text(r.id, 128);
  requireTrue(['answerable', 'qualified'].includes(r.answerability));
  for (const key of ['expectedProposition', 'acceptableQualifiedAnswer', 'staleUse', 'provenance', 'ambiguity']) text(r[key]);
  if (r.unanswerabilityReason !== null) text(r.unanswerabilityReason);
  for (const key of ['factualClaims', 'unsupportedConclusions', 'severeConditions'])
    list(r[key], key === 'severeConditions' ? 8 : 32, 1).forEach(value => text(value));
  const anchorIds = new Set();
  for (const anchor of list(r.anchors, 67, 1)) {
    fields(anchor, ['id', 'sessionId', 'messageIndex', 'start', 'end', 'text']); text(anchor.id, 128);
    const source = sourceIds.get(anchor.sessionId); requireTrue(source && anchor.messageIndex === 0 && !anchorIds.has(anchor.id));
    const content = source.messages[0].content;
    requireTrue(integer(anchor.start, 0, content.length) && integer(anchor.end, anchor.start + 1, content.length)
      && content.slice(anchor.start, anchor.end) === anchor.text); text(anchor.text); anchorIds.add(anchor.id);
  }
  function refs(ids) { list(ids, 67, 1); requireTrue(new Set(ids).size === ids.length && ids.every(id => anchorIds.has(id))); }
  for (const set of list(r.requiredEvidenceSets, 16, 1)) { fields(set, ['name', 'anchorIds']); text(set.name, 128); refs(set.anchorIds); }
  for (const claim of list(r.optionalContextClaims, 32)) { fields(claim, ['claim', 'anchorIds']); text(claim.claim); refs(claim.anchorIds); }
}

function visibleItem(item, itemId) {
  const sourceIds = new Map(item.sources.map((source, i) => [source.id, `${itemId}-source-${i + 1}`]));
  const anchorIds = new Map(item.rubric.anchors.map((anchor, i) => [anchor.id, `${itemId}-anchor-${i + 1}`]));
  const rubric = Object.fromEntries(RUBRIC_KEYS.filter(key => key !== 'id').map(key => [key, item.rubric[key]]));
  rubric.anchors = item.rubric.anchors.map(anchor => ({ id: anchorIds.get(anchor.id),
    sessionId: sourceIds.get(anchor.sessionId), messageIndex: anchor.messageIndex,
    start: anchor.start, end: anchor.end, text: anchor.text }));
  rubric.requiredEvidenceSets = item.rubric.requiredEvidenceSets.map(set => ({ name: set.name, anchorIds: set.anchorIds.map(id => anchorIds.get(id)) }));
  rubric.optionalContextClaims = item.rubric.optionalContextClaims.map(claim => ({ claim: claim.claim, anchorIds: claim.anchorIds.map(id => anchorIds.get(id)) }));
  rubric.severeConditions = item.rubric.severeConditions.map((condition, i) => ({ conditionId: `${itemId}-condition-${i + 1}`, text: condition }));
  return { itemId, question: { text: item.question.text, date: item.question.date },
    originalSources: item.sources.map(source => ({ targetId: sourceIds.get(source.id), eventTime: source.eventTime,
      recordedRole: source.messages[0].role, text: source.messages[0].content })),
    rubric: { targetId: `${itemId}-rubric`, text: JSON.stringify(rubric) },
    packedPassages: item.passages.map((passage, i) => ({ targetId: `${itemId}-packed-${i + 1}`,
      recordedRole: passage.recordedRole, text: passage.text })),
    answer: { targetId: `${itemId}-answer`, text: item.answer },
    questionTargetId: `${itemId}-question` };
}

/** Caller supplies explicit neutral, normalized data, not trusted provenance. */
export function createSourceBundleJudgePackets(options) {
  const input = fields(clean(options), ['bindings', 'seedHex', 'items']); bindings(input.bindings);
  requireTrue(typeof input.seedHex === 'string' && /^[a-fA-F0-9]{64}$/u.test(input.seedHex));
  input.seedHex = input.seedHex.toLowerCase();
  list(input.items, 48); const slots = new Set();
  for (const item of input.items) { validateItem(item); requireTrue(!slots.has(item.slotId)); slots.add(item.slotId); }
  const privateMapping = [], packets = [];
  for (const judgeId of JUDGES) {
    const salt = `first-answer-independent-judge-${judgeId}-v1`, seen = new Set();
    const entries = input.items.map(item => {
      const itemId = `item-${sha(JSON.stringify([input.seedHex, salt, 'identity', item.slotId])).slice(0, 32)}`;
      requireTrue(!seen.has(itemId)); seen.add(itemId);
      privateMapping.push({ judgeId, itemId, slotId: item.slotId, normalizationSha256:
        hash(item.passages.map(({ recordedRole, text: passage }) => ({ recordedRole, text: passage }))) });
      const visible = visibleItem(item, itemId); text(visible.rubric.text, 131072);
      return { order: sha(JSON.stringify([input.seedHex, salt, 'order', item.slotId])), visible };
    }).sort((a, b) => a.order < b.order ? -1 : a.order > b.order ? 1
      : a.visible.itemId < b.visible.itemId ? -1 : a.visible.itemId > b.visible.itemId ? 1 : 0);
    const payload = { version: PACKET_VERSION, instructions: INSTRUCTION,
      bounds: BOUNDS, responseSchema: responseSchema(), items: entries.map(entry => entry.visible) };
    packets.push({ judgeId, packetSha256: hash(payload), payload });
  }
  return freeze(clean({ version: SET_VERSION, bindings: input.bindings, seedSha256: sha(Buffer.from(input.seedHex, 'hex')),
    packets, privateMapping, limitations: [...LIMITATIONS] }));
}

// Bounded strict JSON parser. Reject duplicate decoded keys and depth/node
// overflow instead of JSON.parse's last-key-wins or partial-text extraction.
function strictJson(raw) {
  let position = 0, nodes = 0;
  const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const bad = () => { throw new TypeError('malformed_first_response'); };
  const space = () => { while (/[\x20\t\r\n]/u.test(raw[position] ?? '') && position < raw.length) position++; };
  function string() {
    const start = position++; let escaped = false;
    while (position < raw.length) { const char = raw[position++];
      if (!escaped && char === '"') return JSON.parse(raw.slice(start, position));
      if (!escaped && char === '\\') escaped = true; else escaped = false;
    } bad();
  }
  function value(depth) {
    if (++nodes > 150000 || depth > 24) bad(); space(); const char = raw[position];
    if (char === '"') return string();
    if (char === '{' || char === '[') {
      position++; space(); const object = char === '{', end = object ? '}' : ']';
      const result = object ? Object.create(null) : [], seen = new Set();
      if (raw[position] === end) { position++; return result; }
      while (true) {
        let key;
        if (object) { space(); if (raw[position] !== '"') bad(); key = string();
          if (seen.has(key) || ['__proto__', 'constructor', 'prototype', 'toJSON'].includes(key)) bad();
          seen.add(key); space(); if (raw[position++] !== ':') bad(); }
        const child = value(depth + 1); if (object) result[key] = child; else result.push(child);
        space(); const next = raw[position++]; if (next === end) return result; if (next !== ',') bad();
      }
    }
    for (const [literal, parsed] of [['true', true], ['false', false], ['null', null]])
      if (raw.startsWith(literal, position)) { position += literal.length; return parsed; }
    number.lastIndex = position; const match = number.exec(raw); if (!match) bad();
    position = number.lastIndex; const parsed = Number(match[0]); if (!Number.isFinite(parsed)) bad(); return parsed;
  }
  const result = value(0); space(); if (position !== raw.length) bad(); return result;
}

function packetContext(packet, mappings) {
  fields(packet, ['judgeId', 'packetSha256', 'payload']); requireTrue(JUDGES.includes(packet.judgeId));
  requireTrue(packet.packetSha256 === hash(packet.payload));
  const payload = fields(packet.payload, ['version', 'instructions', 'bounds', 'responseSchema', 'items']);
  requireTrue(payload.version === PACKET_VERSION && payload.instructions === INSTRUCTION
    && hash(payload.bounds) === hash(BOUNDS) && hash(payload.responseSchema) === hash(responseSchema()));
  const contexts = new Map();
  for (const item of list(payload.items, 48)) {
    fields(item, ['itemId', 'question', 'originalSources', 'rubric', 'packedPassages', 'answer', 'questionTargetId']);
    requireTrue(/^item-[a-f0-9]{32}$/u.test(item.itemId) && !contexts.has(item.itemId));
    fields(item.question, ['text', 'date']); text(item.question.text); text(item.question.date, 128);
    const targets = new Map();
    const target = (id, kind, value) => { text(id, 96); text(value); requireTrue(!targets.has(id)
      && id.startsWith(`${item.itemId}-`)); targets.set(id, { kind, text: value }); };
    target(item.questionTargetId, 'question', item.question.text);
    for (const source of list(item.originalSources, 12, 1)) {
      fields(source, ['targetId', 'eventTime', 'recordedRole', 'text']); text(source.eventTime, 128);
      requireTrue(['user', 'assistant'].includes(source.recordedRole)); target(source.targetId, 'source', source.text);
    }
    for (const passage of list(item.packedPassages, 12)) { fields(passage, ['targetId', 'recordedRole', 'text']);
      requireTrue(['user', 'assistant'].includes(passage.recordedRole)); target(passage.targetId, 'packed', passage.text); }
    fields(item.answer, ['targetId', 'text']); target(item.answer.targetId, 'answer', item.answer.text);
    fields(item.rubric, ['targetId', 'text']); text(item.rubric.text, 131072);
    requireTrue(!targets.has(item.rubric.targetId) && item.rubric.targetId === `${item.itemId}-rubric`);
    targets.set(item.rubric.targetId, { kind: 'rubric', text: item.rubric.text });
    const rubric = strictJson(item.rubric.text), conditions = list(rubric.severeConditions, 8, 1);
    fields(rubric, RUBRIC_KEYS.filter(key => key !== 'id'));
    conditions.forEach((condition, index) => { fields(condition, ['conditionId', 'text']);
      requireTrue(condition.conditionId === `${item.itemId}-condition-${index + 1}`); target(condition.conditionId, 'condition', condition.text); });
    validateItem({ slotId: 'packet-local-data-not-provenance', question: item.question,
      sources: item.originalSources.map(source => ({ id: source.targetId, eventTime: source.eventTime,
        messages: [{ role: source.recordedRole, content: source.text }] })),
      rubric: { id: 'packet-local-rubric', ...rubric, severeConditions: conditions.map(condition => condition.text) },
      passages: item.packedPassages.map(({ recordedRole, text: passage }) => ({ recordedRole, text: passage })), answer: item.answer.text });
    const mapping = mappings.filter(row => row.judgeId === packet.judgeId && row.itemId === item.itemId);
    requireTrue(mapping.length === 1 && mapping[0].normalizationSha256 === hash(item.packedPassages.map(({ recordedRole, text: passage }) =>
      ({ recordedRole, text: passage }))));
    contexts.set(item.itemId, { slotId: mapping[0].slotId, targets, conditions: conditions.map(c => c.conditionId) });
  }
  return contexts;
}
const unknown = (count, status = 'unknown', issue = null) => ({ status,
  value: count ? null : 'unknown', issues: issue ? [issue] : [] });
function parsedField(field, context, name, severe = false) {
  const count = ['unsupportedClaims', 'staleClaims'].includes(name);
  if (field === undefined) return unknown(count, 'missing', 'missing_field');
  try {
    fields(field, severe ? ['conditionId', 'value', 'rationale', 'refs'] : ['value', 'rationale', 'refs']);
    const unresolved = count ? field.value === null : field.value === 'unknown';
    requireTrue(count ? field.value === null || integer(field.value, 0, 128) : ['yes', 'no', 'unknown'].includes(field.value));
    text(field.rationale, 1600, unresolved); list(field.refs, 16, unresolved ? 0 : 1);
    const supportOnly = name === 'support' || name === 'unsupportedClaims';
    for (const ref of field.refs) {
      fields(ref, ['targetId', 'start', 'end']); const target = context.targets.get(ref.targetId);
      requireTrue(target && (!supportOnly || ['answer', 'packed'].includes(target.kind))
        && integer(ref.start, 0, target.text.length) && integer(ref.end, ref.start + 1, target.text.length)
        && target.text.slice(ref.start, ref.end).isWellFormed());
    }
    return { status: unresolved ? 'unknown' : 'known', value: field.value, issues: [] };
  } catch { return unknown(count, 'invalid', 'invalid_field_or_reference'); }
}
function blankItem(itemId, context, status, issue) {
  return { itemId, slotId: context.slotId,
    fields: Object.fromEntries(FIELD_NAMES.map(name => [name, unknown(name.endsWith('Claims'), status, issue)])),
    severe: context.conditions.map((conditionId, index) => ({ conditionId, conditionIndex: index,
      ...unknown(false, status, issue) })) };
}
function parseItem(raw, itemId, context) {
  if (Object.keys(raw).some(key => !['itemId', ...FIELD_NAMES, 'severe'].includes(key)))
    return blankItem(itemId, context, 'invalid', 'unexpected_item_field');
  const result = blankItem(itemId, context, 'missing', 'missing_field');
  for (const name of FIELD_NAMES) result.fields[name] = parsedField(raw[name], context, name);
  if (Array.isArray(raw.severe) && raw.severe.length <= 8) {
    const expected = new Set(context.conditions);
    const foreign = raw.severe.some(row => !row || typeof row !== 'object' || !expected.has(row.conditionId));
    result.severe = context.conditions.map((conditionId, index) => {
      const rows = raw.severe.filter(row => row?.conditionId === conditionId);
      return { conditionId, conditionIndex: index, ...(foreign ? unknown(false, 'invalid', 'unexpected_condition')
        : rows.length > 1 ? unknown(false, 'ambiguous', 'duplicate_condition')
          : parsedField(rows[0], context, 'severe', true)) };
    });
  } else if (raw.severe !== undefined) result.severe = result.severe.map(row =>
    ({ ...row, ...unknown(false, 'invalid', 'invalid_conditions') }));
  if (result.fields.support.status === 'known' && result.fields.support.value === 'yes'
    && result.fields.unsupportedClaims.status === 'known' && result.fields.unsupportedClaims.value > 0) {
    result.fields.support = unknown(false, 'contradictory', 'support_with_unsupported_claims');
    result.fields.unsupportedClaims = unknown(true, 'contradictory', 'support_with_unsupported_claims');
  }
  return result;
}
function parseRaw(raw, packet, contexts) {
  const bytes = raw === null ? null : Buffer.byteLength(raw), digest = raw === null ? null : sha(raw);
  const record = { judgeId: packet.judgeId, packetSha256: packet.packetSha256,
    rawResponse: bytes !== null && bytes <= BOUNDS.rawBytes ? raw : null, rawSha256: digest, rawBytes: bytes,
    retention: raw === null ? 'missing' : bytes > BOUNDS.rawBytes ? 'external-oversized-first-artifact' : 'literal-first-raw',
    status: 'valid', issues: [], items: [] };
  const blank = (status, issue) => { record.status = status; record.issues.push(issue);
    record.items = [...contexts].map(([itemId, context]) => blankItem(itemId, context, 'unknown', issue)); return record; };
  if (raw === null) return blank('missing', 'missing_first_response');
  if (bytes > BOUNDS.rawBytes) return blank('oversized', 'oversized_first_response');
  let body; try { body = strictJson(raw); } catch { return blank('malformed', 'malformed_first_response'); }
  try { fields(body, ['version', 'packetSha256', 'items']);
    requireTrue(body.version === RESPONSE_VERSION && body.packetSha256 === packet.packetSha256); list(body.items, 48);
  } catch { return blank('invalid_binding', 'invalid_response_envelope_or_binding'); }
  const byId = new Map();
  for (const item of body.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !contexts.has(item.itemId)) {
      record.issues.push('unexpected_or_missing_item_identity'); continue;
    }
    const rows = byId.get(item.itemId) ?? []; rows.push(item); byId.set(item.itemId, rows);
  }
  for (const [itemId, context] of contexts) {
    const rows = byId.get(itemId) ?? [];
    record.items.push(rows.length === 0 ? blankItem(itemId, context, 'missing', 'missing_item')
      : rows.length > 1 ? blankItem(itemId, context, 'ambiguous', 'duplicate_item') : parseItem(rows[0], itemId, context));
  }
  if (record.issues.length || record.items.some(item => [...Object.values(item.fields), ...item.severe]
    .some(field => !['known', 'unknown'].includes(field.status)))) record.status = 'partial';
  return record;
}
function consensus(a, b, count) {
  if (a.status === 'known' && b.status === 'known' && a.value === b.value)
    return { status: 'known', value: a.value, reason: 'fieldwise-agreement' };
  return { status: 'unknown', value: count ? null : 'unknown', reason: a.status === 'known' && b.status === 'known'
    ? 'disagreement' : [a, b].some(field => !['known', 'unknown'].includes(field.status)) ? 'invalid-or-missing' : 'unknown' };
}

/** Parse exactly the supplied first strings; never replace, adjudicate or score. */
export function parseSourceBundleFirstJudgments(options) {
  // Raw strings are handled separately so oversized first artifacts are not
  // copied into the bounded JSON assessment or mistaken for empty responses.
  requireTrue(options && typeof options === 'object' && !types.isProxy(options)
    && [Object.prototype, null].includes(Object.getPrototypeOf(options)));
  const descriptors = Object.getOwnPropertyDescriptors(options);
  requireTrue(Reflect.ownKeys(descriptors).length === 2 && ['packetSet', 'rawFirstResponses'].every(key =>
    descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], 'value')));
  const set = fields(clean(descriptors.packetSet.value), ['version', 'bindings', 'seedSha256', 'packets', 'privateMapping', 'limitations']);
  requireTrue(set.version === SET_VERSION && /^[a-f0-9]{64}$/u.test(set.seedSha256)); bindings(set.bindings);
  requireTrue(hash(set.limitations) === hash(LIMITATIONS)); list(set.packets, 2, 2); list(set.privateMapping, 96);
  for (const mapping of set.privateMapping) { fields(mapping, ['judgeId', 'itemId', 'slotId', 'normalizationSha256']);
    requireTrue(JUDGES.includes(mapping.judgeId)); text(mapping.slotId, 128); requireTrue(/^[a-f0-9]{64}$/u.test(mapping.normalizationSha256)); }
  const contexts = set.packets.map((packet, index) => { requireTrue(packet.judgeId === JUDGES[index]); return packetContext(packet, set.privateMapping); });
  const slots = contexts.map(rows => [...rows.values()].map(row => row.slotId));
  requireTrue(slots[0].length === new Set(slots[0]).size && hash([...slots[0]].sort()) === hash([...slots[1]].sort())
    && slots[1].length === new Set(slots[1]).size && set.privateMapping.length === slots[0].length * 2);
  const rawInputs = descriptors.rawFirstResponses.value;
  requireTrue(Array.isArray(rawInputs) && !types.isProxy(rawInputs) && Object.getPrototypeOf(rawInputs) === Array.prototype);
  const rawDescriptors = Object.getOwnPropertyDescriptors(rawInputs);
  requireTrue(rawDescriptors.length.value === 2 && Reflect.ownKeys(rawDescriptors).length === 3);
  const raw = JUDGES.map((judgeId, index) => {
    const descriptor = rawDescriptors[String(index)]; requireTrue(descriptor?.enumerable && Object.hasOwn(descriptor, 'value'));
    const row = descriptor.value; requireTrue(row && typeof row === 'object' && !types.isProxy(row)
      && [Object.prototype, null].includes(Object.getPrototypeOf(row)));
    const own = Object.getOwnPropertyDescriptors(row);
    requireTrue(Reflect.ownKeys(own).length === 2 && ['judgeId', 'rawResponse'].every(key =>
      own[key]?.enumerable && Object.hasOwn(own[key], 'value')) && own.judgeId.value === judgeId);
    const value = own.rawResponse.value; requireTrue(value === null || typeof value === 'string'); return value;
  });
  const judges = set.packets.map((packet, index) => parseRaw(raw[index], packet, contexts[index]));
  const bySlot = judges.map(judge => new Map(judge.items.map(item => [item.slotId, item])));
  const items = [...slots[0]].sort().map(slotId => {
    const a = bySlot[0].get(slotId), b = bySlot[1].get(slotId);
    requireTrue(a.severe.length === b.severe.length);
    return { slotId, fields: Object.fromEntries(FIELD_NAMES.map(name =>
      [name, consensus(a.fields[name], b.fields[name], name.endsWith('Claims'))])),
    severe: a.severe.map((condition, index) => ({ conditionIndex: index, ...consensus(condition, b.severe[index], false) })) };
  });
  return freeze({ version: 'first-answer-parsed-judgments-v1', bindings: set.bindings,
    packetBindings: set.packets.map(({ judgeId, packetSha256 }) => ({ judgeId, packetSha256 })),
    judges, items, provenance: 'external-firstness-and-independent-execution-attestation-required-not-verified', limitations: [...LIMITATIONS] });
}
