import {
  buildDocumentCard,
  rankDocumentCards,
  routeDocumentMessages,
  selectDocumentPiece,
} from "@cairn-ink/core/routing";
import type { DocumentMessage, DocumentSession } from "@cairn-ink/core/routing";

async function selectCard(messages: readonly DocumentMessage[], session: DocumentSession) {
  const decision = routeDocumentMessages(messages);
  const first = decision.chosen[0];
  if (!first) return null;
  const built = await buildDocumentCard(messages[first.position], session);
  if (!built.card) return built.drops;
  const query = "garden";
  const ranked = rankDocumentCards(query, [built.card], {
    queryVector: new Float32Array([1, 0]),
    cardVectors: new Map([[built.card.id, [1, 0]]]),
  });
  return ranked && selectDocumentPiece(ranked.card, query, { maxTokens: 100, countTokens: text => text.length });
}
void selectCard;
