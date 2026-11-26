import assert from "node:assert/strict";
import { test } from "node:test";
import { runCase } from "@cairn-ink/conformance";
import { DOCUMENT_CARD_CORRECT_CASES } from "@cairn-ink/conformance/document-card-correct";
import { createSqliteAdapter } from "../src/adapter.mjs";
import { openStorage } from "../src/schema/open.mjs";
import { scopeKey } from "../src/storage-values.mjs";
import { scratch, testAccess } from "./storage-fixtures.mjs";

for (const correction of DOCUMENT_CARD_CORRECT_CASES) {
  test(correction.id + " " + correction.title, async () => {
    let scope;
    const factory = {
      name: "sqlite document card correction",
      async open({ capabilities }) {
        const { path, remove } = scratch();
        let storage;
        try {
          storage = await openStorage(path);
          // This profile supplies the Context Read generation accessor when it
          // is required. The Context Read card candidate channel is separate.
          const adapter = createSqliteAdapter(storage, { capabilities: {
            ...capabilities, contextRead: correction.needs.includes("contextRead"),
          } });
          return {
            adapter: { ...adapter, memories: { ...adapter.memories, async insert(tx, scope, row, receipts, now) {
              // The kit seeds a receipt in the card's archived conversation.
              // SQLite needs that receipt's own turn for live source proof.
              for (const { client, sessionId, messageId, role, excerpt, occurredAtMs } of receipts) {
                await adapter.raw.archive(tx, { scope, client, sessionId, eventId: messageId, payloadDigest: "c".repeat(64) },
                  [{ id: messageId, role, content: excerpt, occurredAtMs }]);
              }
              return adapter.memories.insert(tx, scope, row, receipts, now);
            } } },
            sessionRefs: "hashed", embeddingDimensions: null,
            harness: {
              hashSessionKey: (client, sessionId) => adapter.hashSessionKey(scope, client, sessionId),
              dump: () => testAccess({ adapter, port: storage.port }, scope, {}, db => [{
                owner: scope.owner,
                documentCards: [{ cards: db.prepare(`SELECT * FROM cairn_document_cards
                  WHERE owner_id = ? AND namespace_key = ? ORDER BY id`).all(...scopeKey(scope))
                  .map(row => [row.id, row]) }],
                rawRows: db.prepare(`SELECT * FROM cairn_raw_messages
                  WHERE owner_id = ? AND namespace_key = ? ORDER BY client_key, session_key, message_key`)
                  .all(...scopeKey(scope)),
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
    assert.equal(await runCase(factory, {
      ...correction,
      run(context) {
        scope = context.scope(null);
        return correction.run(context);
      },
    }), null);
  });
}
