import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDetectRequest, buildVerifyRequest, checkChangeCandidates, detectCardAmendments, renderCardAmendments,
} from "@cairn-ink/core/routing";
import { MODEL_INPUT_TOKENS, modelRequestText } from "../src/capture/request-size.mjs";
import { prepareCoreText } from "../src/privacy/text.mjs";

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
  const model = makeModel([change("Width is 4.", rawQuote.replaceAll("\n", " ")), change("Width is 4.", "[REDACTED]")]);
  const { amendments, counters } = await detectCardAmendments({ model, capture: makeCapture(rawQuote), cards: [card] });

  assert.deepEqual(counters, { detect_calls: 1, quote_not_verbatim: 1, verify_calls: 1 });
  assert.ok(model.detects[0].input.includes("[turn 1] user: [REDACTED]\n"));
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

test("verify and storage use NFKC while keeping the model's line endings", async () => {
  const value = " Width is ４.\r\nKeep the label. ";
  const model = makeModel([change(value)]);
  const { amendments } = await detectCardAmendments({ model, capture: makeCapture(), cards: [card] });

  assert.ok(model.verifies[0].input.endsWith("\nNEW VALUE:  Width is 4.\r\nKeep the label. "));
  assert.equal(amendments[0].amendment.sentence, "Width is 4.\r\nKeep the label.");
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

for (const [description, candidate, capture] of [
  ["a NUL in the model value", change('"refresh_\u0000token":"sensitive-prefix password=long-password"'), makeCapture()],
  ["a lone surrogate in the model value", change("Width is \uD8004."), makeCapture()],
  ["a lone surrogate in the model quote", change("Width is 4.", `${quote}\uD800`), makeCapture()],
]) {
  test(`amendment detection drops ${description} before verification`, async () => {
    const model = makeModel([candidate]);
    const { amendments, counters } = await detectCardAmendments({ model, capture, cards: [card] });

    assert.equal(model.verifies.length, 0);
    assert.deepEqual(amendments, []);
    assert.equal(counters.ill_formed_model_text, 1);
  });
}

for (const [description, candidate] of [
  ["a NUL value and a blank quote", change("\0", "")],
  ["a NUL quote and a blank value", change("", "\0")],
  ["a lone surrogate in the card ID and an unexpected field", { ...change("Width is 4."), card_id: "\uD800", extra: true }],
]) {
  test(`ill-formed model text takes precedence for ${description}`, async () => {
    const model = makeModel([candidate]);
    const { amendments, counters } = await detectCardAmendments({ model, capture: makeCapture(), cards: [card] });

    assert.equal(model.verifies.length, 0);
    assert.deepEqual(amendments, []);
    assert.deepEqual(counters, { detect_calls: 1, ill_formed_model_text: 1 });
  });
}

const fullwidthMarker = "password=［ＲＥＤＡＣＴＥＤ］";
const pem = "-----BEGIN PRIVATE KEY-----\r\nsynthetic CRLF payload\r\n-----END PRIVATE KEY-----";

for (const [description, content, fragment] of [
  ["overlapping assignments", "password=auth_token=overlap-secret", "overlap-secret"],
  ["a quoted refresh token", '{"refresh_token":"prefix-secret password=long-password"}', "long-password"],
  ["a quoted access token", '{"access_token":"prefix-token auth_token=nested-secret"}', "nested-secret"],
  ["compatibility-width overlapping assignments", "ｐａｓｓｗｏｒｄ＝auth_token=compat-secret", "compat-secret"],
]) {
  test(`redacted capture rejects a masked fragment from ${description}`, async () => {
    const capture = makeCapture(content);
    const changes = [change("Width is 4.", fragment)];
    const model = makeModel(changes);
    const { amendments, counters } = await detectCardAmendments({ model, capture, cards: [card] });

    assert.deepEqual(counters, { detect_calls: 1, quote_not_verbatim: 1 });
    assert.deepEqual(model.verifies, []);
    assert.deepEqual(amendments, []);
    const { request } = buildDetectRequest({ conversation: capture, cards: [card], countTokens });
    assert.equal(request.input, model.detects[0].input);
    assert.ok(request.input.includes("[REDACTED]"));
    assert.ok(!request.input.includes(fragment));
    assert.deepEqual(checkChangeCandidates({
      changes, listedCards: [card], captureMessages: capture.messages, captureSession: capture,
    }), { candidates: [], drops: { quote_not_verbatim: 1 } });
  });
}

test("redacted capture omits malformed and unmappable messages", async () => {
  const capture = makeCapture("Set width to 5.\0");
  capture.messages.push(
    { id: "m2", role: "user", content: `Set width to 6. sk-${"a".repeat(16)}\u0301` },
    { id: "m3", role: "user", content: "Set width to ４." },
  );
  const model = makeModel([
    change("Width is 5.", "Set width to 5."),
    change("Width is 6.", "Set width to 6."),
    change("Width is 4."),
  ]);
  const { amendments, counters } = await detectCardAmendments({ model, capture, cards: [card] });

  assert.deepEqual(counters, { detect_calls: 1, quote_not_verbatim: 2, verify_calls: 1 });
  assert.equal(model.detects[0].input.split("\n\n")[0], `CONVERSATION (${date}):\n[turn 3] user: ${quote}`);
  assert.equal(model.verifies.length, 1);
  assert.equal(amendments.length, 1);
  assert.equal(amendments[0].amendment.quote, quote);
  assert.equal(amendments[0].amendment.sourceMessage.messageId, "m3");
});

test("amendment detection drops a NUL in a non-enumerable new value", async () => {
  const candidate = Object.defineProperty(change("Width\0 is 4."), "new_value", { enumerable: false });
  const model = makeModel([candidate]);
  const { amendments, counters } = await detectCardAmendments({ model, capture: makeCapture(), cards: [card] });

  assert.deepEqual(counters, { detect_calls: 1, ill_formed_model_text: 1 });
  assert.deepEqual(model.verifies, []);
  assert.deepEqual(amendments, []);
});

test("amendment detection drops a candidate accessor without calling it", async () => {
  let reads = 0;
  const candidate = Object.defineProperty(change("Width is 4."), "new_value", {
    get() { reads++; return "Width is 4."; },
  });
  const model = makeModel([candidate]);
  const { amendments, counters } = await detectCardAmendments({ model, capture: makeCapture(), cards: [card] });

  assert.equal(reads, 0);
  assert.deepEqual(counters, { detect_calls: 1, malformed: 1 });
  assert.deepEqual(model.verifies, []);
  assert.deepEqual(amendments, []);
});

for (const [description, value, quoted, maskedFragments] of [
  ["a fullwidth marker in the value", fullwidthMarker, quote, ["［ＲＥＤＡＣＴＥＤ］"]],
  ["a fullwidth marker in the quote", "Width is 4.", fullwidthMarker, ["［ＲＥＤＡＣＴＥＤ］"]],
  ["overlapping assignments", "password=auth_token=overlap-secret", "password=auth_token=overlap-secret",
    ["auth_token=", "overlap-secret"]],
  ["overlapping quoted OAuth and password masks", '{"refresh_token":"prefix-secret password=long-password"}',
    '{"refresh_token":"prefix-secret password=long-password"}', ["prefix-secret", "password=", "long-password"]],
  ["a CRLF-delimited PEM block", pem, pem, ["-----BEGIN", "synthetic CRLF payload", "-----END"]],
  ["a compatibility-width credential", "ｐａｓｓｗｏｒｄ＝compat-secret", "ｐａｓｓｗｏｒｄ＝compat-secret", ["compat-secret"]],
]) {
  test(`verify and storage match capture masks for ${description}`, async () => {
    const safeQuote = prepareCoreText(quoted);
    const model = makeModel([change(value, safeQuote)]);
    const { amendments } = await detectCardAmendments({ model, capture: makeCapture(quoted), cards: [card] });

    assert.equal(model.verifies.length, 1);
    assert.equal(amendments.length, 1);
    const [{ amendment: { sentence, quote: storedQuote } }] = amendments;
    const { input } = model.verifies[0];
    const safeValue = prepareCoreText(value);
    for (const fragment of maskedFragments) {
      for (const text of [safeValue, safeQuote, input, sentence, storedQuote]) {
        assert.ok(!text.includes(fragment), `unexpected fragment: ${fragment}`);
      }
    }
    assert.ok(input.endsWith(`\nQUOTE: ${safeQuote}\nNEW VALUE: ${safeValue}`));
    assert.equal(sentence, safeValue);
    assert.equal(storedQuote, safeQuote);
  });
}

test("a well-formed model value keeps the kit verify layout and edge whitespace", async () => {
  const value = " \tWidth is 4.\t ";
  const model = makeModel([change(value)]);
  const { amendments, counters } = await detectCardAmendments({ model, capture: makeCapture(), cards: [card] });

  assert.equal(model.verifies.length, 1);
  assert.equal(model.verifies[0].input,
    "DOCUMENT (saved 2025-06-11):\nWidth: 3\n\nLATER CONVERSATION DATE: 2025-06-12\nQUOTE: Set width to 4.\nNEW VALUE:  \tWidth is 4.\t ");
  assert.equal(amendments.length, 1);
  assert.equal(amendments[0].amendment.sentence, "Width is 4.");
  assert.equal(amendments[0].amendment.quote, quote);
  assert.equal(counters.ill_formed_model_text, undefined);
});
