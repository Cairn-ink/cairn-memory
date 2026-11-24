import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { assertDeletedCapture, deletionTimings } from "../../core/test/helpers/service-capture-withdrawal.mjs";

for (const [timing, boundary] of Object.entries(deletionTimings)) {
  test(`memory capture withdraws the deleted conversation ${boundary}`, async () => {
    const storage = createMemoryAdapter({ capabilities: { rawArchive: true } });
    await assertDeletedCapture(storage, timing, async () => {
      const [{ rows, rawRows }] = await storage.harness.dump();
      return { memories: rows, raw: rawRows };
    });
  });
}
