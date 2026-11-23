import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { CoreError } from "@cairn-ink/core";
import { TEST_FINGERPRINT_LABELS } from "../src/privacy.mjs";
import { createRawPorts } from "../src/raw.mjs";
import { createUnitOfWork } from "../src/unit-of-work.mjs";

const scope = { owner: "owner", namespace: null };
const captureKey = (sessionId, client = "client") => ({
  scope, client, sessionId, eventId: sessionId, payloadDigest: "a".repeat(64),
});
const message = (id) => ({ id, role: "user", content: "cedar", occurredAtMs: null });

for (const mode of ["archive", "importArchive"]) {
  test(`${mode} rejects invalid message IDs without writing any row in the batch`, async () => {
    const { harness, raw, uow } = createMemoryAdapter({ capabilities: { rawArchive: true } });
    const key = captureKey("source");
    const submit = (ids) => uow.run(scope.owner, {}, (tx) => {
      const messages = ids.map(message);
      return mode === "archive" ? raw.archive(tx, key, messages) : raw.importArchive(tx, scope, key, messages);
    });
    const before = await harness.dump();
    for (const id of ["", "a".repeat(201), "🌲".repeat(101), " a", "a\u0000b", "\ud800"]) {
      await assert.rejects(submit(["valid", id]), { code: "invalid_input" });
      assert.deepEqual(await harness.dump(), before);
    }
    assert.equal((await submit(["a", "🌲".repeat(100)])).archived, 2);
  });
}

test("an unlocked claim rejects before reading the capture key", async () => {
  const { capture, uow } = createMemoryAdapter();
  let reads = 0;
  const key = {
    get scope() {
      reads++;
      throw new CoreError("invalid_input");
    },
  };
  await assert.rejects(uow.run(scope.owner, {}, (tx) => capture.claim(tx, key, [], { leaseMs: 1 })),
    { code: "internal_error" });
  assert.equal(reads, 0);
  await assert.rejects(uow.run(scope.owner, { pauseLock: true }, (tx) => capture.claim(tx, key, [], { leaseMs: 1 })),
    { code: "invalid_input" });
  assert.equal(reads, 1);
});

test("fork eligibility and import examine only anchors of fenced sessions for the client", async () => {
  const work = createUnitOfWork({});
  const { raw, lineageFenced, captureProofs } = createRawPorts(work, { userKey: async () => null },
    async () => [], TEST_FINGERPRINT_LABELS);
  const sources = Array.from({ length: 12 }, (_, index) => captureKey(`source-${index}`));
  const otherClient = captureKey("other-source", "other-client");
  const incoming = captureKey("incoming");
  const messages = [message("shared")];
  await work.uow.run(scope.owner, {}, async (tx) => {
    for (const key of [...sources, otherClient]) await raw.recordLineage(tx, key, messages);
  });
  const proofs = await captureProofs(scope, incoming.client, messages);

  async function observeAnchors(tx, check) {
    return work.port.read(tx, scope, async (getState) => {
      const state = getState();
      const anchors = [state.rawAnchors, state.rawUnfencedAnchors].flatMap((index) =>
        [...(index?.get(incoming.client)?.values() ?? [])]);
      let examined = 0;
      const snapshots = anchors.map((anchor) => [anchor, anchor.messages]);
      for (const [anchor, messages] of snapshots) {
        Object.defineProperty(anchor, "messages", { get() { examined++; return messages; }, configurable: true });
      }
      try {
        return { result: await check(state), examined };
      } finally {
        for (const [anchor, messages] of snapshots) {
          Object.defineProperty(anchor, "messages", { value: messages, writable: true });
        }
      }
    });
  }

  async function eligibility() {
    return work.uow.run(scope.owner, { readOnly: true }, (tx) => observeAnchors(tx,
      (state) => lineageFenced(state, scope, incoming, proofs)));
  }

  async function importMessages() {
    return work.uow.run(scope.owner, {}, (tx) => observeAnchors(tx,
      () => raw.importArchive(tx, scope, incoming, messages)));
  }

  assert.deepEqual([await eligibility(), await importMessages()], [
    { result: false, examined: 0 }, { result: { archived: 1, existing: 0, withheld: 0 }, examined: 0 },
  ]);
  await work.uow.run(scope.owner, {}, (tx) => raw.fenceSession(tx, scope, otherClient));
  assert.deepEqual(await eligibility(), { result: false, examined: 0 });
  assert.deepEqual(await importMessages(), { result: { archived: 0, existing: 1, withheld: 0 }, examined: 0 });
  await work.uow.run(scope.owner, {}, (tx) => raw.fenceSession(tx, scope, sources.at(-1)));
  assert.deepEqual(await eligibility(), { result: true, examined: 1 });
  assert.deepEqual(await importMessages(), { result: { archived: 0, existing: 0, withheld: 1 }, examined: 1 });
});
