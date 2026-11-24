import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { RECEIPT_WITHHELD_CASES, runCase } from "@cairn-ink/conformance";
import { CoreError } from "@cairn-ink/core";
import { rawFactory } from "./fixtures/raw.mjs";

const testCase = RECEIPT_WITHHELD_CASES.find(({ id }) => id === "K-RCPT-W1");
assert.ok(testCase);

for (const sessionRefs of ["plain", "hashed"]) {
  for (const required of [false, true]) {
    const factory = rawFactory({ sessionRefs, required });
    test(`${factory.name} ${testCase.id} ${testCase.title}`, async () => {
      assert.equal(await runCase(factory, testCase), null);
    });
  }
}

/** @param {(adapter: ReturnType<typeof createMemoryAdapter>) => void} mutate */
function mutant(mutate) {
  return rawFactory({
    create(options) {
      const reference = createMemoryAdapter(options);
      const adapter = { ...reference, suppressions: { ...reference.suppressions } };
      mutate(adapter);
      return adapter;
    },
  });
}

test("K-RCPT-W1 rejects a missing receiptWithheld port", async () => {
  const factory = mutant(({ suppressions }) => { delete suppressions.receiptWithheld; });
  await assert.rejects(runCase(factory, testCase),
    /^Error: An adapter with rawArchive must implement suppressions\.receiptWithheld$/);
});

test("K-RCPT-W1 rejects a port that always allows receipts", async () => {
  const factory = mutant(({ suppressions }) => { suppressions.receiptWithheld = async () => false; });
  await assert.rejects(runCase(factory, testCase),
    /^Error: A receipt from a deleted conversation must be withheld$/);
});

test("K-RCPT-W1 rejects a port that always withholds receipts", async () => {
  const factory = mutant(({ suppressions }) => { suppressions.receiptWithheld = async () => true; });
  await assert.rejects(runCase(factory, testCase),
    /^Error: A receipt from a visible archived message must not be withheld$/);
});

test("K-RCPT-W1 rejects a port that allows receipts from fenced conversations", async () => {
  const factory = mutant(adapter => {
    const { raw, suppressions } = adapter;
    const { receiptWithheld } = suppressions;
    assert.ok(raw && receiptWithheld);
    const fencedSessions = new Set();
    adapter.raw = {
      ...raw,
      async fenceSession(tx, scope, session) {
        await raw.fenceSession(tx, scope, session);
        fencedSessions.add(session.sessionId);
      },
    };
    suppressions.receiptWithheld = async (tx, scope, receipt) => fencedSessions.has(receipt.sessionId)
      ? false : receiptWithheld.call(suppressions, tx, scope, receipt);
  });
  await assert.rejects(runCase(factory, testCase),
    /^Error: A receipt from a fenced conversation must be withheld$/);
});

test("K-RCPT-W1 rejects a port that only fails when core calls it during save", async () => {
  let calls = 0;
  const factory = mutant(({ suppressions }) => {
    const { receiptWithheld } = suppressions;
    assert.ok(receiptWithheld);
    suppressions.receiptWithheld = async (tx, scope, receipt) => {
      // The case probes the port three times before core's save makes the fourth call.
      if (++calls > 3) throw new CoreError("storage_transaction_active");
      return receiptWithheld.call(suppressions, tx, scope, receipt);
    };
  });
  await assert.rejects(runCase(factory, testCase), error => {
    assert.equal(error.message, "Core save must suppress a receipt from a deleted conversation (save rejected)");
    assert.equal(error.cause?.message, "storage_transaction_active");
    return true;
  });
});

test("K-RCPT-W1 rejects a port that writes while it checks a receipt", async () => {
  const factory = mutant(adapter => {
    const { raw, suppressions } = adapter;
    const { receiptWithheld } = suppressions;
    assert.ok(raw && receiptWithheld);
    let writes = 0;
    suppressions.receiptWithheld = async (tx, scope, receipt) => {
      await raw.fenceSession(tx, scope, { client: "side-effect", sessionId: `side-effect-${++writes}` });
      return receiptWithheld.call(suppressions, tx, scope, receipt);
    };
  });
  await assert.rejects(runCase(factory, testCase),
    /^Error: A suppressed deleted receipt save must leave the dump unchanged$/);
});
