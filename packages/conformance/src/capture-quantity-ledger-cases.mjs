import { CoreError } from "@cairn-ink/core";
import { captureService, client, extract, firstDay, message, nextDay, plan, tea } from "./capture-documents-support.mjs";
import { check, equal } from "./support.mjs";

/** @type {readonly import("./index.d.mts").ConformanceCase[]} */
export const CAPTURE_QUANTITY_LEDGER_CASES = [{
  id: "CAPTURE-LEDGER-1", title: "capture reconciles a replay and a new receipt under the current memory hash",
  needs: ["quantityLedger"],
  async run(ctx) {
    if (!ctx.adapter.capture.admit) return "needs capture.admit";
    const { quantityLedger, memories } = ctx.adapter;
    check(quantityLedger, "Expected quantity ledger storage");
    const content = "Tea cost 6 USD.";
    const first = message("purchase", content);
    const second = message("next-purchase", "Another tea cost 6 USD.", nextDay);
    const f = captureService(ctx, { quantityLedger: { enabled: true } }, async (_stage, request) => {
      check(request.schema && "quantities" in Reflect.get(request.schema, "properties"), "Expected quantity schema");
      return { items: [extract(content)], quantities: [tea] };
    });
    const id = (await f.capture("first", "first", [first]))?.memories[0]?.id;
    check(id, "Expected a captured memory");
    const rows = () => f.read(tx => quantityLedger.listForMemory(tx, f.scope, id));
    await f.capture("first", "replayed-receipt", [first]);
    equal((await rows()).length, 1, "Re-citing one receipt keeps one row");
    await f.capture("later", "second", [second]);
    const saved = await rows();
    const memory = await f.read(tx => memories.get(tx, f.scope, id));
    check(memory, "Expected the current memory");
    equal(saved.map(({ date, value, textHash }) => [date, value, textHash]).sort(),
      [[firstDay, 6, memory.textHash], [nextDay, 6, memory.textHash]], "New receipt adds one current-hash row");
    equal(new Set(saved.map(({ receiptId }) => receiptId)).size, 2, "Each row uses its own receipt ID");
  },
}, {
  id: "CAPTURE-LEDGER-2", title: "a write failure rolls back the memory, card and ledger together",
  needs: ["quantityLedger", "documentCards"],
  async run(ctx) {
    if (!ctx.adapter.capture.admit) return "needs capture.admit";
    const { quantityLedger, documentCards, memories } = ctx.adapter;
    check(quantityLedger && documentCards, "Expected both stores");
    let inserts = 0;
    const fixture = { ...ctx, adapter: { ...ctx.adapter, quantityLedger: { ...quantityLedger,
      /** @type {typeof quantityLedger.put} */
      async put(...args) {
        inserts += (await quantityLedger.put(...args)).inserted;
        throw new CoreError("internal_error");
      },
    } } };
    const f = captureService(fixture, { documentCards: { enabled: true }, quantityLedger: { enabled: true } },
      async () => ({ items: [extract("Tea cost 6 USD.", [1])], quantities: [tea] }));
    const event = { client, sessionId: "purchase", eventId: "purchase" };
    equal((await f.service.enqueueCapture(f.scope, { ...event, messages: [plan, message("tea", "Tea cost 6 USD.")] })).status,
      "accepted", "Capture admission");
    equal((await f.service.runCapture(f.scope, event)).status, "failed", "Ledger failure aborts finish");
    equal(inserts, 1, "The failure followed the attempted ledger insertion");
    await f.read(async tx => {
      equal((await memories.exportPage(tx, f.scope, { limit: 10, cursor: null })).items, [], "Memory rolled back");
      equal(await documentCards.list(tx, f.scope), [], "Card rolled back");
      equal(await quantityLedger.list(tx, f.scope, { fromMs: firstDay, toMs: nextDay }), [], "Ledger rolled back");
    });
  },
}];
