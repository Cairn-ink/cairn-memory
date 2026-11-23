import type {
  DetectChangesResponse, DocumentCardAmendment, DocumentCardStore, ModelPort, Scope, Tx, VerifyChangeResponse,
} from "@cairn-ink/core/ports";
import {
  buildDetectRequest, buildVerifyRequest, detectCardAmendments, renderCardAmendments,
} from "@cairn-ink/core/routing";
import type { AmendmentConversation, AmendmentDetectCard } from "@cairn-ink/core/routing";

declare const tx: Tx;
declare const scope: Scope;
declare const model: ModelPort;
declare const store: DocumentCardStore;
declare const capture: AmendmentConversation;
declare const cards: readonly AmendmentDetectCard[];

const { request, listedCards } = buildDetectRequest({
  conversation: capture, cards, countTokens: text => model.countTokens(text),
});
if (request && model.detectChanges && model.verifyChange && listedCards[0]) {
  const detectCap: 900 = request.maxOutputTokens;
  const detected: DetectChangesResponse = await model.detectChanges(request);
  const [change] = detected.changes;
  if (change) {
    const verifyRequest = buildVerifyRequest({
      card: listedCards[0], sessionDate: capture.date, quote: change.quote, newValue: change.new_value,
    });
    const verifyCap: 400 = verifyRequest.maxOutputTokens;
    const result: VerifyChangeResponse = await model.verifyChange(verifyRequest, {});
    const applies: boolean = result.applies;
    // @ts-expect-error the verify call takes its own request shape
    await model.verifyChange(request, {});
  }
}

const { amendments } = await detectCardAmendments({ model, capture, cards });
for (const { cardId, amendment } of amendments) {
  const { status } = await store.amend(tx, scope, cardId, amendment);
  const outcome: "inserted" | "unchanged" | "hidden_card" = status;
  if (outcome === "inserted") await store.hideAmendment(tx, scope, cardId, amendment.amendmentId, "forget");
  // @ts-expect-error the source includes a plain message ID
  await store.amend(tx, scope, cardId, { ...amendment, sourceMessage: { client: "client", sessionId: "session" } });
}

const card = await store.get(tx, scope, "card");
if (card) {
  const visible: readonly DocumentCardAmendment[] = card.amendments;
  const { amendments: _amendments, ...cardWrite } = card;
  await store.put(tx, scope, cardWrite);
  const shown = renderCardAmendments({ amendments: visible, countTokens: text => model.countTokens(text), maxTokens: 100 });
  const messageId: string | undefined = shown.amendments[0]?.sourceMessage.messageId;
}
