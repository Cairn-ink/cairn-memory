import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  capCatalogTopics, checkProposalAgainstCatalog, CLASSIFICATION_CATALOG_LIMIT, CLASSIFY_PLACEMENT_PROMPT,
  classificationWire, classifySchema, CoreError, memoryGuards, packClassification,
  placementProposal, placementTitle, uniqueIds,
} from '../src/index.mjs';

const golden = JSON.parse(readFileSync(new URL('./fixtures/topics/engine-goldens.json', import.meta.url), 'utf8'));

export const ENGINE_TO_CORE_CODES = Object.freeze({
  invalid_input: 'invalid_input',
  invalid_identifier: 'invalid_input',
  invalid_revision: 'invalid_input',
  invalid_text: 'invalid_text',
  invalid_model_output: 'invalid_model_output',
  token_count_unavailable: 'token_count_unavailable',
  invalid_openai_request: 'invalid_input',
  invalid_classification_wire_output: 'invalid_model_output',
});

function assertOutcome(run, expected) {
  if (Object.hasOwn(expected, 'error')) {
    assert.ok(Object.hasOwn(ENGINE_TO_CORE_CODES, expected.error), expected.error);
    assert.throws(run, { name: CoreError.name, code: ENGINE_TO_CORE_CODES[expected.error] });
  } else {
    assert.deepStrictEqual(run(), expected.value);
  }
}

const validation = { uniqueIds, memoryGuards, placementTitle, placementProposal };
for (const entry of golden.P1) {
  test('P1 / ' + entry.name, () => {
    const { method, args, hole } = entry;
    const input = structuredClone(args);
    if (hole) delete (method === 'placementProposal' ? input[0].items : input[0])[0];
    assertOutcome(() => validation[method](...input), entry);
  });
}

for (const entry of golden.P2) {
  test('P2 / ' + entry.name, () => {
    assertOutcome(() => {
      checkProposalAgainstCatalog(entry.proposal, entry.shownMap, entry.mapExhausted);
      return null;
    }, entry);
  });
}

// Mirrors the engine's synthetic counter used in the classification budget tests.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]/gu;
const counters = {
  points: (text) => [...text].length,
  cjk: (text) => {
    const points = [...text].length;
    const cjk = text.match(CJK)?.length ?? 0;
    return Math.ceil(1.15 * (cjk + (points - cjk) / 4));
  },
  fits: () => 1,
  overflow: () => 6001,
  invalid: () => NaN,
};

for (const entry of golden.P3) {
  test('P3 / ' + entry.name, () => {
    const { system, input } = entry;
    const model = { countTokens: counters[entry.counter] };
    const pack = () => {
      const packed = packClassification(model, system, input);
      return { ...packed, sameInput: packed.input === input };
    };
    assertOutcome(pack, entry);
    assertOutcome(pack, entry);
  });
}

for (const entry of golden.P4) {
  test('P4 / ' + entry.name, () => {
    assert.deepStrictEqual(Buffer.from(CLASSIFY_PLACEMENT_PROMPT), Buffer.from(entry.value));
  });
}

for (const entry of golden.P5) {
  test('P5 / ' + entry.name, () => {
    assertOutcome(() => classifySchema(entry.input), entry.schema);
    const wire = classificationWire(entry.input);
    assert.deepStrictEqual(wire.input, entry.wireInput);
    assertOutcome(() => classifySchema(wire.input), entry.wireSchema);
    if (entry.decode) assertOutcome(() => wire.decode(entry.output), entry.decode);
  });
}

for (const entry of golden.P7.filter((entry) => entry.orderInput)) {
  test('P7 / ' + entry.name, () => {
    assert.equal(CLASSIFICATION_CATALOG_LIMIT, 100);
    const result = capCatalogTopics(entry.orderInput);
    assert.deepStrictEqual({ ...result, count: result.topics.length }, entry.value);
  });
}
