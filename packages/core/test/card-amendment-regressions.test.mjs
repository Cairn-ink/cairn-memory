import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDetectRequest, buildVerifyRequest, detectCardAmendments, renderCardAmendments,
} from "@cairn-ink/core/routing";
import { MODEL_INPUT_TOKENS, modelRequestText } from "../src/capture/request-size.mjs";

const scope = { owner: "owner", namespace: "work" };
const quote = "Set width to 4.";
const session = { client: "client", sessionId: "later" };
const date = "2025-06-12";
const makeCapture = (content = quote) => ({
  scope: { ...scope }, ...session, date,
  messages: [{ id: "m1", role: "user", content }],
});
const card = {
  scope, id: "card", date: "2025-06-11", body: "Width: 3",
  sourceMessage: { client: "client", sessionId: "earlier", messageId: "original" },
};
const countTokens = text => text.length;
const requestTokens = request => countTokens(modelRequestText(request.system, request.input, request.maxOutputTokens));
const change = (new_value, quoted = quote) => ({ card_id: card.id, quote: quoted, new_value });

function makeModel(changes) {
  return {
    countTokens,
    detects: [],
    verifies: [],
    async detectChanges(request) {
      this.detects.push(request);
      return { changes };
    },
    async verifyChange(request) {
      this.verifies.push(request);
      return { applies: true, line: card.body };
    },
  };
}

test("verify and recall mask a model-supplied credential in an amendment value", async () => {
  const safe = `${quote} api_key=[REDACTED]`;
  const value = ` ${quote} ａｐｉ＿ｋｅｙ=ｓｋ－${"ａ".repeat(20)} `;
  const model = makeModel([change(value, safe)]);
  const { amendments } = await detectCardAmendments({ model, capture: makeCapture(safe), cards: [card] });

  assert.equal(model.verifies[0].input.split("\n").at(-1), `NEW VALUE:  ${safe} `);
  assert.equal(amendments[0].amendment.sentence, safe);
  assert.equal(amendments[0].amendment.quote, safe);
  const { text } = renderCardAmendments({ amendments: [amendments[0].amendment], countTokens, maxTokens: 500 });
  assert.ok(text.includes(safe));
});

test("the verify quote and the stored source substring use line-kept capture masks", async () => {
  const rawQuote = "-----BEGIN PRIVATE  KEY-----\nsynthetic payload\n-----END PRIVATE  KEY-----";
  const model = makeModel([change("Width is 4.", rawQuote.replaceAll("\n", " "))]);
  const { amendments } = await detectCardAmendments({ model, capture: makeCapture(rawQuote), cards: [card] });

  assert.ok(model.verifies[0].input.includes("\nQUOTE: [REDACTED]\n"));
  assert.equal(amendments[0].amendment.quote, "[REDACTED]");
});

test("an unmappable redaction drops only the affected candidate and counts the drop", async () => {
  const unsafe = `sk-${"a".repeat(16)}\u0301`;
  const model = makeModel([change(unsafe), change("Width is 4.")]);
  const { amendments, counters } = await detectCardAmendments({ model, capture: makeCapture(), cards: [card] });

  assert.equal(counters.redaction_unavailable, 1);
  assert.equal(model.verifies.length, 1);
  assert.equal(amendments[0].amendment.sentence, "Width is 4.");
});

test("verify keeps the model's untrimmed text and only the stored sentence is trimmed", async () => {
  const value = " Width is ４.\r\nKeep the label. ";
  const model = makeModel([change(value)]);
  const { amendments } = await detectCardAmendments({ model, capture: makeCapture(), cards: [card] });

  assert.ok(model.verifies[0].input.endsWith(`\nNEW VALUE: ${value}`));
  assert.equal(amendments[0].amendment.sentence, "Width is ４.\r\nKeep the label.");
});

test("detect measures the serialized envelope and rejects one unit above 6,000", () => {
  const plan = (content, inputLimit) =>
    buildDetectRequest({ conversation: makeCapture(content), cards: [card], countTokens, inputLimit });
  const full = quote + "x".repeat(MODEL_INPUT_TOKENS - requestTokens(plan(quote).request));

  assert.equal(requestTokens(plan(full).request), MODEL_INPUT_TOKENS);
  for (const inputLimit of [undefined, MODEL_INPUT_TOKENS + 1]) {
    assert.deepEqual(plan(full + "x", inputLimit), {
      request: null, listedCards: [], counters: { detect_skipped_oversize: 1 },
    });
  }
});

test("verify measures the serialized envelope and rejects one unit above 6,000", async () => {
  const base = buildVerifyRequest({ card, sessionDate: date, quote, newValue: "" });
  const full = "x".repeat(MODEL_INPUT_TOKENS - requestTokens(base));
  const model = makeModel([change(full + "x"), change(full)]);
  const { amendments, counters } = await detectCardAmendments({ model, capture: makeCapture(), cards: [card] });

  assert.equal(counters.verify_skipped_oversize, 1);
  assert.equal(model.verifies.length, 1);
  assert.equal(requestTokens(model.verifies[0]), MODEL_INPUT_TOKENS);
  assert.equal(amendments[0].amendment.sentence, full);
});

test("quote validation uses the same capture even when the messages property is replaced", async () => {
  const capture = makeCapture();
  const laterQuote = "Set width to 9.";
  const model = makeModel([change("Width is 9.", laterQuote), change("Width is 4.")]);
  const pending = detectCardAmendments({ model, capture, cards: [card] });
  capture.messages = [{ id: "m2", role: "user", content: laterQuote }];
  const { amendments, counters } = await pending;

  assert.equal(counters.quote_not_verbatim, 1);
  assert.equal(amendments[0].amendment.sourceMessage.messageId, "m1");
});

test("message and session fields are copied before the model call", async () => {
  const capture = makeCapture();
  const model = makeModel([change("Width is 4.")]);
  const pending = detectCardAmendments({ model, capture, cards: [card] });
  Object.assign(capture.messages[0], { id: "m2", content: "Set width to 9." });
  Object.assign(capture, { client: "other", sessionId: "next", date: "2025-06-13" });
  capture.scope.owner = "different";
  const { amendments } = await pending;

  assert.ok(model.detects[0].input.includes(`[turn 1] user: ${quote}`));
  assert.ok(model.verifies[0].input.includes(`LATER CONVERSATION DATE: ${date}`));
  assert.equal(amendments[0].amendment.date, date);
  assert.deepEqual(amendments[0].amendment.sourceMessage, { ...session, messageId: "m1" });
});

test("throwing option and limit getters resolve with a counted failure", async () => {
  const fail = () => { throw Error("option unavailable"); };
  const base = { model: makeModel([]), capture: makeCapture(), cards: [card] };
  const expected = { amendments: [], counters: { detect_failed: 1 } };

  for (const key of ["model", "capture", "cards", "limits"]) {
    assert.deepEqual(await detectCardAmendments(Object.defineProperty({ ...base }, key, { get: fail })), expected);
  }
  for (const key of ["timeoutMs", "inputLimit"]) {
    assert.deepEqual(await detectCardAmendments({ ...base, limits: { get [key]() { return fail(); } } }), expected);
  }
});

test("six same-day amendments keep the five latest insertions in insertion order", () => {
  const amendments = Array.from({ length: 6 }, (_, index) => ({ date, sentence: `Change ${index + 1}.` }));
  const shown = renderCardAmendments({ amendments, countTokens, maxTokens: 500 });

  assert.deepEqual(shown.amendments, amendments.slice(1));
  assert.deepEqual(shown.text.split("\n").slice(0, 5), amendments.slice(1).map(a => `${date}: ${a.sentence}`));
});
