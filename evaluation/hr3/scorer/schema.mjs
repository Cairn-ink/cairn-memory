// Closed A-4 §4 answers; private §7 causal graphs remain in gold only.
const str = { type: 'string' };
const arr = (items, minItems = 0) => ({ type: 'array', items, minItems });
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const enumeration = (...values) => ({ enum: values });
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const ref = name => ({ $ref: `#/$defs/${name}` });
const decimal = { type: 'string', pattern: String.raw`^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$` };
const defs = {
  Value: { oneOf: [
    obj({ type: { const: 'Text' }, text: str }),
    obj({ type: { const: 'Boolean' }, value: { type: 'boolean' } }),
    obj({ type: { const: 'Quantity' }, decimal, unit: str }),
    obj({ type: { const: 'Instant' }, iso: str }),
    obj({ type: { const: 'Range' }, lower: nullable(decimal), upper: nullable(decimal), lowerClosed: { type: 'boolean' }, upperClosed: { type: 'boolean' }, unit: str }),
  ] },
  Scope: obj({ any: arr(obj({ all: arr(obj({ field: enumeration('country', 'plan', 'channel'), values: arr(str, 1) })) }), 1) }),
  Interval: obj({ from: nullable(str), to: nullable(str) }),
  Citation: obj({ intent: enumeration('current', 'history'), item: { type: 'integer', minimum: 0 }, unit: enumeration('body', 'receipt'), source: nullable({ type: 'integer', minimum: 0 }), quote: str, occurrence: { type: 'integer', minimum: 1 } }),
  Claim: obj({ subject: str, predicate: str, value: ref('Value'), scope: ref('Scope'), valid: ref('Interval'), qualifiers: arr(obj({ key: str, value: ref('Value') })), citations: arr(ref('Citation')) }),
};
defs.GoldClaim = obj(Object.fromEntries(Object.entries(defs.Claim.properties).filter(([k]) => k !== 'citations')));
const slot = content => ({ oneOf: [
  obj({ state: { const: 'value' }, value: content }),
  obj({ state: enumeration('not_specified', 'unavailable', 'unresolved'), value: { type: 'null' } }),
] });
defs.Row = obj({ scope: ref('Scope'), valid: ref('Interval'), route: slot(str),
  approval: slot({ type: 'boolean' }), cap: slot(obj({ decimal, unit: str })), citations: arr(ref('Citation')) });
defs.GoldRow = obj(Object.fromEntries(Object.entries(defs.Row.properties).filter(([k]) => k !== 'citations')));
const current = row => obj({ status: enumeration('active', 'no_active_decision', 'unresolved'), rows: arr(ref(row)) });
const old = row => obj({ status: enumeration('available', 'unavailable', 'none'), records: arr(obj({
  predecessor_turn: str, status: enumeration('previously_adopted', 'erroneous', 'expired', 'unavailable', 'unresolved'), rows: arr(ref(row)),
})) });
const node = claim => obj({ id: str, claim: ref(claim) });
const answer = obj({ current: current('Row'), old: old('Row'),
  reason: obj({ status: enumeration('stated', 'not_stated', 'unavailable'), support: arr(ref('Citation')) }) });
const span = obj({ id: str, origin: str, start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 1 }, text: str });
const goldEdge = obj({ from: str, to: str, support: arr(arr(str, 1), 1) });
const gold = obj({ question: str, current: current('GoldRow'), old: old('GoldRow'), reason: obj({ status: enumeration('stated', 'not_stated', 'unavailable'), nodes: arr(node('GoldClaim')), acceptedGraphs: arr(obj({ edges: arr(goldEdge, 1) })) }), supportSpans: arr(span) });
const address = obj({ intent: enumeration('current', 'history'), item: { type: 'integer', minimum: 0 }, unit: enumeration('body', 'receipt'), source: nullable({ type: 'integer', minimum: 0 }) });
// Each segment is an actually delivered slice, after normalization and before
// concatenation. Omitted text is never supplied. No raw document is needed.
const segment = obj({ origin: str, start: { type: 'integer', minimum: 0 }, text: { type: 'string' } });
defs.DeliveredUnit = obj({ ...address.properties, aliases: arr(address), segments: arr(segment, 1), normalize: { type: 'boolean' }, truncate: nullable({ type: 'integer', minimum: 0 }) });
function root(title, shape) {
  const referenced = {};
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      const name = value.$ref.split('/').at(-1);
      if (!Object.hasOwn(referenced, name)) { referenced[name] = defs[name]; visit(defs[name]); }
    }
    Object.values(value).forEach(visit);
  }
  visit(shape);
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', title, ...shape, $defs: referenced };
}
export const answerSchema = root('HR-3 A-4 slot answer v2', answer);
export const goldSchema = root('HR-3 A-4 private gold v2', gold);
export const submissionSchema = root('HR-3 A-4 scorer submission v2', obj({ answer, delivered: arr(ref('DeliveredUnit')) }));

// Deliberately small evaluator for exactly the JSON Schema vocabulary above.
// External generators may use any draft-2020-12 validator on the JSON files.
export function validate(schema, value) {
  const errors = [];
  function visit(s, v, path, out) {
    if (s.$ref) return visit(schema.$defs[s.$ref.split('/').at(-1)], v, path, out);
    for (const key of ['anyOf', 'oneOf']) if (s[key]) {
      const results = s[key].map(sub => { const e = []; visit(sub, v, path, e); return e; });
      const count = results.filter(e => !e.length).length;
      if (count === 0 || (key === 'oneOf' && count !== 1)) out.push(`${path}: ${key} mismatch`);
      return;
    }
    if ('const' in s && v !== s.const) out.push(`${path}: wrong constant`);
    if (s.enum && !s.enum.includes(v)) out.push(`${path}: unknown enum`);
    if (s.type) {
      const good = s.type === 'null' ? v === null : s.type === 'array' ? Array.isArray(v) : s.type === 'integer' ? Number.isSafeInteger(v) : s.type === 'object' ? v !== null && typeof v === 'object' && !Array.isArray(v) : typeof v === s.type;
      if (!good) { out.push(`${path}: expected ${s.type}`); return; }
    }
    if (typeof v === 'string') {
      if (s.minLength && [...v].length < s.minLength) out.push(`${path}: empty string`);
      if (s.pattern && !new RegExp(s.pattern).test(v)) out.push(`${path}: pattern mismatch`);
    }
    if (typeof v === 'number' && s.minimum !== undefined && v < s.minimum) out.push(`${path}: below minimum`);
    if (Array.isArray(v)) {
      if (v.length < (s.minItems ?? 0)) out.push(`${path}: too few items`);
      if (s.items) v.forEach((item, i) => visit(s.items, item, `${path}/${i}`, out));
    }
    if (s.properties && v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const k of s.required) if (!Object.hasOwn(v, k)) out.push(`${path}/${k}: required`);
      for (const k of Object.keys(v)) {
        if (!Object.hasOwn(s.properties, k)) out.push(`${path}/${k}: additional property`);
        else visit(s.properties[k], v[k], `${path}/${k}`, out);
      }
    }
  }
  visit(schema, value, '$', errors);
  return errors;
}
