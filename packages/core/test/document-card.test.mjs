import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDocumentCard } from "@cairn-ink/core/routing";
import { rawSessionKeys } from "../../../core/raw-source-roots.mjs";

const scope = { owner: "owner", namespace: null };
const session = { scope, client: "client", canonicalSessionKey: "lineage-key" };
const message = (content, occurredAtMs = null) => ({ id: "message", content, role: "user", occurredAtMs });

async function build(content, occurredAtMs) {
  const result = await buildDocumentCard(message(content, occurredAtMs), session);
  assert.ok(result.card);
  assert.deepEqual(result.drops, {});
  return result.card;
}

test("card text keeps indentation, blank lines, and normalized text with a title and date", async () => {
  const card = await build("  \r\n  Ｇarden guide  \r\n\t- water\t\r\n\r\n  - weed   ", 1_700_000_000_000);
  assert.equal(card.body, "\n  Garden guide\n\t- water\n\n  - weed");
  assert.equal(card.title, "Garden guide");
  assert.equal(card.date, 1_700_000_000_000);
  assert.equal(card.revision, 1);
  assert.deepEqual(card.source, { ...session, messageId: "message" });
});

test("the title uses a UTF-16 limit and keeps complete code points", async () => {
  assert.equal((await build("a".repeat(198) + "😀end")).title, "a".repeat(198) + "😀");
  assert.equal((await build("a".repeat(199) + "😀end")).title, "a".repeat(199));
  assert.equal((await build("Title")).date, null);
});

test("the body size limit counts UTF-16, preserves exact fits and drops oversize cards", async () => {
  assert.equal((await build("😀".repeat(2_000))).body.length, 4_000);
  assert.deepEqual(await buildDocumentCard(message("😀".repeat(2_000) + "a"), session), {
    card: null, drops: { oversize: 1 },
  });
  assert.deepEqual(await buildDocumentCard(message(" \n\t"), session), {
    card: null, drops: { empty_body: 1 },
  });
});

test("raw and ordinary capture resolve the same canonical message identity", async () => {
  const namespace = { ownerId: "owner", scope: "personal", projectId: "" };
  const client = "client";
  const ordinarySession = "external-session";
  const key = "37".repeat(32);
  const [plain, canonicalSessionKey] = rawSessionKeys(namespace, client, ordinarySession, key);
  assert.notEqual(plain, canonicalSessionKey);
  const rawContext = { scope, client, canonicalSessionKey };
  const ordinaryContext = { scope, client, canonicalSessionKey: rawSessionKeys(namespace, client, plain, key)[1] };
  const raw = (await buildDocumentCard(message("Garden guide"), rawContext)).card;
  const ordinary = (await buildDocumentCard(message("Garden guide."), ordinaryContext)).card;
  assert.ok(raw?.id);
  assert.equal(ordinary?.id, raw.id);
  assert.deepEqual(ordinary?.source, raw.source);
  for (const [input, context] of [
    [{ ...message("Garden guide"), id: "another-message" }, rawContext],
    [message("Garden guide"), { ...rawContext, client: "another-client" }],
    [message("Garden guide"), { ...rawContext, canonicalSessionKey: "other-key" }],
    [message("Garden guide"), { ...rawContext, scope: { ...scope, owner: "other-owner" } }],
    [message("Garden guide"), { ...rawContext, scope: { ...scope, namespace: "other-namespace" } }],
  ]) {
    const card = (await buildDocumentCard(input, context)).card;
    assert.ok(card?.id);
    assert.notEqual(card.id, raw.id);
  }
  assert.deepEqual(await buildDocumentCard(message("Garden guide"), { scope, client, sessionId: ordinarySession }), {
    card: null, drops: { missing_session_key: 1 },
  });
});

const secretCases = [
  ["-----BEGIN TEST PRIVATE KEY-----\nSYNTHETIC\n-----END TEST PRIVATE KEY-----", "[REDACTED]"],
  ["-----BEGIN PRIVATE  KEY-----\nSYNTHETIC\n-----END PRIVATE\t KEY-----", "[REDACTED]"],
  [`sk-${"a".repeat(16)}`, "[REDACTED]"],
  [`crn_pat_${"ac".repeat(16)}`, "[REDACTED]"],
  [`crn_pat_${"TOYVALUE".repeat(4)}`, "[REDACTED]"],
  [`ghp_${"b".repeat(20)}`, "[REDACTED]"],
  [`AKIA${"Z".repeat(16)}`, "[REDACTED]"],
  [`eyJ${"a".repeat(10)}.${"b".repeat(10)}.${"c".repeat(10)}`, "[REDACTED]"],
  ["Bearer\n\tToyValue1234", "[REDACTED]"],
  ['api_key = "toy-value"', "api_key = [REDACTED]"],
  ['"refresh_token": "toy-value"', '"refresh_token": "[REDACTED]"'],
  ["ｐａｓｓｗｏｒｄ＝toy-value", "password=[REDACTED]"],
];

for (const [i, [secret, expected]] of secretCases.entries()) {
  test(`masks synthetic credential form ${i + 1} before deriving card fields`, async () => {
    const card = await build(`  ${secret}   \n  garden guide\n    water daily`);
    assert.equal(card.body, `  ${expected}\n  garden guide\n    water daily`);
    assert.equal(card.title, expected);
  });
}

test("flattened masks round-trip across UTF-16 offsets and existing placeholders", async () => {
  const doubled = "-----BEGIN PRIVATE  KEY-----\nsample\n-----END PRIVATE  KEY-----";
  const card = await build(`😀 [REDACTED] ${doubled}!\n  after: ${doubled}?`);
  assert.equal(card.body, "😀 [REDACTED] [REDACTED]!\n  after: [REDACTED]?");
});

test("sentence spans round-trip after normalization, redaction, and line splits", async () => {
  const card = await build("  😀 1.2 degrees.  Next!\r\n\r\n  問題？最後。\n  api_key=toy-value\n  done");
  const roundTrip = card.sentences.map(({ start, end, source }) => {
    assert.deepEqual(source, card.source);
    assert.ok(end > start);
    return card.body.slice(start, end);
  });
  assert.deepEqual(roundTrip, ["😀 1.2 degrees.", "Next!", "問題?", "最後。", "api_key=[REDACTED]", "done"]);
  assert.equal(card.sentences[0].start, 2);
  assert.equal(card.sentences[1].start, 19);
  assert.equal(card.sentences.at(-1).end, card.body.length);
});
