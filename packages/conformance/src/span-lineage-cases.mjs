import { check, equal, fixtureEmbedding, rejects } from "./support.mjs";

/** @import { CaptureMessage, FinishItem } from "@cairn-ink/core/ports" */
/** @import { ConformanceCase } from "./index.d.mts" */

/** @type {readonly ConformanceCase[]} */
export const SPAN_LINEAGE_CASES = [
  {
    id: "K-SPAN-1", title: "source Raw gone resolves to []", needs: ["spanLineage", "rawArchive"],
    async run(ctx) {
      const { owner, adapter: { uow, capture, raw, spanLineage } } = ctx;
      check(raw && spanLineage, "rawArchive and spanLineage require their ports");
      const scope = ctx.scope(null);
      const session = { client: "test-client", sessionId: "test-session" };
      const key = { ...session, scope, eventId: "test-event", payloadDigest: "a".repeat(64) };
      /** @type {CaptureMessage} */
      const message = { id: "test-message", role: "user", content: "Basil grows in the greenhouse.", occurredAtMs: 25 };
      const content = "The greenhouse contains basil.";
      const embedding = fixtureEmbedding(ctx);
      /** @type {FinishItem} */
      const item = {
        content, kind: "fact", confidence: 0.8, textHash: await ctx.hash(content),
        embedding: embedding && { model: embedding.model, vector: new Float32Array(embedding.vector) },
        receipts: [{ ...session, messageId: message.id, role: message.role, occurredAtMs: message.occurredAtMs }],
      };
      const claim = await uow.run(owner, { pauseLock: true },
        tx => capture.claim(tx, key, [message], { leaseMs: 60_000 }));
      check(claim.status === "claimed", "The fixture must claim its capture");
      const { memories } = await uow.run(owner, { pauseLock: true }, tx => capture.finish(tx, claim.token, [item]));
      const [memory] = memories;
      check(memories.length === 1 && memory?.outcome === "inserted", "The fixture must insert its capture memory");

      const { archived } = await uow.run(owner, { pauseLock: true }, tx => raw.archive(tx, key, [message]));
      equal(archived, 1, "The fixture must archive its source message");
      const resolve = () => uow.run(owner, { readOnly: true }, tx => spanLineage.resolveSpans(tx, scope, memory.id));
      const spans = await resolve();
      equal(spans.map(({ kind, messageKey }) => ({ kind, messageKey })),
        [{ kind: "rawSpan", messageKey: message.id }], "The archived source must resolve to one span for its message");

      const { rawDeleted } = await uow.run(owner, { pauseLock: true }, tx => raw.deleteConversation(tx, scope, session));
      equal(rawDeleted, 1, "The fixture must delete its source message");
      equal(await resolve(), [], "Deleted source Raw must resolve to []");
    },
  },
  {
    id: "K-SPAN-2", title: "unknown memory throws", needs: ["spanLineage", "rawArchive"],
    async run(ctx) {
      const { owner, adapter: { uow, spanLineage } } = ctx;
      check(spanLineage, "spanLineage requires the span lineage port");
      const scope = ctx.scope(null);
      const id = crypto.randomUUID();
      await rejects(() => uow.run(owner, { readOnly: true }, tx => spanLineage.resolveSpans(tx, scope, id)),
        "raw_lineage_unavailable");
    },
  },
];
