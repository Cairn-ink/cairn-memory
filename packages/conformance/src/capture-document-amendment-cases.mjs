import { captureService, correction, extract, plan, update } from "./capture-documents-support.mjs";
import { check, equal } from "./support.mjs";

/** @param {import("./index.d.mts").CaseContext} ctx @param {boolean} forget */
async function amendmentCapture(ctx, forget) {
  if (!ctx.adapter.capture.admit) return "needs capture.admit";
  if (ctx.sessionRefs !== "plain") return "needs plain session references";
  const { documentCards } = ctx.adapter;
  check(documentCards, "Expected document card storage");
  let cardId = "";
  let earlierMemory = "";
  let detectCalls = 0;
  let verifyCalls = 0;
  let amendCalls = 0;
  const fixture = { ...ctx, adapter: { ...ctx.adapter, documentCards: { ...documentCards,
    /** @type {typeof documentCards.amend} */
    async amend(...args) {
      amendCalls++;
      return documentCards.amend(...args);
    },
  } } };
  const f = captureService(fixture, { documentCards: { enabled: true, amendments: true } },
    async () => ({ items: cardId ? [] : [extract("The hatch opens at 8.")] }), {
      async detectChanges() {
        detectCalls++;
        equal((await f.service.captureStatus(f.scope, "correction")).status, "done", "Detection follows commit");
        return { changes: [{ card_id: cardId, quote: update, new_value: update }] };
      },
      async verifyChange() {
        verifyCalls++;
        if (forget) {
          const result = await f.service.forget(f.scope, earlierMemory, { kind: "web", client: null, sessionId: null });
          equal(result.status, "forgotten", "Forget must commit before verification returns");
        }
        return { applies: true, line: update };
      },
    });
  const first = await f.capture("plan", "plan", [plan]);
  earlierMemory = first?.memories[0]?.id ?? "";
  check(earlierMemory, "Expected a memory for the earlier card");
  cardId = (await f.read(tx => documentCards.list(tx, f.scope)))[0]?.id;
  check(cardId, "Expected a card to amend");
  await f.capture("correction", "correction", [correction]);
  equal([detectCalls, verifyCalls, amendCalls], [1, 1, forget ? 0 : 1], "The write requires a fresh card");
  const card = await f.read(tx => documentCards.get(tx, f.scope, cardId));
  if (forget) equal(card, null, "The forgotten card stays hidden after a verified correction");
  else equal(card?.amendments.map(({ sentence, quote, date }) => [sentence, quote, date]),
    [[update, update, "2025-01-02"]], "Verified correction on the earlier card");
}

/** @type {readonly import("./index.d.mts").ConformanceCase[]} */
export const CAPTURE_DOCUMENT_AMENDMENT_CASES = [
  { id: "CAPTURE-AMEND-1", title: "capture verifies and writes an amendment after commit",
    needs: ["documentCards"], run: ctx => amendmentCapture(ctx, false) },
  { id: "CAPTURE-AMEND-2", title: "forget between detection and amendment prevents the write",
    needs: ["documentCards"], run: ctx => amendmentCapture(ctx, true) },
];
