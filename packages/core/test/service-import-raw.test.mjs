import assert from "node:assert/strict";
import { test } from "node:test";
import { allDigests, CoreError, engineLegacyDigest, hostedV1Digest } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope as scope, serviceFake } from "./helpers/service-fake.mjs";

const message = (id, content = "Archive entry", occurredAtMs = null) =>
  ({ id, role: "user", content, occurredAtMs });
const session = (messages, sessionId = "first") => ({ client: "archive", sessionId, messages });
const counts = (imported = 0, duplicate = 0, suppressed = 0, invalid = 0) =>
  ({ imported, duplicate, suppressed, invalid });
const code = expected => error => error instanceof CoreError && error.code === expected && error.message === expected;
const methods = ({ calls }) => calls.map(([method]) => method);

function setup() {
  const fake = serviceFake({ capture: true, rawArchive: true, writes: true, forgetting: {} });
  return { ...fake, service: createMemoryService(fake.deps) };
}

test("maps hosted archive, conflict, refusal and invalid counts in one pause-locked UoW per session", async () => {
  // Hosted src/memory/import.ts:104–123 counts invalids, filters by eligibility, then derives archive/conflict/refusal counts.
  // Hosted src/memory/raw.ts:37–57 keeps the first row under the owner/client/session/message identity.
  const fake = setup();
  const { service, archived, calls, hooks, mutations } = fake;
  const original = message("already", "Original content", 0);
  await service.importRawMessages(scope, [session([original])]);
  calls.length = 0;
  mutations.length = 0;
  const fresh = { ...message("fresh"), role: "assistant" };
  const otherSession = message("already", "Same ID in another session");
  hooks.eligible = messages => messages.flatMap(({ id }, index) => id === "withheld" ? [] : [index]);
  assert.deepEqual(await service.importRawMessages(scope, [
    session([message("already", "Changed content"), fresh, message("fresh"), message("withheld"), null]),
    session([otherSession], "second"),
  ]), counts(2, 2, 1, 1));
  assert.deepEqual(archived(scope.owner), [original, fresh, otherSession]);
  assert.deepEqual(methods(fake),
    Array(2).fill(["run", "lock", "lock", "pause.get", "suppressions.snapshot", "raw.importArchive"]).flat());
  assert.deepEqual(calls.filter(([method]) => method === "run"),
    Array(2).fill(["run", scope.owner, { pauseLock: true }]));
  assert.deepEqual(mutations.map(({ method, run }) => [method, run]), [["raw.importArchive", 2], ["raw.importArchive", 3]]);
});

test("invalid message positions are counted and valid boundary values reach the archive", async () => {
  // Hosted src/memory/import.ts:86–109 validates id/role/time and skips invalid rows.
  // The Core port caps IDs at 512 UTF-16 units. Hosted src/memory/time.ts:3–16 bounds UTC years.
  const { service, archived } = setup();
  const earliest = message("x".repeat(512), "😀".repeat(10_000), -62135596800000);
  const latest = message("latest", " \ud800\0 ", 253402300799999);
  const whitespace = message("spaces", " \n\t ");
  const rows = [
    null, 3, message(""), message("x".repeat(513)), message("zero\0id"), message("\ud800"),
    { ...message("role"), role: "system" },
    message("non-text", 42), message("string-time", "Text", "1970-01-01T00:00:00Z"),
    { ...message("missing-time"), occurredAtMs: undefined }, message("fraction", "Text", 0.5),
    message("old", "Text", earliest.occurredAtMs - 1), message("future", "Text", latest.occurredAtMs + 1),
    { get id() { throw new Error("malformed input"); } },
    { ...message("throwing-content"), get content() { throw new Error("malformed content"); } },
    earliest, latest, whitespace,
  ];
  rows.length++;
  assert.deepEqual(await service.importRawMessages(scope, [session(rows)]), counts(3, 0, 0, 16));
  assert.deepEqual(archived(scope.owner), [earliest, { ...latest, content: " \ufffd " }, whitespace]);
});

test("raw message validation accepts hosted rows and re-imports prepared output as duplicates", async () => {
  const { service, archived } = setup();
  const longId = message("x".repeat(201));
  const empty = message("empty", "");
  const nul = message("nul", "\0");
  const expanding = message("expanding", "ﷺ".repeat(1200));
  const longContent = message("long-content", "x".repeat(20_001));
  const metadata = message("metadata");
  const rows = [longId, empty, nul, expanding, longContent,
    { ...metadata, importSource: "backup", get unused() { throw new Error("ignored field"); } }];
  assert.deepEqual(await service.importRawMessages(scope, [session(rows)]), counts(rows.length));
  const saved = archived(scope.owner);
  assert.deepEqual(saved, [longId, empty, { ...nul, content: "" },
    { ...expanding, content: expanding.content.normalize("NFKC") }, longContent, metadata]);
  assert.deepEqual(await service.importRawMessages(scope, [session(saved)]), counts(0, rows.length));
  assert.deepEqual(archived(scope.owner), saved);
});

test("raw session IDs preserve leading and trailing spaces", async () => {
  const { service, archived, calls } = setup();
  const row = message("first");
  const sessionId = " archived session ";
  assert.deepEqual(await service.importRawMessages(scope, [session([row], sessionId)]), counts(1));
  assert.deepEqual(archived(scope.owner), [row]);
  assert.deepEqual(calls.find(([method]) => method === "raw.importArchive"),
    ["raw.importArchive", scope, { client: "archive", sessionId }, [row], { withheld: [] }]);
});

test("caps the whole call at 500 input positions, including invalids", async () => {
  // Hosted src/memory/import.ts:14,104–108 and src/memory/text.ts:52–60 reject over-cap input before storage.
  const { service, calls, archived } = setup();
  const batch = Array.from({ length: 499 }, (_, i) => message("message-" + i));
  const last = session([null], "second");
  assert.deepEqual(await service.importRawMessages(scope, [session(batch), last]), counts(499, 0, 0, 1));
  calls.length = 0;
  await assert.rejects(() => service.importRawMessages(scope, [session(batch), last, session([null], "third")]),
    code("invalid_input"));
  assert.deepEqual(calls, []);
  assert.equal(archived(scope.owner).length, 499);
});

test("invalid call and session shapes reject before any port call", async () => {
  const { service, calls } = setup();
  for (const [ownerScope, sessions] of [
    [null, []], [scope, null], [scope, {}], [scope, new Array(1)], [scope, [null]],
    [scope, [session(null)]], [scope, [session([], "")]], [scope, [{ ...session([]), client: "bad\0client" }]],
    [scope, [session([message("valid")]), { ...session([]), sessionId: 123 }]],
    [scope, [{ get client() { throw new Error("malformed session"); } }]],
  ]) await assert.rejects(() => service.importRawMessages(ownerScope, sessions), code("invalid_input"));
  assert.deepEqual(calls, []);
});

test("prepares a single detached snapshot before any UoW, normalizing and redacting with whitespace intact", async () => {
  const { service, calls, archived, hooks } = setup();
  const secret = "crn_pat_" + "z".repeat(32);
  const fullwidth = Array.from(secret, char => String.fromCharCode(char.charCodeAt(0) + 0xfee0)).join("");
  const expected = "  A\t[REDACTED]\n  ";
  let reads = 0;
  const later = { ...message("second"), get content() { reads++; return "  Ａ\t" + fullwidth + "\n  "; } };
  const sessions = [session([message("first")]), session([later], "second")];
  hooks.beforeRun = () => {
    assert.equal(reads, 1);
    sessions[1].messages[0] = message("replacement");
    sessions[1].sessionId = "replacement";
  };
  assert.deepEqual(await service.importRawMessages(scope, sessions), counts(2));
  assert.equal(archived(scope.owner)[1].content, expected);
  assert.deepEqual(calls.filter(([name]) => name === "raw.importArchive").at(-1),
    ["raw.importArchive", scope, { client: "archive", sessionId: "second" }, [message("second", expected)], { withheld: [] }]);
  assert.equal(calls.some(([name]) => /^(model|embed|gate)/.test(name)), false);
});

test("pause before the first session returns only the paused status and never calls the archive", async () => {
  const fake = setup();
  const { service, calls, mutations, archived } = fake;
  await service.setPause(scope.owner, true);
  calls.length = 0;
  assert.deepEqual(await service.importRawMessages(scope, [session([null, message("first")])]), { status: "paused" });
  assert.deepEqual(methods(fake), ["run", "lock", "lock", "pause.get"]);
  assert.deepEqual(mutations, []);
  assert.deepEqual(archived(scope.owner), []);
});

test("pause between sessions leaves the first committed and returns no partial counts", async () => {
  const fake = setup();
  const { service, hooks, archived, mutations } = fake;
  const original = message("first");
  let runs = 0;
  hooks.beforeRun = async () => {
    if (++runs === 2) await service.setPause(scope.owner, true);
  };
  assert.deepEqual(await service.importRawMessages(scope, [
    session([original, null]), session([message("second")], "second"), session([message("third")], "third"),
  ]), { status: "paused" });
  assert.deepEqual(archived(scope.owner), [original]);
  assert.equal(mutations.length, 1);
  assert.deepEqual(methods(fake).slice(-3), ["lock", "lock", "pause.get"]);
  assert.equal(methods(fake).filter(method => method === "run").length, 3);
});

test("an empty call has zero counts and an invalid-only session still checks pause", async () => {
  const fake = setup();
  const { service, mutations } = fake;
  assert.deepEqual(await service.importRawMessages(scope, []), counts());
  assert.deepEqual(methods(fake), []);
  assert.deepEqual(await service.importRawMessages(scope, [session([null])]), counts(0, 0, 0, 1));
  assert.deepEqual(methods(fake), ["run", "lock", "lock", "pause.get", "suppressions.snapshot", "raw.importArchive"]);
  assert.deepEqual(mutations, []);
});

test("requires both rawArchive and importArchive before opening any UoW", async () => {
  for (const drop of [
    storage => { delete storage.raw.importArchive; },
    storage => { delete storage.capabilities.rawArchive; },
    storage => { delete storage.raw; },
  ]) {
    const { deps, storage, calls, mutations } = setup();
    drop(storage);
    const service = createMemoryService(deps);
    await assert.rejects(() => service.importRawMessages(scope, [session([message("first")])]), code("capability_unavailable"));
    assert.deepEqual(calls, []);
    assert.deepEqual(mutations, []);
  }
});

test("the archive counts a forgotten window, forgotten text and a fenced session as suppressed", async () => {
  const { service, storage, seedFact, archived, mutations } = setup();
  const wording = "The lantern is stored in the cellar.";
  seedFact({ ...scope, kind: "window", origin: "forget", actionId: "forgot-time", client: "archive",
    window: { startMs: 10, endMs: 20 } });
  seedFact({ ...scope, kind: "text", mode: "exact", origin: "forget", actionId: "forgot-text",
    text: { digests: await allDigests(wording, null) } });
  const fenced = session([message("fenced")], "fenced");
  await storage.uow.run(scope.owner, { pauseLock: true }, tx =>
    storage.raw.fenceSession(tx, scope, { client: fenced.client, sessionId: fenced.sessionId }));
  mutations.length = 0;
  const visible = message("after-window", "Outside the window", 20);
  const duplicate = message("replay", "A visible import");
  await service.importRawMessages(scope, [session([duplicate])]);
  assert.deepEqual(await service.importRawMessages(scope, [
    session([message("replay", "In the window", 10), message("forgotten", wording), visible]), fenced,
  ]), counts(1, 0, 3));
  assert.deepEqual(archived(scope.owner), [duplicate, visible]);
  assert.equal(mutations.length, 2);
});

for (const [label, wording, prepared, digest, forgottenWording = wording] of [
  ["hosted-v1 original", "The recovery note in the attic says " + "crn_pat_" + "z".repeat(32),
    "The recovery note in the attic says [REDACTED]", hostedV1Digest],
  ["engine-legacy original", `Saved config {"client_secret": "${"example".repeat(5)}"} for the boat dock gate`,
    'Saved config {"client_secret": "[REDACTED]"} for the boat dock gate', engineLegacyDigest],
  ["prepared", "The redacted note says " + "crn_pat_" + "z".repeat(32), "The redacted note says [REDACTED]",
    hostedV1Digest, "The redacted note says [REDACTED]"],
]) {
  test(`raw passage suppression withholds the ${label} match before archiving`, async () => {
    const { service, seedFact, archived, calls, mutations } = setup();
    seedFact({ ...scope, kind: "text", mode: "exact", origin: "forget", actionId: "forgot-text",
      text: { digests: [await digest(forgottenWording)] } });
    const forgotten = message("forgotten", wording, 10);
    assert.deepEqual(await service.importRawMessages(scope, [session([forgotten])]), counts(0, 0, 1));
    assert.deepEqual(archived(scope.owner), []);
    assert.deepEqual(mutations, []);
    const visible = message("visible", "Unrelated note", 20);
    assert.deepEqual(await service.importRawMessages(scope, [session([null, visible, forgotten])]), counts(1, 0, 1, 1));
    assert.deepEqual(archived(scope.owner), [visible]);
    const target = { client: "archive", sessionId: "first" };
    const preparedForgotten = { ...forgotten, content: prepared };
    assert.deepEqual(calls.filter(([method]) => method === "suppressions.snapshot" || method === "raw.importArchive"), [
      ["suppressions.snapshot", scope, { ...target, occurredAtMs: [10] }],
      ["raw.importArchive", scope, target, [preparedForgotten], { withheld: [0] }],
      ["suppressions.snapshot", scope, { ...target, occurredAtMs: [20, 10] }],
      ["raw.importArchive", scope, target, [visible, preparedForgotten], { withheld: [1] }],
    ]);
  });
}

async function withheldForkFixture() {
  const fake = setup();
  const source = { client: "archive", sessionId: "deleted-source" };
  const anchor = message("anchor", "The observatory code was " + "crn_pat_" + "z".repeat(32), 10);
  const deleted = message("deleted", "The telescope inventory is ready.", 20);
  const anchorContent = "The observatory code was [REDACTED]";
  // The source rows have been deleted. Only the prepared anchor proof survives its fence.
  fake.hooks.isFenced = ({ client, sessionId }, messages = []) => ({
    fenced: client === source.client && (sessionId === source.sessionId ||
      messages.some(({ id, content }) => id === anchor.id && content === anchorContent)),
  });
  fake.seedFact({ ...scope, kind: "text", mode: "exact", origin: "forget", actionId: "forgot-anchor-text",
    text: { digests: [await hostedV1Digest(anchor.content)] } });
  return { ...fake, anchor, replay: session([deleted, anchor], "fork") };
}

test("a core-withheld anchor fences a replay of the other deleted raw row", async () => {
  const { service, replay, archived } = await withheldForkFixture();
  await service.importRawMessages(scope, [replay]);
  assert.deepEqual(archived(scope.owner), []);
});

test("the raw archive port skips storage and ID deduplication for withheld positions", async () => {
  const { storage, service, archived } = setup();
  const blocked = message("blocked");
  const visible = message("visible");
  const target = { client: "archive", sessionId: "first" };
  await storage.uow.run(scope.owner, { pauseLock: true }, tx =>
    storage.raw.importArchive(tx, scope, target, [visible, blocked], { withheld: [1] }));
  assert.deepEqual(archived(scope.owner), [visible]);
  assert.deepEqual(await service.importRawMessages(scope, [session([blocked])]), counts(1));
});

test("raw import counts each withheld position once when Core and the fork fence overlap", async () => {
  const { service, anchor, replay } = await withheldForkFixture();
  const visible = message("visible", "An unrelated message");
  await service.importRawMessages(scope, [session([visible])]);
  assert.deepEqual(await service.importRawMessages(scope, [
    replay, session([visible, message("new"), { ...anchor, id: "other-id" }, null]),
  ]), counts(1, 1, 3, 1));
});

test("an unrelated raw session still imports alongside a withheld-anchor fork", async () => {
  const { service, anchor, replay, archived } = await withheldForkFixture();
  const unrelated = { ...anchor, content: "A different message with the same ID" };
  await service.importRawMessages(scope, [replay, session([unrelated], "unrelated")]);
  assert.deepEqual(archived(scope.owner), [unrelated]);
});

test("foreign port throws become CoreError and the failed session rolls back", async () => {
  const { service, storage, archived } = setup();
  const importArchive = storage.raw.importArchive;
  storage.raw.importArchive = async (...args) => {
    const added = await importArchive(...args);
    if (args[2].sessionId === "fail") throw new Error("foreign failure");
    return added;
  };
  const original = message("first");
  const failed = session([message("second")], "fail");
  await assert.rejects(() => service.importRawMessages(scope, [session([original]), failed]), code("internal_error"));
  assert.deepEqual(archived(scope.owner), [original]);
  storage.raw.importArchive = importArchive;
  assert.deepEqual(await service.importRawMessages(scope, [session([original]), failed]), counts(1, 1));
});

test("two owners import independently and pausing one leaves the other open", async () => {
  const { service, archived } = setup();
  const other = { ...scope, owner: "other-owner" };
  const original = message("shared-id");
  assert.deepEqual(await service.importRawMessages(scope, [session([original])]), counts(1));
  await service.setPause(scope.owner, true);
  const otherMessage = { ...original, content: "Different owner" };
  assert.deepEqual(await service.importRawMessages(other, [session([otherMessage])]), counts(1));
  assert.deepEqual(await service.importRawMessages(scope, [session([otherMessage])]), { status: "paused" });
  assert.deepEqual(await service.importRawMessages(other, [session([original])]), counts(0, 1));
  assert.deepEqual(archived(scope.owner), [original]);
  assert.deepEqual(archived(other.owner), [otherMessage]);
});
