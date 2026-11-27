import assert from "node:assert/strict";
import test from "node:test";
import { factIncarnationBody } from "@cairn-ink/core";
import { fixture, sha256 } from "./storage-fixtures.mjs";

test("Raw operator can delete a window-hidden conversation without disclosing its text", async t => {
  const opened = await fixture();
  t.after(opened.close);
  const { raw, uow, suppressions } = opened.adapter;
  const scope = { owner: "synthetic-owner", namespace: "project\0synthetic" };
  const foreign = { ...scope, namespace: "personal\0" };
  const session = { client: "claude-code", sessionId: "synthetic-session" };
  const key = (scope, eventId) => ({ ...session, scope, eventId, payloadDigest: "a".repeat(64) });
  const message = { id: "synthetic-turn", content: "Synthetic text in the window.", role: "user", occurredAtMs: 10 };
  const write = (scope, work) => uow.run(scope.owner, { pauseLock: true }, work);
  const list = (scope, id) => uow.run(scope.owner, { readOnly: true }, tx => raw.conversations(tx, scope, id));
  for (const selected of [scope, foreign])
    await write(selected, tx => raw.archive(tx, key(selected, "original"), [message]));
  const fact = { kind: "window", ...scope, client: null, origin: "forget", actionId: "synthetic-forget",
    window: { startMs: 1, endMs: 20 } };
  await write(scope, tx => suppressions.writeFact(tx, fact, sha256(factIncarnationBody(fact))));
  const [metadata] = await list(scope);
  assert.deepEqual(metadata, {
    ...session, id: "raw-" + opened.adapter.hashSessionKey(scope, session.client, session.sessionId),
    firstEventAt: "1970-01-01T00:00:00.010Z", lastEventAt: "1970-01-01T00:00:00.010Z",
    messageCount: 1, byteCount: Buffer.byteLength(message.content), fenced: false, hidden: true,
  });
  assert.deepEqual(await list(foreign, metadata.id), []);
  assert.equal((await list(foreign))[0].hidden, false);
  assert.deepEqual(await write(scope, tx => raw.deleteConversation(tx, scope, metadata)), { rawDeleted: 1 });
  assert.deepEqual(await list(scope), []);
  assert.equal((await list(foreign)).length, 1);
  const replay = await write(scope, tx => raw.archive(tx, key(scope, "late"), [
    { ...message, id: "fresh-turn", occurredAtMs: 21 },
  ]));
  assert.equal(replay.archived, 0);
  assert.equal(await uow.run(scope.owner, { readOnly: true }, tx => raw.archiveAllowed(tx, key(scope, "late"))), false);
});
