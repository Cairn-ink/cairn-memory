import assert from "node:assert/strict";
import test from "node:test";
import { CAPTURE_CASES, CASES, PRIVACY_MATCH_CASES, RELATION_CASES, RETRIEVAL_WINDOW_CASES, runCase } from "@cairn-ink/conformance";
import { createSqliteAdapter } from "../src/adapter.mjs";
import { openStorage } from "../src/schema/open.mjs";
import { scratch, seedFact, setWriteTime } from "./storage-fixtures.mjs";
import { waitForVectorCache } from "./vector-fixtures.mjs";

const usesVector = spec => spec.needs.includes("semanticRetrieval") || spec.needsOff?.includes("semanticRetrieval") ||
  spec.requests?.semanticRetrieval === true;

for (const { followUp, ...kitCase } of [
  ...CASES, ...CAPTURE_CASES, ...PRIVACY_MATCH_CASES, ...RELATION_CASES, ...RETRIEVAL_WINDOW_CASES,
]) {
  if (usesVector(kitCase)) register(kitCase, `${kitCase.id} ${kitCase.title}`);
  if (followUp && usesVector(followUp)) register(followUp, `${kitCase.id} semantic retrieval follow-up`);
}

function register(kitCase, name) {
  test(name, async t => {
    let caseOwner;
    const factory = {
      name: "sqlite",
      async open({ capabilities }) {
        const { path, remove } = scratch();
        t.after(remove);
        const storage = await openStorage(path);
        const adapter = createSqliteAdapter(storage, { capabilities });
        assert.equal(adapter.capabilities.semanticRetrieval, capabilities.semanticRetrieval);
        return {
          adapter: { ...adapter, uow: { async run(owner, options, work) {
            if (capabilities.semanticRetrieval && options.readOnly) await waitForVectorCache(adapter, owner);
            return adapter.uow.run(owner, options, work);
          } } },
          embeddingDimensions: 4,
          sessionRefs: "hashed",
          close: adapter.close,
          harness: {
            hashSessionKey: (client, sessionId) => adapter.hashSessionKey({ owner: caseOwner, namespace: null }, client, sessionId),
            seedFact(owner, fact) {
              assert.equal(owner, fact.owner);
              return seedFact(adapter, fact);
            },
            setWriteTime: (scope, id, time) => setWriteTime({ adapter, port: storage.port }, scope, id, time),
          },
        };
      },
    };
    const reason = await runCase(factory, { ...kitCase, run(context) {
      caseOwner = context.owner;
      return kitCase.run(context);
    } });
    if (kitCase.needs.includes("vectorSuppression")) {
      assert.equal(reason, "needs vectorSuppression");
      t.skip("local forget is exact + identity/span, as 0.6.x");
    } else {
      assert.equal(reason, null);
    }
  });
}
