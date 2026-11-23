import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  SYS_DETECT, SYS_VERIFY, amendmentId, buildDetectRequest, buildVerifyRequest,
  checkChangeCandidates, detectCardAmendments,
} from "@cairn-ink/core/routing";
import { modelRequestText } from "../src/capture/request-size.mjs";

const scope = { owner: "owner", namespace: "work" };
const capture = {
  client: "client",
  sessionId: "session-z",
  scope,
  date: "2025-06-12",
  messages: [
    { id: "question", role: "user", turn: 7, content: "Set [width] to\u00854.\nUse a blue label." },
    { id: "answer", role: "assistant", content: "Set the height to 5." },
    { id: "followup", role: "user", content: "Keep the label at the top." },
  ],
};
const card = (id, date, sessionId = id, body = "Shelf settings\nWidth: 3") => ({
  id, date, scope, body, sourceMessage: { client: "client", sessionId, messageId: "original" },
});
const old = card("old", "2025-06-10");
const middle = card("middle", "2025-06-12", "session-a", " \nMiddle\nWidth: 3");
const newest = card("newest", "2025-06-12", "session-b", `\u0085${"😀".repeat(121)}\n${"x".repeat(400)}`);
const countTokens = text => Array.from(text).length;
const detectInput = {
  conversation: capture,
  cards: [
    newest, old, middle,
    card("current", capture.date, capture.sessionId),
    card("later", capture.date, "session-zz"),
    card("unknown-date", null),
    { ...old, id: "other-namespace", scope: { ...scope, namespace: "other" } },
    { ...old, id: "other-owner", scope: { ...scope, owner: "other" } },
  ],
  countTokens,
};
const change = (card_id, quote = "Set [width] to 4.", new_value = " Width is now 4. ") =>
  ({ card_id, quote, new_value });

test("detect and verify prompts match the frozen SHA-256 digests", () => {
  const hash = text => createHash("sha256").update(text).digest("hex");
  assert.equal(hash(SYS_DETECT), "97963bd5c2516e991ef2ca0a92cd730db7b4f5af1910b670b397741cafdfed07");
  assert.equal(hash(SYS_VERIFY), "4868ab2b803b00415e2bc784b19d5684ec9f76740671464b2c9d4daafdcb310a");
});

test("detect uses the kit layout and lists the newest fitting cards in session order", () => {
  const expected = [
    "CONVERSATION (2025-06-12):",
    "[turn 7] user: Set [width] to\u00854.",
    "Use a blue label.",
    "[turn 2] assistant: Set the height to 5.",
    "[turn 3] user: Keep the label at the top.",
    "", "EARLIER DOCUMENTS:",
    "[middle] date 2025-06-12", "first line: Middle", "beginning:  \nMiddle\nWidth: 3",
    "", "[newest] date 2025-06-12", `first line: ${"😀".repeat(120)}`,
    `beginning: \u0085${"😀".repeat(121)}\n${"x".repeat(177)}`,
  ].join("\n");
  const inputLimit = countTokens(modelRequestText(SYS_DETECT, expected, 900));
  const { request, listedCards, counters } = buildDetectRequest({ ...detectInput, inputLimit });
  assert.deepEqual(listedCards, [middle, newest]);
  assert.deepEqual(counters, { detect_card_list_truncated: 1 });
  assert.equal(request.input, expected);
  assert.equal(request.system, SYS_DETECT);
  assert.equal(request.temperature, 0);
  assert.equal(request.maxOutputTokens, 900);
  assert.equal(request.schema.additionalProperties, false);
  assert.equal(request.schema.properties.changes.items.additionalProperties, false);
  assert.deepEqual(request.schema.properties.changes.items.required, ["card_id", "quote", "new_value"]);
  assert.deepEqual(buildDetectRequest(detectInput).listedCards, [old, middle, newest]);
});

test("detect skips an oversized first card and uses a 6,000-token default", () => {
  assert.deepEqual(buildDetectRequest({ ...detectInput, countTokens: () => 6_000 }).listedCards, [old, middle, newest]);
  assert.deepEqual(buildDetectRequest({ ...detectInput, countTokens: () => 6_001 }), {
    request: null, listedCards: [], counters: { detect_skipped_oversize: 1 },
  });
  assert.deepEqual(buildDetectRequest({ ...detectInput, inputLimit: 1 }).counters, { detect_skipped_oversize: 1 });
  assert.deepEqual(buildDetectRequest({ ...detectInput, inputLimit: NaN }).counters, { detect_skipped_oversize: 1 });
});

test("detect skips captures without a user message or eligible earlier card", async () => {
  const assistantOnly = { ...capture, messages: [capture.messages[1]] };
  assert.deepEqual(buildDetectRequest({ ...detectInput, conversation: assistantOnly }), {
    request: null, listedCards: [], counters: { detect_skipped_no_user: 1 },
  });
  const model = makeModel([], []);
  const input = { model, capture, cards: [] };
  assert.deepEqual(await detectCardAmendments(input), {
    amendments: [], counters: { detect_skipped_no_earlier_cards: 1 },
  });
  assert.deepEqual(await detectCardAmendments({ ...input, capture: assistantOnly, cards: [old] }), {
    amendments: [], counters: { detect_skipped_no_user: 1 },
  });
  assert.deepEqual(model.requests, []);
});

test("candidate checks count each drop and recover the verbatim user substring", () => {
  const same = card("same", capture.date, capture.sessionId);
  const { candidates, drops } = checkChangeCandidates({
    changes: [
      { ...change(old.id), extra: "unexpected" }, change(old.id, "\u0085"),
      change("unlisted"), change(old.id, "5. Keep the label"),
      change(same.id), change(old.id, "Set the height to 5."), change(old.id),
    ],
    listedCards: [old, same], captureMessages: capture.messages, captureSession: capture,
  });
  assert.deepEqual(drops, {
    malformed: 2, unknown_card: 1, quote_not_verbatim: 1, same_session: 1, quote_from_assistant: 1,
  });
  assert.deepEqual(candidates, [{
    card: old, quote: "Set [width] to 4.", verbatimQuote: "Set [width] to\u00854.",
    newValue: " Width is now 4. ",
    sourceMessage: { client: capture.client, sessionId: capture.sessionId, messageId: "question" },
  }]);
});

test("verify uses the whole card and the kit layout and strict settings", () => {
  const quote = "Set [width] to 4.";
  const newValue = "Width is now 4.";
  const request = buildVerifyRequest({ card: middle, sessionDate: capture.date, quote, newValue });
  assert.equal(request.input, `DOCUMENT (saved 2025-06-12):\n \nMiddle\nWidth: 3\n\nLATER CONVERSATION DATE: 2025-06-12\nQUOTE: Set [width] to 4.\nNEW VALUE: Width is now 4.`);
  assert.equal(request.system, SYS_VERIFY);
  assert.equal(request.temperature, 0);
  assert.equal(request.maxOutputTokens, 400);
  assert.deepEqual(request.schema, {
    type: "object", required: ["applies", "line"], additionalProperties: false,
    properties: { applies: { type: "boolean" }, line: { type: "string" } },
  });
});

function makeModel(changes, verdicts) {
  const requests = [];
  return {
    countTokens, requests,
    async detectChanges(request) {
      this.requests.push(request);
      return { changes, usage: { inputTokens: 71, outputTokens: 10 } };
    },
    async verifyChange(request) {
      this.requests.push(request);
      const applies = verdicts[this.requests.length - 2];
      return { applies, line: applies ? "Width: 3" : "", usage: { inputTokens: 12, outputTokens: 4 } };
    },
  };
}

test("verify false produces no amendment", async () => {
  const model = makeModel([change(old.id)], [false]);
  const result = await detectCardAmendments({ model, capture, cards: [old] });
  assert.deepEqual(result.amendments, []);
  assert.equal(result.counters.verify_rejected, 1);
  assert.equal(result.counters.verify_calls, 1);
});

test("the first verified card for a normalized quote wins and replay has the same ID", async () => {
  const changes = [change(old.id), change(middle.id, "Set [width] to\n4."), change(newest.id)];
  const run = (model) => detectCardAmendments({ model, capture, cards: [old, middle, newest] });
  const result = await run(makeModel(changes, [false, true]));
  assert.equal(result.amendments.length, 1);
  const { cardId, amendment } = result.amendments[0];
  assert.equal(cardId, middle.id);
  assert.equal(amendment.sentence, "Width is now 4.");
  assert.equal(amendment.quote, capture.messages[0].content.split("\n")[0]);
  assert.equal(amendment.date, capture.date);
  assert.equal(amendment.sourceMessage.messageId, capture.messages[0].id);
  assert.match(amendment.amendmentId, /^[0-9a-f]{64}$/u);
  assert.equal(amendment.amendmentId, await amendmentId(cardId, amendment.sourceMessage, changes[0].quote));
  assert.notEqual(amendment.amendmentId, await amendmentId(cardId, { ...amendment.sourceMessage, messageId: "other" }, amendment.quote));
  assert.deepEqual(result, await run(makeModel(changes, [false, true])));
  assert.deepEqual(result.counters, {
    detect_calls: 1, detect_input_tokens: 71, detect_output_tokens: 10,
    verify_calls: 2, verify_input_tokens: 24, verify_output_tokens: 8,
    verify_rejected: 1, verify_skipped_quote_already_applied: 1,
  });
});

test("verify consumes at most four calls in candidate order, even across interleaved quotes", async () => {
  const quotes = ["Set [width] to 4.", "Use a blue label.", "Set [width] to\t4.", "Keep the label at the top.", "blue label"];
  const changes = quotes.map(quote => change(old.id, quote));
  const model = makeModel(changes, [false, false, true, false, true]);
  const { amendments, counters } = await detectCardAmendments({ model, capture, cards: [old] });
  assert.equal(counters.verify_calls, 4);
  assert.equal(counters.verify_skipped_limit, 1);
  assert.equal(amendments.length, 1);
  assert.deepEqual(model.requests.slice(1).map(request => request.input.split("QUOTE: ")[1].split("\nNEW VALUE:")[0]), quotes.slice(0, 4));
});

test("an oversized verify request skips its candidate before calling the model", async () => {
  const long = card("long", old.date, old.sourceMessage.sessionId, "x".repeat(6_000));
  const model = makeModel([change(long.id)], [true]);
  assert.deepEqual(await detectCardAmendments({ model, capture, cards: [long] }), {
    amendments: [], counters: {
      detect_calls: 1, detect_input_tokens: 71, detect_output_tokens: 10, verify_skipped_oversize: 1,
    },
  });
});

test("detect is skipped before calling a model with a missing method", async () => {
  const model = makeModel([change(old.id)], [true]);
  for (const methods of [{ ...model, verifyChange: undefined }, { ...model, detectChanges: undefined }, null]) {
    assert.deepEqual(await detectCardAmendments({ model: methods, capture, cards: [old] }), {
      amendments: [], counters: { detect_skipped_missing_model: 1 },
    });
  }
  assert.deepEqual(model.requests, []);
});

const failures = [
  ["failed", () => { throw Error("provider failed"); }],
  ["malformed_output", async () => "{invalid json"],
  ["timeout", (_request, { signal }) => new Promise((_resolve, reject) =>
    signal.addEventListener("abort", () => reject(signal.reason), { once: true }))],
];
for (const [reason, fail] of failures) {
  test(`detect ${reason} yields no amendments and records the failure`, async () => {
    const model = makeModel([], []);
    model.detectChanges = fail;
    const { amendments, counters } = await detectCardAmendments({
      model, capture, cards: [old], limits: { timeoutMs: 20 },
    });
    assert.deepEqual(amendments, []);
    assert.deepEqual(counters, { detect_calls: 1, [`detect_${reason}`]: 1 });
  });

  test(`verify ${reason} discards an amendment accepted earlier in the same capture`, async () => {
    const model = makeModel([change(old.id), change(old.id, "Use a blue label.")], [true]);
    let calls = 0;
    const verify = model.verifyChange.bind(model);
    model.verifyChange = (request, options) => ++calls === 1 ? verify(request) : fail(request, options);
    const { amendments, counters } = await detectCardAmendments({
      model, capture, cards: [old], limits: { timeoutMs: 20 },
    });
    assert.deepEqual(amendments, []);
    assert.equal(counters.verify_calls, 2);
    assert.equal(counters[`verify_${reason}`], 1);
  });
}
