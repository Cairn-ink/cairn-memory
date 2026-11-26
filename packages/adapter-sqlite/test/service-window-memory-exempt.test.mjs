import { test } from "node:test";
import { windowMemoryScenarios } from "../../core/test/helpers/service-window-memory-exempt.mjs";
import { openSqliteAdapter } from "../src/adapter.mjs";
import { scratch } from "./storage-fixtures.mjs";

for (const [name, scenario] of Object.entries(windowMemoryScenarios)) {
  test(`SQLite keyless ${name}`, async t => {
    const { path, remove } = scratch();
    let adapter;
    t.after(async () => {
      try { await adapter?.close(); }
      finally { remove(); }
    });
    adapter = await openSqliteAdapter(path, { capabilities: { contextRead: true, contextRawRead: true, placement: true } });
    await scenario(t, adapter);
  });
}
