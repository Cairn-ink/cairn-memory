import { buildDocumentCard } from "@cairn-ink/core/routing";
import { captureService, client, extract, plan } from "./capture-documents-support.mjs";
import { check, equal } from "./support.mjs";

/** @type {readonly import("./index.d.mts").ConformanceCase[]} */
export const CAPTURE_DOCUMENT_CARD_CASES = [{
  id: "CAPTURE-CARD-1", title: "capture writes a canonical card and unions links on recapture",
  needs: ["documentCards", "rawArchive"], needsOff: ["nearDuplicate"],
  async run(ctx) {
    if (!ctx.adapter.capture.admit) return "needs capture.admit";
    const canonicalSessionKey = ctx.harness.hashSessionKey?.(client, "plan") ?? (ctx.sessionRefs === "plain" ? "plan" : null);
    if (!canonicalSessionKey) return "needs a canonical session key";
    const { documentCards, fence } = ctx.adapter;
    check(documentCards, "Expected document card storage");
    let content = "The hatch opens at 8.";
    const f = captureService(ctx, { documentCards: { enabled: true } }, async () => ({ items: [extract(content)] }));
    const first = await f.capture("plan", "first", [plan]);
    content = "Oil the hinges every week.";
    const second = await f.capture("plan", "second", [plan]);
    check(first && second, "Expected both finish results");
    const card = (await f.read(tx => documentCards.list(tx, f.scope)))[0];
    const expected = await buildDocumentCard(plan, { scope: f.scope, client, canonicalSessionKey });
    equal(card?.id, expected.card?.id, "Canonical document ID");
    equal(card.origin, "router", "Document origin");
    equal(card.sourceMemories.map(({ id }) => id).sort(),
      [...first.memories, ...second.memories].map(({ id }) => id).sort(), "Both captures contribute links");
    const ref = { type: /** @type {const} */ ("card"), id: card.id, namespace: f.scope.namespace };
    const shown = await f.read(tx => fence.assertVisible(tx, { owner: ctx.owner, namespaces: [f.scope.namespace] }, [ref]));
    equal(shown, [ref], "The card passes Raw and memory visibility checks");
  },
}];
