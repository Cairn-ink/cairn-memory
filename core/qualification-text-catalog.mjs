const KINDS = new Set(['fact', 'preference', 'decision', 'instruction', 'context']);
const ROLES = new Set(['user', 'assistant']);
const invalid = () => { throw new Error('invalid_qualification_text_catalog'); };

function dataObject(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || keys.some((key) => !own.includes(key))) invalid();
  return Object.fromEntries(keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    return [key, descriptor.value];
  }));
}

function dataArray(value, minimum, maximum) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum
    || Reflect.ownKeys(value).length !== value.length + 1) invalid();
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    return descriptor.value;
  });
}

function text(value, maximum) {
  if (typeof value !== 'string' || !value.length || value.length > maximum
    || !value.isWellFormed()) invalid();
  return value;
}

function index(value) {
  if (!Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Strictly detach a catalog and expand its original model-facing candidates. */
export function snapshotQualificationTextCatalog(input) {
  try {
    const root = dataObject(input, ['inputMode', 'texts', 'items']);
    if (root.inputMode !== 'text-catalog-v1') invalid();
    const texts = dataArray(root.texts, 1, 100).map((value) => text(value, 200));
    if (new Set(texts).size !== texts.length) invalid();
    const seenTexts = new Map();
    const seenItems = new Set();
    const seenCandidates = new Set();
    let totalCandidates = 0;
    const items = dataArray(root.items, 1, 5).map((rawItem) => {
      const item = dataObject(rawItem, ['itemIndex', 'content', 'kind', 'candidates']);
      const itemIndex = index(item.itemIndex);
      if (seenItems.has(itemIndex) || !KINDS.has(item.kind)) invalid();
      seenItems.add(itemIndex);
      const content = text(item.content, 600);
      const candidates = dataArray(item.candidates, 1, 20).map((rawCandidate) => {
        const candidate = dataObject(rawCandidate, ['candidateIndex', 'role', 'textIndex']);
        const candidateIndex = index(candidate.candidateIndex);
        const textIndex = index(candidate.textIndex);
        if (seenCandidates.has(candidateIndex) || !ROLES.has(candidate.role)
          || textIndex >= texts.length) invalid();
        seenCandidates.add(candidateIndex);
        const candidateText = texts[textIndex];
        if (!seenTexts.has(candidateText)) {
          if (textIndex !== seenTexts.size) invalid();
          seenTexts.set(candidateText, textIndex);
        } else if (seenTexts.get(candidateText) !== textIndex) invalid();
        totalCandidates += 1;
        if (totalCandidates > 100) invalid();
        return { candidateIndex, role: candidate.role, textIndex };
      });
      return { itemIndex, content, kind: item.kind, candidates };
    });
    if (seenTexts.size !== texts.length) invalid();
    const catalog = freeze({ inputMode: 'text-catalog-v1', texts,
      items });
    const expanded = freeze({ items: items.map((item) => ({ itemIndex: item.itemIndex,
      content: item.content, kind: item.kind,
      candidates: item.candidates.map((candidate) => ({ candidateIndex: candidate.candidateIndex,
        role: candidate.role, text: texts[candidate.textIndex] })) })) });
    return freeze({ catalog, expanded });
  } catch { invalid(); }
}

/** Canonical first-occurrence text sharing; only the immutable core snapshot calls this. */
export function createQualificationTextCatalog(inline) {
  const texts = [];
  const positions = new Map();
  const items = inline.items.map((item) => ({ itemIndex: item.itemIndex,
    content: item.content, kind: item.kind,
    candidates: item.candidates.map((candidate) => {
      let textIndex = positions.get(candidate.text);
      if (textIndex === undefined) {
        textIndex = texts.length;
        positions.set(candidate.text, textIndex);
        texts.push(candidate.text);
      }
      return { candidateIndex: candidate.candidateIndex, role: candidate.role, textIndex };
    }) }));
  return snapshotQualificationTextCatalog({ inputMode: 'text-catalog-v1', texts, items });
}
