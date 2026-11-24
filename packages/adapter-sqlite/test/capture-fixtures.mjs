import { createSqliteAdapter } from "../src/adapter.mjs";
import { openStorage } from "../src/schema/open.mjs";
import { scratch } from "./storage-fixtures.mjs";

export async function captureFixture() {
  const { path, remove } = scratch();
  let now = 1_000;
  let storage;
  let adapter;
  async function reopen() {
    await adapter?.close();
    storage = await openStorage(path);
    adapter = createSqliteAdapter(storage, { now: () => now });
    return adapter;
  }
  try {
    await reopen();
  } catch (error) {
    remove();
    throw error;
  }
  return {
    path, reopen,
    get adapter() { return adapter; },
    get port() { return storage.port; },
    advanceClock(ms) { now += ms; },
    async close() {
      try {
        await adapter.close();
      } finally {
        remove();
      }
    },
  };
}
