import assert from "node:assert/strict";
import test from "node:test";
import { CASES, FENCE_INTENT_CASES, RETRIEVAL_WINDOW_CASES, runCase } from "@cairn-ink/conformance";
import { fixture, seedFact, setWriteTime } from "./storage-fixtures.mjs";

const factory = {
  name: "sqlite",
  async open() {
    const opened = await fixture();
    return {
      adapter: opened.adapter,
      embeddingDimensions: 4,
      sessionRefs: "hashed",
      close: opened.close,
      harness: {
        seedFact(owner, fact) {
          assert.equal(fact.owner, owner);
          return seedFact(opened.adapter, fact);
        },
        setWriteTime: (scope, id, time) => setWriteTime(opened, scope, id, time),
      },
    };
  },
};

for (const kitCase of [
  ...CASES.filter(({ id }) => /^K-(?:RET-|SNAP-|HYD-|FEN-|CAP-2$)/u.test(id)),
  ...RETRIEVAL_WINDOW_CASES.filter(({ id }) => /^K-(?:RET-|SNAP-)/u.test(id)),
  ...FENCE_INTENT_CASES,
]) {
  test(`${kitCase.id} ${kitCase.title}`, async t => {
    const reason = await runCase(factory, kitCase);
    if (reason === null) return;
    assert.ok(kitCase.pending || kitCase.needs.length ||
      reason === "needs supersession to produce historical memories", `Unexpected skip: ${reason}`);
    t.skip(reason);
  });
}
