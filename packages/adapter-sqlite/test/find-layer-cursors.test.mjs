import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createMemoryService } from "@cairn-ink/core/service";
import { testAdapterFindPaging, testAdapterFindVersions } from "../../core/test/helpers/adapter-find-layer-cursors.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { scopeKey } from "../src/storage-values.mjs";
import { scratch } from "./storage-fixtures.mjs";

async function open(t) {
  const { path, remove } = scratch();
  let storage;
  t.after(async () => {
    try {
      await storage?.close();
    } finally {
      remove();
    }
  });
  storage = await openSqliteAdapter(path);
  const scope = { owner: "owner", namespace: null };
  return {
    storage, scope,
    async reopen() {
      await storage.close();
      storage = await openSqliteAdapter(path);
      return storage;
    },
    replaceRaw({ client, sessionId, messageId }, content) {
      const db = new DatabaseSync(path);
      try {
        const result = db.prepare(`UPDATE cairn_raw_messages SET content = ?
          WHERE owner_id = ? AND namespace_key = ? AND client_key = ? AND session_key = ? AND message_key = ?`)
          .run(JSON.stringify(content), ...scopeKey(scope), JSON.stringify(client), JSON.stringify(sessionId), JSON.stringify(messageId));
        assert.equal(result.changes, 1);
      } finally {
        db.close();
      }
    },
    otherOwner: { owner: "another-owner", namespace: null },
    embedding: null,
  };
}

testAdapterFindPaging(open, createMemoryService);
testAdapterFindVersions(open, createMemoryService, ["memory", "raw"]);
