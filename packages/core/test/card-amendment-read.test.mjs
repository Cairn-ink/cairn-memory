import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDocumentCard, documentCardAmendmentVisible, documentCardVisible,
  renderCardAmendments, selectAmendmentsForRead,
} from "@cairn-ink/core/routing";

const precedence = "These amendments are later changes and take precedence over the card text.";
const edits = Array.from({ length: 7 }, (_, i) => ({
  date: `2025-06-0${i + 1}`, sentence: `Set the count to ${i + 1}.`,
}));
const scrambled = [edits[3], edits[5], edits[0], edits[6], edits[2], edits[1], edits[4]];
const line = ({ date, sentence }) => `${date}: ${sentence}`;

test("read keeps the five newest amendments and renders them oldest first", () => {
  const expected = edits.slice(-5);
  assert.deepEqual(selectAmendmentsForRead(scrambled), expected);
  assert.deepEqual(renderCardAmendments({
    amendments: scrambled, countTokens: text => text.length, maxTokens: 500,
  }), { text: [...expected.map(line), precedence].join("\n"), amendments: expected });
});

test("the whole item fits, with the oldest amendment dropped before newer ones", () => {
  const piece = "Shelf settings\nCount: 0";
  const expected = edits.slice(-2);
  const suffix = [...expected.map(line), precedence].join("\n");
  const countTokens = text => `${piece}\n\n${text}`.length;
  const maxTokens = countTokens(suffix);
  const result = renderCardAmendments({ amendments: scrambled, countTokens, maxTokens });
  assert.deepEqual(result, { text: suffix, amendments: expected });
  assert.equal(countTokens(result.text), maxTokens);
  assert.deepEqual(renderCardAmendments({ amendments: scrambled, countTokens, maxTokens: countTokens(precedence) }), {
    text: "", amendments: [],
  });
  assert.deepEqual(renderCardAmendments({ amendments: [], countTokens, maxTokens }), { text: "", amendments: [] });
});

const scope = { owner: "owner", namespace: "work" };
const sourceIdentity = { sessionKeyHash: "a".repeat(64), messageKey: "change" };
const row = { ...sourceIdentity, type: "raw", scope, startUtf16: 0, endUtf16: 14 };
const storedFact = {
  fact: {
    ...scope, ...sourceIdentity, kind: "rawSpan", origin: "forget", actionId: "action",
    startUtf16: 4, endUtf16: 6, contentDigest: "b".repeat(64),
  },
};
const sourceMessage = { client: "client", sessionId: "earlier", messageId: "original" };
const canonicalSessionKey = "canonical";
const { card: built } = await buildDocumentCard(
  { id: sourceMessage.messageId, role: "user", content: "Shelf settings" },
  { scope, client: sourceMessage.client, canonicalSessionKey },
);
const card = { ...built, scope, sourceMessage, canonicalSessionKey, sourceMemories: [] };
const cardInput = { card, requestedScope: scope, memoryStates: new Map() };
const visible = await documentCardVisible({ ...cardInput, sourceWithheld: false });
const source = { sourceLengthUtf16: 14, rawRows: [row], facts: [], sourceExcluded: false };

test("the amendment needs complete eligible Raw coverage of its own source", () => {
  const input = { cardVisibility: visible, scope, source, sourceIdentity };
  assert.equal(documentCardAmendmentVisible(input), true);
  assert.equal(documentCardAmendmentVisible({
    ...input, source: { ...source, facts: [storedFact] },
  }), false);
  assert.equal(documentCardAmendmentVisible({
    ...input, source: { ...source, sourceExcluded: true },
  }), false);
  assert.equal(documentCardAmendmentVisible({
    ...input, source: { ...source, rawRows: [{ ...row, endUtf16: 13 }] },
  }), false);
  assert.equal(documentCardAmendmentVisible({
    ...input, source: { ...source, rawRows: [{ ...row, messageKey: "different" }] },
  }), false);
  assert.equal(documentCardAmendmentVisible({ ...input, sourceIdentity: null }), false);
  assert.equal(documentCardAmendmentVisible(undefined), false);
});

test("a hidden card hides its amendments even with independently visible sources", async () => {
  const cardVisibility = await documentCardVisible({ ...cardInput, sourceWithheld: true });
  assert.equal(cardVisibility.visible, false);
  for (const messageKey of ["first", "second"]) {
    assert.equal(documentCardAmendmentVisible({
      cardVisibility, scope, source: { ...source, rawRows: [{ ...row, messageKey }] },
      sourceIdentity: { ...sourceIdentity, messageKey },
    }), false);
  }
});
