import { check, equal, rejects, row } from "./support.mjs";

/** @typedef {import("./index.d.mts").CaseContext} Context */

/** @param {Context} ctx @param {string} text @param {number} time
 * @param {string | null} client @param {number | null} [distance]
 */
async function insert(ctx, text, time, client, distance = null) {
  const { adapter: { uow, memories }, owner } = ctx;
  const content = await row(ctx, text, distance);
  const { id } = await uow.run(owner, {}, tx =>
    memories.insert(tx, ctx.scope(null), { ...content, source: { ...content.source, client } }, [], time));
  return id;
}

/** @type {readonly import("./index.d.mts").ConformanceCase[]} */
export const RETRIEVAL_WINDOW_CASES = [
  {
    id: "K-RET-W1", title: "applies half-open creation windows and client filters inside memory queries", needs: [],
    async run(ctx) {
      const { adapter: { uow, lexical, recent }, owner, harness } = ctx;
      await insert(ctx, "orchard before", 9, "one");
      const start = await insert(ctx, "orchard start", 10, "one");
      const middle = await insert(ctx, "orchard middle", 15, "one");
      const noClient = await insert(ctx, "orchard unassigned", 16, null);
      const otherClient = await insert(ctx, "orchard different", 17, "two");
      await insert(ctx, "orchard end", 20, "one");
      await harness.setWriteTime(ctx.scope(null), start, 21_000n);
      const selection = { owner, namespaces: [null], window: { sinceMs: 10, untilMs: 20 } };

      await uow.run(owner, { readOnly: true }, async tx => {
        const words = await lexical.lexical(tx, selection, "orchard", 10, {});
        equal(new Set(words.rows.map(({ ref }) => ref.id)), new Set([start, middle, noClient, otherClient]),
          "Lexical window must use half-open creation time");
        const page = await recent.recent(tx, selection, { cursor: null, limit: 10 });
        equal(page.items.map(({ id }) => id), [start, otherClient, noClient, middle], "Recent window or order");

        const filtered = { ...selection, clients: ["one"] };
        const filteredWords = await lexical.lexical(tx, filtered, "orchard", 10, {});
        equal(new Set(filteredWords.rows.map(({ ref }) => ref.id)), new Set([start, middle]), "Lexical memory clients");
        const filteredPage = await recent.recent(tx, filtered, { cursor: null, limit: 2 });
        equal(filteredPage.items.map(({ id }) => id), [start, middle], "Recent must filter clients before limiting");
      });
    },
  },
  {
    id: "K-RET-W2", title: "filters vector candidates and coverage before depth", needs: ["semanticRetrieval"],
    async run(ctx) {
      const { adapter: { uow, vector }, owner } = ctx;
      check(vector, "Semantic retrieval requires a vector port");
      await insert(ctx, "outside", 20, "one", 0);
      await insert(ctx, "unassigned", 10, null, 0.25);
      const match = await insert(ctx, "match", 10, "one", 0.75);
      const selection = { owner, namespaces: [null], clients: ["one"], window: { sinceMs: 10, untilMs: 20 } };
      await uow.run(owner, { readOnly: true }, async tx => {
        const result = await vector.vector(tx, selection, new Float32Array(ctx.vec(0)), "test", 1);
        equal(result.rows.map(({ ref }) => ref.id), [match], "Vector must filter window and clients before depth");
        equal(result.coverage, { eligible: 1, embedded: 1, complete: true }, "Vector coverage must use the filtered read set");
      });
    },
  },
  {
    id: "K-SNAP-W1", title: "binds state tokens to both window bounds", needs: [],
    async run({ adapter: { uow, snapshot }, owner }) {
      const selection = { owner, namespaces: [null], window: { sinceMs: 10, untilMs: 20 } };
      await uow.run(owner, { readOnly: true }, async tx => {
        const token = await snapshot.stateToken(tx, selection);
        await snapshot.assertUnchanged(tx, selection, token);
        for (const window of [undefined, { sinceMs: 11, untilMs: 20 }, { sinceMs: 10, untilMs: 21 }]) {
          const changed = { ...selection, window };
          check(await snapshot.stateToken(tx, changed) !== token, "State token was unchanged for a different window");
          await rejects(() => snapshot.assertUnchanged(tx, changed, token), "cursor_stale");
        }
      });
    },
  },
  {
    id: "K-RAW-W1", title: "excludes null event times and applies half-open raw windows", needs: [],
    async run({ adapter: { capabilities, uow, raw }, owner, scope, hash }) {
      if (!capabilities.rawArchive) return "needs rawArchive";
      check(raw, "Raw archive requires a raw port");
      /** @type {import("@cairn-ink/core/ports").CaptureMessage[]} */
      const messages = [
        { id: "unknown", occurredAtMs: null, role: "user", content: "orchard unknown" },
        { id: "start", occurredAtMs: 10, role: "user", content: "orchard start" },
        { id: "end", occurredAtMs: 20, role: "user", content: "orchard end" },
      ];
      const key = { scope: scope(null), client: "one", sessionId: "session", eventId: "event",
        payloadDigest: (await hash(JSON.stringify(messages))).slice("sha256:".length) };
      await uow.run(owner, { pauseLock: true }, async tx => {
        await raw.recordLineage(tx, key, messages);
        const { archived } = await raw.archive(tx, key, messages);
        equal(archived, messages.length, "Raw fixture was not archived");
      });
      await uow.run(owner, { readOnly: true }, async tx => {
        const selection = { owner, namespaces: [key.scope.namespace], clients: [key.client] };
        const all = await raw.raw(tx, selection, "orchard", "search", { limit: 10 });
        equal(new Set(all.segments.map(({ messageId }) => messageId)), new Set(messages.map(({ id }) => id)),
          "Unwindowed raw search must include null times");
        const window = { sinceMs: 10, untilMs: 20 };
        const filtered = await raw.raw(tx, { ...selection, window }, "orchard", "search", { limit: 10 });
        equal(filtered.segments.map(({ messageId }) => messageId), ["start"], "Raw half-open window or null-time filter");
      });
    },
  },
];
