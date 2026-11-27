import assert from "node:assert/strict";
import { test } from "node:test";
import { DOCUMENT_CARD_CORRECTION_PRIVACY_CASE, runCase } from "@cairn-ink/conformance";
import { openSqliteAdapter } from "../src/adapter.mjs";
import { scratch } from "./storage-fixtures.mjs";

const privacy = DOCUMENT_CARD_CORRECTION_PRIVACY_CASE;
test(privacy.id + " " + privacy.title, async () => {
  const { path, remove } = scratch();
  try {
    let scope;
    const factory = {
      name: "sqlite document card correction privacy",
      async open({ capabilities }) {
        const adapter = await openSqliteAdapter(path, { capabilities });
        return { adapter, sessionRefs: "hashed",
          harness: { hashSessionKey: (client, sessionId) => adapter.hashSessionKey(scope, client, sessionId) },
          embeddingDimensions: null, close: () => adapter.close() };
      },
    };
    assert.equal(await runCase(factory, { ...privacy, run(ctx) {
      scope = ctx.scope(null);
      return privacy.run(ctx);
    } }), null);
  } finally {
    remove();
  }
});
