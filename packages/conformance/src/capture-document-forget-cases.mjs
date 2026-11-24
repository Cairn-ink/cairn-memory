import { captureService, extract, message, plan, tea } from "./capture-documents-support.mjs";
import { check, equal } from "./support.mjs";

const forgetSource = { kind: /** @type {const} */ ("web"), client: null, sessionId: null };

/** @param {import("./index.d.mts").CaseContext} ctx @param {number} position */
async function forgetBoundMemory(ctx, position) {
  if (!ctx.adapter.capture.admit) return "needs capture.admit";
  if (ctx.sessionRefs !== "plain") return "needs plain session references";
  const { documentCards } = ctx.adapter;
  check(documentCards, "Expected document card storage");
  let hiddenByMemory = 0;
  const fixture = { ...ctx, adapter: { ...ctx.adapter, documentCards: { ...documentCards,
    /** @type {typeof documentCards.hideWhere} */
    async hideWhere(tx, scope, selector, reason) {
      const result = await documentCards.hideWhere(tx, scope, selector, reason);
      if (selector.sourceMemoryId) hiddenByMemory += result.hidden;
      return result;
    },
  } } };
  const f = captureService(fixture, { documentCards: { enabled: true } },
    async () => ({ items: [extract("The hatch opens at 8."), extract("Oil the hinges each week.")] }));
  const result = await f.capture("plan", "plan", [plan]);
  check(result?.memories.length === 2, "Expected two captured memories");
  const [card] = await f.read(tx => documentCards.list(tx, f.scope));
  equal(card?.sourceMemories.length, 2, "Both memories must be bound before forget");
  const forgotten = await f.service.forget(f.scope, result.memories[position].id, forgetSource);
  equal(forgotten.status, "forgotten", "Expected to forget the bound memory");
  equal(hiddenByMemory, 1, "The memory selector itself must hide the card");
  equal(await f.read(tx => documentCards.get(tx, f.scope, card.id)), null, "A bound-memory forget hides the card");
}

/** @type {readonly import("./index.d.mts").ConformanceCase[]} */
export const CAPTURE_DOCUMENT_FORGET_CASES = [
  ...[0, 1].map(position => ({
    id: "CAPTURE-FORGET-" + (position + 1), title: "forgetting either linked memory hides its captured document",
    needs: /** @type {import("@cairn-ink/core").Capability[]} */ (["documentCards"]),
    needsOff: /** @type {import("@cairn-ink/core").Capability[]} */ (["nearDuplicate"]),
    run: (/** @type {import("./index.d.mts").CaseContext} */ ctx) => forgetBoundMemory(ctx, position),
  })),
  {
    id: "CAPTURE-FORGET-3", title: "forgetting a captured quantity source drops its ledger rows",
    needs: ["quantityLedger"],
    async run(ctx) {
      if (!ctx.adapter.capture.admit) return "needs capture.admit";
      const { quantityLedger } = ctx.adapter;
      check(quantityLedger, "Expected quantity ledger storage");
      const content = "Tea cost 6 USD.";
      const f = captureService(ctx, { quantityLedger: { enabled: true } },
        async () => ({ items: [extract(content)], quantities: [tea] }));
      const id = (await f.capture("purchase", "purchase", [message("receipt", content)]))?.memories[0]?.id;
      check(id, "Expected a captured memory");
      const rows = () => f.read(tx => quantityLedger.listForMemory(tx, f.scope, id));
      equal((await rows()).length, 1, "Expected a row before forget");
      equal((await f.service.forget(f.scope, id, forgetSource)).status, "forgotten", "Expected to forget the source");
      equal(await rows(), [], "Forget must drop the captured quantity row");
    },
  },
];
