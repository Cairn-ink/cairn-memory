import { createMemoryService } from "@cairn-ink/core/service";
import { equal } from "./support.mjs";

/** @import {CallOptions, CaptureMessage, DetectChangesRequest, ModelPort, Tx, VerifyChangeRequest} from "@cairn-ink/core/ports" */
/** @import {MemoryServiceConfig} from "@cairn-ink/core/service" */
/** @import {CaseContext} from "./index.d.mts" */

export const firstDay = Date.UTC(2025, 0, 1);
export const nextDay = firstDay + 86_400_000;
export const client = "client";
export const update = "The hatch now opens at 10.";

/** @param {string} id @param {string} content @param {number} [occurredAtMs] @returns {CaptureMessage} */
export const message = (id, content, occurredAtMs = firstDay) => ({ id, content, occurredAtMs, role: "user" });
export const plan = message("plan", "Remember this maintenance plan. " +
  "The hatch opens at 8 each morning. ".repeat(7).trimEnd());
export const correction = message("update", update, nextDay);

/** @param {string} content @param {number[]} [sourceIndices] */
export const extract = (content, sourceIndices = [0]) => ({ kind: "fact", content, confidence: 0.9, sourceIndices });
export const tea = { item: 0, kind: "record", measure: "spend", category: "tea", value: 6, unit: "USD", group: "food",
  period: "none", comparator: "none" };

/** @param {CaseContext} ctx @param {MemoryServiceConfig} config
 * @param {ModelPort["call"]} [call] @param {Pick<ModelPort, "detectChanges" | "verifyChange">} [methods] */
export function captureService(ctx, config, call = async () => ({ items: [] }), methods = {}) {
  let active = 0;
  const { adapter, owner } = ctx;
  const scope = ctx.scope(null);
  const storage = {
    name: "conformance",
    ...adapter,
    uow: {
      /** @type {typeof adapter.uow.run} */
      run(id, options, work) {
        return adapter.uow.run(id, options, async tx => {
          active++;
          try { return await work(tx); }
          finally { active--; }
        });
      },
    },
  };
  const countTokens = () => 1;
  const service = createMemoryService({
    storage, config,
    ...(ctx.harness.hashSessionKey && { documentCardSessionKey: (/** @type {import("@cairn-ink/core/ports").DocumentCardSession} */ { client, sessionId }) =>
      ctx.harness.hashSessionKey?.(client, sessionId) ?? null }),
    model: { model: "test", contextWindow: 32_768, countTokens,
      async call(...args) {
        equal(active, 0, "Extraction must run outside the transaction");
        return call(...args);
      },
      ...(methods.detectChanges && {
        /** @param {DetectChangesRequest} request @param {CallOptions} [options] */
        async detectChanges(request, options) {
          equal(active, 0, "Detection must run outside the transaction");
          return methods.detectChanges?.(request, options) ?? { changes: [] };
        },
      }),
      ...(methods.verifyChange && {
        /** @param {VerifyChangeRequest} request @param {CallOptions} [options] */
        async verifyChange(request, options) {
          equal(active, 0, "Verification must run outside the transaction");
          return methods.verifyChange?.(request, options) ?? { applies: false, line: "" };
        },
      }),
    },
    embedder: {
      model: "test", dimensions: ctx.embeddingDimensions ?? 1,
      async embed(inputs) {
        equal(active, 0, "Embedding must run outside the transaction");
        return inputs.map(() => Float32Array.from(ctx.embeddingDimensions ? ctx.vec(0) : [1]));
      },
    },
    tokens: { countTokens },
    clock: {
      nowMs: Date.now, monotonicMs: () => performance.now(),
      async sha256Hex(text) {
        if (typeof text !== "string") throw Error("Unexpected binary hash");
        return (await ctx.hash(text)).slice("sha256:".length);
      },
      async hmacHex() { throw Error("Unexpected HMAC"); },
    },
    gate: { async assertOpen() { equal(active, 0, "Gate must run outside the transaction"); } },
  });
  return {
    service, scope,
    /** @template T @param {(tx: Tx) => Promise<T>} work */
    read: work => adapter.uow.run(owner, { readOnly: true }, work),
    /** @param {string} sessionId @param {string} eventId @param {readonly CaptureMessage[]} messages */
    async capture(sessionId, eventId, messages) {
      const selection = { client, sessionId, eventId };
      const admitted = await service.enqueueCapture(scope, { ...selection, messages: [...messages] });
      equal(admitted.status, "accepted", "Capture admission");
      const done = await service.runCapture(scope, selection);
      equal(done.status, "done", "Capture finish");
      return done.result;
    },
  };
}
