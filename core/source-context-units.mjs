import { qualificationInput } from './claim-qualification-input.mjs';
import { partitionSourcePassages } from './source-passages.mjs';
import { boundedText, fail } from './validation.mjs';
import { redactSecrets } from '../plugins/cairn-memory/lib/redact.mjs';

const FIELDS = Object.freeze(['subject', 'property', 'scope', 'applies', 'value',
  'attribution', 'polarity', 'quantifier']);
const QUALIFICATION_FIELDS = Object.freeze(['subject', 'property', 'scope', 'applies',
  'value', 'attribution', 'commitment']);
const STATES = Object.freeze(['considered', 'adopted', 'rejected', 'not_approved',
  'not_withdrawn', 'pending_reconfirmation', 'unknown']);
const ATTRIBUTIONS = Object.freeze(['direct', 'reported', 'quoted', 'proposed', 'unknown']);
const POLARITIES = Object.freeze(['affirmed', 'negated', 'unknown']);
const QUANTIFIERS = Object.freeze(['universal', 'existential', 'zero', 'unspecified', 'unknown']);
const EPISTEMIC_STATES = Object.freeze(['tentative', 'asserted', 'unknown']);
const LABEL_LIMITS = Object.freeze({ subject: 160, property: 160, scope: 120,
  applies: 120, value: 160 });
const RAW_LIMIT = 6_000;
const PREPARED_LIMIT = 6_000;
const OUTPUT_LIMIT = 24_000;
const isRecord = value => value !== null && typeof value === 'object'
  && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, fields) => isRecord(value) && Reflect.ownKeys(value).length === fields.length
  && fields.every(field => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
const dense = (value, minimum, maximum) => Array.isArray(value)
  && Object.getPrototypeOf(value) === Array.prototype
  && value.length >= minimum && value.length <= maximum
  && Reflect.ownKeys(value).length === value.length + 1
  && Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  }).every(Boolean);
const index = value => Number.isSafeInteger(value) && value >= 0;
function jsonTree(value, active = new Set(), count = { nodes: 0 }, depth = 0) {
  if (++count.nodes > 12_000 || depth > 18) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || active.has(value)) return false;
  active.add(value);
  let valid;
  if (Array.isArray(value)) valid = dense(value, 0, 12_000)
    && value.every(item => jsonTree(item, active, count, depth + 1));
  else if (!isRecord(value)) valid = false;
  else valid = Reflect.ownKeys(value).length <= 1_000
    && Reflect.ownKeys(value).every(key => {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
        && jsonTree(descriptor.value, active, count, depth + 1);
    });
  active.delete(value);
  return valid;
}
function freeze(value, seen = new Set()) {
  if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value)) freeze(child, seen);
    Object.freeze(value);
  }
  return value;
}
const objectSchema = properties => ({ type: 'object', additionalProperties: false,
  properties, required: Object.keys(properties) });
const integerSchema = values => ({ type: 'integer', minimum: 0, enum: values });
const arraySchema = (items, minimum, maximum) => ({ type: 'array', items,
  minItems: minimum, maxItems: maximum });
function schemaFor(sources, version) {
  const sourceIds = sources.map(source => source.index);
  const receiptIds = [...new Set(sources.flatMap(source => source.receipts.map(receipt => receipt.index)))];
  const passageIds = [...new Set(sources.flatMap(source => source.receipts.flatMap(receipt =>
    receipt.passages.map(passage => passage.index))))];
  const refs = () => arraySchema(integerSchema(passageIds), 0, 4);
  const field = value => {
    if (version !== 3) return objectSchema({ value, evidence: refs() });
    const nullable = Array.isArray(value.type);
    const known = nullable ? { type: 'string' }
      : { type: 'string', enum: value.enum.filter(option => option !== 'unknown') };
    const unknown = nullable ? { type: 'null' } : { type: 'string', enum: ['unknown'] };
    return { anyOf: [
      objectSchema({ value: known, evidence: arraySchema(integerSchema(passageIds), 1, 4) }),
      objectSchema({ value: unknown, evidence: refs() }),
    ] };
  };
  const fields = { source: integerSchema(sourceIds), receipt: integerSchema(receiptIds) };
  for (const name of FIELDS) {
    const value = name in LABEL_LIMITS ? { type: ['string', 'null'] }
      : { type: 'string', enum: name === 'attribution' ? ATTRIBUTIONS
        : name === 'polarity' ? POLARITIES : QUANTIFIERS };
    fields[name] = field(value);
  }
  fields.eventTimeContext = refs();
  fields.reporterContext = refs();
  if (version >= 2) {
    fields.epistemicState = field({ type: 'string', enum: EPISTEMIC_STATES });
    fields.claimant = field({ type: ['string', 'null'] });
    fields.reporter = field({ type: ['string', 'null'] });
  }
  const units = arraySchema({ anyOf: [
    objectSchema({ ...fields, kind: { type: 'string', enum: ['factual_claim'] } }),
    objectSchema({ ...fields, kind: { type: 'string', enum: ['decision_state'] },
      state: field({ type: 'string', enum: STATES }) }),
  ] }, 0, 8);
  return freeze(objectSchema({ units, ...(version === 3 ? { reasonLinks: arraySchema(
    objectSchema({ from: integerSchema([0, 1, 2, 3, 4, 5, 6, 7]),
      to: integerSchema([0, 1, 2, 3, 4, 5, 6, 7]),
      relation: { type: 'string', enum: ['stated-reason-for'] },
      evidence: arraySchema(integerSchema(passageIds), 1, 4) }), 0, 8) } : {}) }));
}
function sourceInput(input) {
  const version = Object.hasOwn(input, 'version') ? input.version : 1;
  if ((version === 2 || version === 3 ? !exact(input, ['version', 'sources']) : !exact(input, ['sources'])) ||
      ![1, 2, 3].includes(version) ||
      !dense(input.sources, 1, 6)) fail('invalid_input');
  return input.sources.map((source, sourceIndex) => {
    if (!exact(source, ['receipts']) || !dense(source.receipts, 1, 4)) fail('invalid_input');
    return { index: sourceIndex, receipts: source.receipts.map((receipt, receiptIndex) => {
      if (!exact(receipt, ['role', 'excerpt']) || !['user', 'assistant'].includes(receipt.role)
        || typeof receipt.excerpt !== 'string' || !receipt.excerpt.isWellFormed()
        || !receipt.excerpt.trim() || receipt.excerpt.length > 800) fail('invalid_input');
      const normalized = receipt.excerpt.normalize('NFKC');
      if (redactSecrets(receipt.excerpt) !== receipt.excerpt
        || redactSecrets(normalized) !== normalized) fail('invalid_input');
      return { index: receiptIndex, role: receipt.role, excerpt: receipt.excerpt,
        passages: partitionSourcePassages(receipt.excerpt).map((part, passage) =>
          ({ index: passage, ...part })) };
    }) };
  });
}
function prepare(input) {
  let originals, raw;
  try {
    if (!jsonTree(input)) fail('invalid_input');
    raw = structuredClone(input);
    if (JSON.stringify(raw).length > RAW_LIMIT) fail('invalid_input');
    originals = sourceInput(raw);
  } catch { fail('invalid_input'); }
  const version = Object.hasOwn(raw, 'version') ? raw.version : 1;
  const prepared = freeze({ ...(version === 1 ? {} : { version }),
    sources: originals.map(source => ({ index: source.index,
    receipts: source.receipts.map(receipt => ({ index: receipt.index, role: receipt.role,
    passages: receipt.passages.map(({ index: passage, text }) => ({ index: passage, text })) })) })) });
  if (JSON.stringify(prepared).length > PREPARED_LIMIT) fail('invalid_input');
  return { input: prepared, responseSchema: schemaFor(prepared.sources, version),
    originals: freeze(originals), version };
}

/** Pure source-only model input and response shape; no prompt, transport, or storage. */
export function prepareSourceContextUnits(input) {
  const prepared = prepare(input);
  return freeze({ input: prepared.input, responseSchema: prepared.responseSchema });
}

function references(value, receipt) {
  if (!dense(value, 0, 4) || new Set(value).size !== value.length
    || value.some(id => !index(id) || !receipt.passages[id])) fail('invalid_model_output');
  return value;
}
function fieldReferences(field, receipt) {
  if (!exact(field, ['value', 'evidence'])) fail('invalid_model_output');
  return references(field.evidence, receipt);
}
function canonicalLabel(value, maximum) {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.isWellFormed() || value.length > maximum) {
    fail('invalid_model_output');
  }
  return value.normalize('NFKC');
}
function canonicalSourceLabel(value) {
  const label = canonicalLabel(value, 160);
  if (value !== null) {
    try {
      if (label.length > 160 || boundedText(label, 160) !== label ||
          redactSecrets(value) !== value || redactSecrets(label) !== label) {
        fail('invalid_model_output');
      }
    } catch { fail('invalid_model_output'); }
  }
  return label;
}
function anchors(ids, receipt) {
  return [...ids].sort((a, b) => a - b).map(id => {
    const passage = receipt.passages[id];
    return { passage: id, start: passage.start, end: passage.end, text: passage.text };
  });
}
function context(ids, receipt) {
  return { anchors: anchors(ids, receipt), interpretationStatus: 'model-proposed-unverified' };
}
function compilePrepared(prepared, proposed) {
  let output;
  try {
    if (!jsonTree(proposed) || JSON.stringify(proposed).length > OUTPUT_LIMIT) {
      fail('invalid_model_output');
    }
    output = structuredClone(proposed);
  } catch { fail('invalid_model_output'); }
  if (!exact(output, prepared.version === 3 ? ['units', 'reasonLinks'] : ['units']) ||
      !dense(output.units, 0, 8)) fail('invalid_model_output');
  const seen = new Set();
  const units = output.units.map((unit, unitIndex) => {
    const decision = unit?.kind === 'decision_state';
    const fields = ['source', 'receipt', ...FIELDS, 'eventTimeContext', 'reporterContext',
      ...(prepared.version >= 2 ? ['epistemicState', 'claimant', 'reporter'] : []),
      'kind', ...(decision ? ['state'] : [])];
    if (!exact(unit, fields) || !['factual_claim', 'decision_state'].includes(unit.kind)
      || !index(unit.source) || !index(unit.receipt)) fail('invalid_model_output');
    const receipt = prepared.originals[unit.source]?.receipts[unit.receipt];
    if (!receipt) fail('invalid_model_output');
    const selected = [];
    const values = {};
    for (const name of FIELDS) {
      selected.push(...fieldReferences(unit[name], receipt));
      const value = name in LABEL_LIMITS ? canonicalLabel(unit[name].value, LABEL_LIMITS[name])
        : unit[name].value;
      const allowed = name === 'attribution' ? ATTRIBUTIONS
        : name === 'polarity' ? POLARITIES : name === 'quantifier' ? QUANTIFIERS : null;
      if (allowed && (typeof value !== 'string' || !allowed.includes(value))) {
        fail('invalid_model_output');
      }
      const unknown = value === null || (allowed && value === 'unknown');
      if (!unknown && !unit[name].evidence.length) fail('invalid_model_output');
      values[name] = value;
    }
    if (decision) {
      selected.push(...fieldReferences(unit.state, receipt));
      if (!STATES.includes(unit.state.value)
        || (unit.state.value !== 'unknown' && !unit.state.evidence.length)) {
        fail('invalid_model_output');
      }
    }
    const timeRefs = references(unit.eventTimeContext, receipt);
    const reporterRefs = references(unit.reporterContext, receipt);
    selected.push(...timeRefs, ...reporterRefs);
    let stance;
    if (prepared.version >= 2) {
      const epistemicRefs = fieldReferences(unit.epistemicState, receipt);
      const claimantRefs = fieldReferences(unit.claimant, receipt);
      const reporterLabelRefs = fieldReferences(unit.reporter, receipt);
      const epistemicState = unit.epistemicState.value;
      const claimant = canonicalSourceLabel(unit.claimant.value);
      const reporter = canonicalSourceLabel(unit.reporter.value);
      if (!EPISTEMIC_STATES.includes(epistemicState) ||
          (epistemicState !== 'unknown' && !epistemicRefs.length) ||
          (claimant !== null && !claimantRefs.length) ||
          (reporter !== null && !reporterLabelRefs.length)) fail('invalid_model_output');
      selected.push(...epistemicRefs, ...claimantRefs, ...reporterLabelRefs);
      stance = {
        epistemicState: { value: epistemicState, anchors: anchors(epistemicRefs, receipt),
          interpretationStatus: 'model-proposed-unverified' },
        claimant: { value: claimant, anchors: anchors(claimantRefs, receipt),
          interpretationStatus: 'model-proposed-unverified' },
        reporter: { value: reporter, anchors: anchors(reporterLabelRefs, receipt),
          interpretationStatus: 'model-proposed-unverified' },
      };
    }
    const focusIds = [...new Set(selected)].sort((a, b) => a - b);
    if (focusIds.length < 1 || focusIds.length > 4) fail('invalid_model_output');
    const commitment = decision && ['considered', 'adopted', 'rejected'].includes(unit.state.value)
      ? unit.state.value : 'unknown';
    const evidence = Object.fromEntries(FIELDS.map(name => [name, unit[name].evidence]));
    evidence.commitment = commitment === 'unknown' ? [] : unit.state.evidence;
    const qualificationAnchors = focusIds.map(id => ({ receiptIndex: unit.receipt,
      start: receipt.passages[id].start, end: receipt.passages[id].end,
      text: receipt.passages[id].text,
      fields: QUALIFICATION_FIELDS.filter(name => evidence[name].includes(id)) }))
      .filter(anchor => anchor.fields.length);
    let qualification;
    try {
      const receipts = prepared.originals[unit.source].receipts.map(sourceReceipt =>
        ({ role: sourceReceipt.role, excerpt: sourceReceipt.excerpt }));
      qualification = qualificationInput({ version: 1,
        slot: { subject: values.subject, property: values.property,
          scope: values.scope, applies: values.applies }, value: values.value,
        attribution: values.attribution, commitment, anchors: qualificationAnchors }, receipts);
    } catch { fail('invalid_model_output'); }
    const compiled = { index: unitIndex, source: unit.source, receipt: unit.receipt,
      focus: anchors(focusIds, receipt), qualification,
      polarity: { value: values.polarity, anchors: anchors(unit.polarity.evidence, receipt) },
      quantifier: { value: values.quantifier, anchors: anchors(unit.quantifier.evidence, receipt) },
      kind: unit.kind,
      ...(decision ? { state: { value: unit.state.value,
        anchors: anchors(unit.state.evidence, receipt) } } : {}),
      eventTimeContext: context(timeRefs, receipt),
      reporterContext: context(reporterRefs, receipt),
      ...(stance ?? {}),
      interpretationStatus: 'model-proposed-unverified' };
    const signature = JSON.stringify({ ...compiled, index: 0 });
    if (seen.has(signature)) fail('invalid_model_output');
    seen.add(signature);
    return compiled;
  });
  let reasonLinks;
  if (prepared.version === 3) {
    if (!dense(output.reasonLinks, 0, 8)) fail('invalid_model_output');
    const linked = new Set();
    reasonLinks = output.reasonLinks.map(link => {
      if (!exact(link, ['from', 'to', 'relation', 'evidence']) ||
          !index(link.from) || !index(link.to) || link.from === link.to ||
          link.relation !== 'stated-reason-for') fail('invalid_model_output');
      const from = units[link.from];
      const to = units[link.to];
      if (!from || !to || from.kind !== 'factual_claim' || to.kind !== 'decision_state' ||
          from.source !== to.source || from.receipt !== to.receipt) fail('invalid_model_output');
      const pair = `${link.from}:${link.to}`;
      if (linked.has(pair)) fail('invalid_model_output');
      linked.add(pair);
      const receipt = prepared.originals[from.source].receipts[from.receipt];
      const evidence = references(link.evidence, receipt);
      if (!evidence.length) fail('invalid_model_output');
      return { from: link.from, to: link.to, relation: link.relation,
        source: from.source, receipt: from.receipt, anchors: anchors(evidence, receipt),
        interpretationStatus: 'model-proposed-unverified' };
    });
  }
  const result = { ...(prepared.version === 1 ? {} : { version: prepared.version }),
    units, ...(reasonLinks === undefined ? {} : { reasonLinks }),
    status: 'assessment-only', persistence: 'not-stored' };
  if (JSON.stringify(result).length > OUTPUT_LIMIT) fail('invalid_model_output');
  return freeze(result);
}

/** Compile structural source bindings only; accepted units remain unverified. */
export function compileSourceContextUnits(input, proposed) {
  return compilePrepared(prepare(input), proposed);
}
