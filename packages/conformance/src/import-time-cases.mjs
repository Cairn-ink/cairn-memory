import { check, equal, rejects, row } from "./support.mjs";

/** @typedef {import("./index.d.mts").CaseContext} Context */
/** @import { MemoryRow } from "@cairn-ink/core/ports" */

const nowMs = 4000;

/** @param {Context} ctx @param {string} text @param {number} [createdAtMs] */
async function importRow(ctx, text, createdAtMs) {
  const { adapter: { uow, memories }, owner } = ctx;
  const content = await row(ctx, text);
  return uow.run(owner, {}, tx => memories.insert(tx, ctx.scope(null), {
    ...content, source: { ...content.source, kind: "import" },
    ...(createdAtMs === undefined ? {} : { createdAtMs }),
  }, [], nowMs));
}

/** @param {Pick<MemoryRow, "createdAtMs" | "updatedAtMs" | "updatedAtUs">} row */
function timestamps({ createdAtMs, updatedAtMs, updatedAtUs }) {
  return { createdAtMs, updatedAtMs, updatedAtUs };
}

/** @type {readonly import("./index.d.mts").ConformanceCase[]} */
export const IMPORT_TIME_CASES = [
  {
    id: "K-IMP-T1", title: "stores supplied creation time and keeps the write time on imported rows", needs: [],
    async run(ctx) {
      const { adapter: { uow, memories }, owner } = ctx;
      const cases = [["past", 10], ["pre-epoch", -10], ["equal", nowMs], ["omitted", undefined]];
      const expected = new Map();
      for (const [label, createdAtMs] of /** @type {[string, number?][]} */ (cases)) {
        const inserted = await importRow(ctx, `Notebook ${label}`, createdAtMs);
        equal(inserted.createdAtMs, createdAtMs ?? nowMs, `Creation time for ${label}`);
        equal(inserted.updatedAtMs, nowMs, `Update time for ${label}`);
        equal(inserted.updatedAtUs / 1000n, BigInt(nowMs), `Update sort key for ${label}`);
        expected.set(inserted.id, timestamps(inserted));
      }
      await uow.run(owner, { readOnly: true }, async tx => {
        for (const [id, times] of expected) {
          const stored = await memories.get(tx, ctx.scope(null), id);
          check(stored, "An imported memory must be readable");
          equal(timestamps(stored), times, "Read must preserve creation and update times");
        }
        const exported = await memories.exportPage(tx, ctx.scope(null), { cursor: null, limit: 10 });
        equal(new Map(exported.items.map(item => [item.id, timestamps(item)])), expected,
          "Export must preserve creation and update times");
      });
    },
  },
  {
    id: "K-IMP-T2", title: "rejects future, fractional, and unsafe creation times", needs: [],
    async run(ctx) {
      for (const createdAtMs of [nowMs + 1, 10.5, Number.MIN_SAFE_INTEGER - 1]) {
        await rejects(() => importRow(ctx, "Notebook entry", createdAtMs), "invalid_input");
      }
    },
  },
  {
    id: "K-IMP-T3", title: "filters import retrieval by creation time and orders recent by update time", needs: [],
    async run(ctx) {
      const { adapter: { uow, lexical, recent }, owner, harness } = ctx;
      const { id: earlier } = await importRow(ctx, "Notebook first", 10);
      const { id: later } = await importRow(ctx, "Notebook second", 15);
      await importRow(ctx, "Notebook outside", 20);
      await harness.setWriteTime(ctx.scope(null), earlier, 3000n);
      await harness.setWriteTime(ctx.scope(null), later, 2000n);
      const selection = () => ({ owner, namespaces: [null], window: { sinceMs: 10, untilMs: 20 } });
      await uow.run(owner, { readOnly: true }, async tx => {
        const words = await lexical.lexical(tx, selection(), "Notebook", 10, {});
        equal(new Set(words.rows.map(({ ref }) => ref.id)), new Set([earlier, later]),
          "Lexical window must include imports by stored creation time");
        const page = await recent.recent(tx, selection(), { cursor: null, limit: 10 });
        equal(page.items.map(({ id, createdAtMs }) => [id, createdAtMs]), [[earlier, 10], [later, 15]],
          "Recent window must use creation time with update time ordering");
      });
    },
  },
];
