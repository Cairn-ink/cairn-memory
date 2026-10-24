// Local, closed encoding of protocol §6. This validates shape, never equivalence.
export const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const str = { type: 'string' };
const enumeration = (...values) => ({ enum: values });
const list = items => ({ type: 'array', items });
const ref = name => ({ $ref: `#/$defs/${name}` });
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const decimal = { type: 'string', pattern: '^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$' };
const instant = { type: 'string', format: 'date-time' };
const variant = (type, properties) => object({ type: enumeration(type), ...properties });
export const answerSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:hr3:independent-challenge:answer:v1',
  ...ref('Answer'),
  $defs: {
    Value: { anyOf: [
      variant('Text', { text: str }), variant('Boolean', { value: { type: 'boolean' } }),
      variant('Quantity', { decimal, unit: str }), variant('Instant', { iso: instant }),
      variant('Range', { lower: nullable(decimal), upper: nullable(decimal), lowerClosed: { type: 'boolean' }, upperClosed: { type: 'boolean' }, unit: str }),
    ] },
    Scope: object({ any: { ...list(object({ all: list(object({ field: enumeration('country', 'plan', 'channel'), values: { ...list(str), minItems: 1, uniqueItems: true } })) })), minItems: 1 } }),
    Interval: object({ from: nullable(instant), to: nullable(instant) }),
    Citation: object({ intent: enumeration('current', 'history'), item: { type: 'integer', minimum: 0 }, unit: enumeration('body', 'receipt'), source: nullable({ type: 'integer', minimum: 0 }), quote: str, occurrence: { type: 'integer', minimum: 1 } }),
    Claim: object({ subject: str, predicate: str, value: ref('Value'), scope: ref('Scope'), valid: ref('Interval'), qualifiers: list(object({ key: str, value: ref('Value') })), citations: list(ref('Citation')) }),
    Answer: object({
      current: object({ status: enumeration('active', 'no_active_decision', 'unresolved'), claims: list(ref('Claim')) }),
      old: object({ status: enumeration('available', 'unavailable', 'none'), records: list(object({ status: enumeration('previously_adopted', 'erroneous', 'expired'), claims: list(ref('Claim')) })) }),
      reason: object({ status: enumeration('stated', 'not_stated', 'unavailable'), nodes: list(object({ id: str, claim: ref('Claim') })), edges: list(object({ from: str, to: str, citations: list(ref('Citation')) })) }),
    }),
  },
};

export function validateShape(value, schema = answerSchema, path = '$', root = answerSchema) {
  if (schema.$ref) return validateShape(value, root.$defs[schema.$ref.split('/').at(-1)], path, root);
  if (schema.anyOf) {
    if (schema.anyOf.some(s => validateShape(value, s, path, root).length === 0)) return [];
    return [`${path}: does not match any allowed variant`];
  }
  const errors = [];
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: invalid enum ${JSON.stringify(value)}`);
  if (schema.type) {
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const match = schema.type === 'integer' ? Number.isInteger(value) : actual === schema.type;
    if (!match) return [...errors, `${path}: expected ${schema.type}`];
  }
  if (schema.type === 'object') {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: required`);
    for (const [key, child] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key)) errors.push(`${path}.${key}: unknown field`);
      else errors.push(...validateShape(child, schema.properties[key], `${path}.${key}`, root));
    }
  }
  if (schema.type === 'array') {
    if (value.length < (schema.minItems ?? 0)) errors.push(`${path}: too few items`);
    if (schema.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length) errors.push(`${path}: repeated items`);
    value.forEach((v, i) => errors.push(...validateShape(v, schema.items, `${path}[${i}]`, root)));
  }
  if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${path}: invalid decimal`);
  if (schema.format === 'date-time' && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))) errors.push(`${path}: invalid instant`);
  if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below minimum`);
  return errors;
}
