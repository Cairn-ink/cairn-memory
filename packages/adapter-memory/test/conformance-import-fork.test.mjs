import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { IMPORT_ARCHIVE_CASES, PROVEN_FORK_CASES, runCase } from "@cairn-ink/conformance";
import { rawFactory } from "./fixtures/raw.mjs";

const cases = [...IMPORT_ARCHIVE_CASES, ...PROVEN_FORK_CASES];

for (const sessionRefs of ["plain", "hashed"]) {
  for (const required of [false, true]) {
    const factory = rawFactory({ sessionRefs, required });
    for (const testCase of cases) {
      test(`${factory.name} ${testCase.id} ${testCase.title}`, async () => {
        assert.equal(await runCase(factory, testCase), null);
      });
    }
  }
}

for (const flag of ["rawArchive", "rawWindowHide", "rawSpans", "fingerprintKey", "shingleSuppression"]) {
  test(`Import and fork cases skip when ${flag} is unavailable`, async () => {
    const factory = rawFactory({ flags: { [flag]: false } });
    for (const testCase of cases.filter(({ needs }) => needs.includes(flag))) {
      assert.equal(await runCase(factory, testCase), `needs ${flag}`);
    }
  });
}

test("All import cases skip when the optional method is absent", async () => {
  const factory = rawFactory({ create(options) {
    const adapter = createMemoryAdapter(options);
    delete adapter.raw.importArchive;
    return adapter;
  } });
  for (const testCase of IMPORT_ARCHIVE_CASES) {
    assert.equal(await runCase(factory, testCase), "needs raw.importArchive", testCase.id);
  }
});

const scope = { owner: "test-owner", namespace: null };
const root = { scope, client: "test-client", sessionId: "root", eventId: "event", payloadDigest: "a".repeat(64) };
const fork = { ...root, sessionId: "fork", eventId: "fork-event" };
const anchor = { id: "anchor", role: "user", content: "cedar marker", occurredAtMs: 10 };
const turn = { id: "new-turn", role: "assistant", content: "maple grove", occurredAtMs: 20 };

test("Unavailable proofs fail closed for source eligibility, re-check and import", async (t) => {
  const { uow, raw, capture, harness } = createMemoryAdapter({ capabilities: { rawArchive: true } });
  const write = (fn) => uow.run(scope.owner, { pauseLock: true }, fn);
  const read = (fn) => uow.run(scope.owner, { readOnly: true }, fn);
  await write(async (tx) => {
    await raw.recordLineage(tx, root, [anchor]);
    await raw.fenceSession(tx, scope, root);
  });
  assert.deepEqual(await read((tx) => capture.eligible(tx, fork, [turn])), [0]);
  const signing = t.mock.method(crypto.subtle, "sign", async () => { throw new Error("Proof signing unavailable"); });
  const before = await harness.dump();
  assert.deepEqual(await read((tx) => capture.eligible(tx, fork, [turn])), []);
  assert.deepEqual(await write((tx) => raw.importArchive(tx, scope, fork, [turn])),
    { archived: 0, existing: 0, withheld: 1 });
  await assert.rejects(write((tx) => raw.recordLineage(tx, fork, [turn])), { code: "fingerprint_unavailable" });
  assert.deepEqual(await harness.dump(), before);
  assert.equal((await write((tx) => capture.claim(tx, fork, [turn], { leaseMs: 60_000 }))).status, "claimed");
  signing.mock.restore();
  assert.deepEqual(await read((tx) => capture.eligible(tx, fork, [turn])), [0]);
  await assert.rejects(write((tx) => capture.assertEligible(tx, fork, [0])), { code: "lineage_fenced" });
});

test("Rotating row fingerprint keys preserves committed lineage proofs", async () => {
  const { uow, raw, capture, harness } = createMemoryAdapter({
    capabilities: { rawArchive: true, fingerprintKey: true },
  });
  await uow.run(scope.owner, {}, async (tx) => {
    await raw.recordLineage(tx, root, [anchor]);
    await raw.fenceSession(tx, scope, root);
  });
  const before = await harness.dump();
  await harness.setFingerprintSecret("test-rotated-secret");
  assert.deepEqual(await harness.dump(), before);
  const eligible = await uow.run(scope.owner, { readOnly: true }, (tx) => capture.eligible(tx, fork, [anchor, turn]));
  assert.deepEqual(eligible, []);
});
