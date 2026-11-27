import assert from "node:assert/strict";
import test from "node:test";
import * as kit from "@cairn-ink/conformance";
import { CONTEXT_READ_DOCUMENT_CARD_CASES } from "@cairn-ink/conformance/context-read-document-cards";
import { DOCUMENT_CARD_VISIBILITY_INPUT_CASES } from "@cairn-ink/conformance/document-card-visibility-input";
import { createSqliteAdapter } from "../src/adapter.mjs";
import { DOCUMENT_CARD_TABLES } from "../src/schema/document-cards.mjs";
import { openStorage } from "../src/schema/open.mjs";
import { seedFact, scratch, testAccess } from "./storage-fixtures.mjs";

function factory(getScope) {
  return {
    name: "sqlite document cards",
    async open({ capabilities }) {
      const { path, remove } = scratch();
      let storage;
      let now = 1;
      try {
        storage = await openStorage(path);
        const adapter = createSqliteAdapter(storage, { capabilities, now: () => now });
        const cards = adapter.documentCards;
        const withRawFixture = cards && capabilities.placement && !capabilities.rawArchive;
        return {
          adapter: withRawFixture ? { ...adapter, documentCards: { ...cards, async put(tx, scope, card, embedding) {
            // The filing case uses a router card on a reference profile with
            // Raw disabled. SQLite requires its real archived source to file it.
            if (card.sourceMessage) {
              const { client, sessionId, messageId } = card.sourceMessage;
              await adapter.raw.archive(tx, { scope, client, sessionId, eventId: messageId, payloadDigest: "a".repeat(64) },
                [{ id: messageId, role: "user", content: card.body, occurredAtMs: card.date }]);
            }
            return cards.put(tx, scope, card, embedding);
          } } } : adapter,
          sessionRefs: "hashed", embeddingDimensions: null,
          harness: {
            hashSessionKey: (client, sessionId) => adapter.hashSessionKey(getScope(), client, sessionId),
            seedFact(owner, fact) {
              assert.equal(fact.owner, owner);
              return seedFact(adapter, fact);
            },
            advanceClock(ms) { now += ms; },
            dump: () => testAccess({ adapter, port: storage.port }, getScope(), {}, db => [{
              owner: getScope().owner,
              documentCards: DOCUMENT_CARD_TABLES.map(table => db.prepare(`SELECT * FROM ${table}`).all()),
              revisions: db.prepare("SELECT * FROM cairn_index_revisions").all(),
            }]),
          },
          async close() {
            try { await adapter.close(); }
            finally { remove(); }
          },
        };
      } catch (error) {
        try { await storage?.close(); }
        finally { remove(); }
        throw error;
      }
    },
  };
}

const cardCases = [...Object.values(kit).filter(Array.isArray).flat()
  .filter(testCase => testCase.needs.includes("documentCards") || testCase.requests?.documentCards),
  ...DOCUMENT_CARD_VISIBILITY_INPUT_CASES, ...CONTEXT_READ_DOCUMENT_CARD_CASES];
const needsContextReadCardChannel = new Set([
  "T-CONTEXT-DOCUMENT-CARD-1",
  "T-CONTEXT-DOCUMENT-CARD-2",
  "T-CONTEXT-DOCUMENT-CARD-3",
]);
for (const parent of new Set(cardCases)) {
  const cases = [{ ...parent, followUp: undefined }];
  if (parent.followUp) cases.push({ id: parent.id + " follow-up", title: parent.title, ...parent.followUp });
  for (const testCase of cases) {
    test(testCase.id + " " + testCase.title, {
      skip: needsContextReadCardChannel.has(testCase.id) && "SQLite Context Read card channel is pending (Addenda 22/23)",
    }, async t => {
      let scope;
      const reason = await kit.runCase(factory(() => scope), {
        ...testCase,
        run(context) {
          scope = context.scope(null);
          return testCase.run({ ...context, scope(namespace) {
            scope = context.scope(namespace);
            return scope;
          } });
        },
      });
      if (reason === null) return;
      const unsupported = [
        ...testCase.needs.map(flag => `needs ${flag}`),
        ...(testCase.needsOff ?? []).map(flag => `needs ${flag} off`),
        "needs plain session references",
      ];
      assert.ok(unsupported.includes(reason), `Unexpected kit skip: ${reason}`);
      t.skip(reason);
    });
  }
}
