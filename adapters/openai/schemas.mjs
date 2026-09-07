const string = { type: 'string' };
const integer = { type: 'integer', minimum: 0 };
const array = (items, maxItems) => ({ type: 'array', items, maxItems });
const object = (properties) => ({ type: 'object', properties,
  required: Object.keys(properties), additionalProperties: false });
const newTopic = { title: string, parentL2Ids: array(string, 3) };
const placement = { memoryId: string, parentIds: array(string, 3) };
const refs = object({ refs: array(object({ namespaceIndex: integer,
  memoryId: string, revision: { type: 'integer', minimum: 1 } }), 24) });

export const schemas = {
  extract: object({ items: array(object({ content: { type: 'string', maxLength: 600 },
    kind: { type: 'string', enum: ['fact', 'preference', 'decision', 'instruction', 'context'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    sourceIndices: { ...array(integer, 4), minItems: 1 },
  }), 5) }),
  classify: object({ items: { ...array({ anyOf: [object(placement), object({ ...placement,
    newL1: { anyOf: [object(newTopic), object({ ...newTopic, newL2Title: string })] },
  })] }, 5), minItems: 1 } }),
  select: refs,
  rank: refs,
};
