import { createMemoryService } from "@cairn-ink/core/service";
import { testAdapterFindPaging } from "../../core/test/helpers/adapter-find-layer-cursors.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { scratch } from "./storage-fixtures.mjs";

testAdapterFindPaging(async t => {
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
  return {
    storage,
    async reopen() {
      await storage.close();
      storage = await openSqliteAdapter(path);
      return storage;
    },
    scope: { owner: "owner", namespace: null },
    otherOwner: { owner: "another-owner", namespace: null },
    embedding: null,
  };
}, createMemoryService);
