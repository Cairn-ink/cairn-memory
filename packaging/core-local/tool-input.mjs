// The installed profile uses a closed subset of JSON Schema. The issue text
// here is part of the installed MCP tool response.
function issues(schema, value, prefix, out) {
  const put = message => out.push(prefix ? prefix + ': ' + message : message);
  if (schema.anyOf) {
    if (!schema.anyOf.some(option => {
      const failures = [];
      issues(option, value, '', failures);
      return failures.length === 0;
    })) put('invalid_input');
    return;
  }
  if (schema.enum) {
    if (!schema.enum.includes(value)) put('Invalid option: expected one of ' + schema.enum.map(x => JSON.stringify(x)).join('|'));
    return;
  }
  if (Object.hasOwn(schema, 'const')) {
    if (value !== schema.const) put('Invalid input: expected ' + JSON.stringify(schema.const));
    return;
  }
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const expected = schema.type === 'integer' ? 'number' : schema.type;
  if (type !== expected) {
    put('Invalid input: expected ' + expected + ', received ' + type);
    return;
  }
  const path = key => prefix ? prefix + '.' + key : String(key);
  if (type === 'object') {
    for (const [key, shape] of Object.entries(schema.properties)) {
      if (Object.hasOwn(value, key) || schema.required?.includes(key)) issues(shape, value[key], path(key), out);
    }
    const extras = Object.keys(value).filter(key => !Object.hasOwn(schema.properties, key));
    if (extras.length) put((extras.length === 1 ? 'Unrecognized key: ' : 'Unrecognized keys: ') +
      extras.map(key => JSON.stringify(key)).join(', '));
    return;
  }
  if (value === null) return;
  if (type === 'array') value.forEach((item, index) => issues(schema.items, item, path(index), out));
  const minimum = schema.minLength ?? schema.minItems ?? schema.minimum;
  const maximum = schema.maxLength ?? schema.maxItems ?? schema.maximum;
  const measured = type === 'number' ? value : value.length;
  const unit = type === 'string' ? ' characters' : type === 'array' ? ' items' : '';
  if (schema.type === 'integer' && !Number.isSafeInteger(value)) {
    put('Invalid input: expected int, received ' + (Number.isInteger(value) ? 'unsafe integer' : 'number'));
    return;
  }
  if (measured < minimum) put('Too small: expected ' + type + ' to have >=' + minimum + unit);
  if (measured > maximum) put('Too big: expected ' + type + ' to have <=' + maximum + unit);
  if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) {
    put('Invalid string: must match pattern /' + schema.pattern + '/');
  }
}

export function toolInputError(tool, input) {
  const errors = [];
  issues(tool.inputSchema, input, '', errors);
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    if (tool.name === 'fetch_memory_candidate_evidence') {
      const { snapshot, refs, intent } = input;
      if (snapshot === undefined ? refs === undefined || intent === undefined
        : refs !== undefined || intent !== undefined) errors.push('Invalid input');
      if (Array.isArray(refs)) refs.forEach((ref, index) => {
        if (ref && Object.hasOwn(ref, 'ns') && (ref.type === 'card') !== Object.hasOwn(ref, 'bodyRev')) {
          errors.push('refs.' + index + ': invalid_input');
        }
      });
    }
    if (Array.isArray(input.types) && new Set(input.types).size !== input.types.length) errors.push('types: Invalid input');
  }
  if (errors.length) return 'Input validation error: Invalid arguments for tool ' + tool.name + ': ' + errors.join(', ');
}
