import type { ErrorCode } from '../errors.mjs';
import type {
  CardPlacementProposal, DocumentCardStore, Scope, StoredDocumentCardRecord, TopicCardGuard, TopicStore, UnitOfWork, VisibilityFence,
} from '../ports/index.d.ts';
import type { ClassificationCatalog, ClassifyPlacementOptions } from './classify.mjs';

export interface PlacePendingCardsBatchOptions {
  uow: UnitOfWork;
  scope: Scope;
  placement: TopicStore;
  documentCards: Pick<DocumentCardStore<StoredDocumentCardRecord>, 'get' | 'visibilityInputs'>;
  fence: VisibilityFence;
  /** Maximum catalog topics before model packing. Integer from 1 to 200, default 100. */
  catalogLimit?: number;
  classify(snapshot: { cards: Array<TopicCardGuard & { content: string }> }, catalog: ClassificationCatalog,
    options: { validateFresh(): Promise<void> }): Promise<CardPlacementProposal>;
}

export type PlacePendingCardsOptions = Omit<PlacePendingCardsBatchOptions, 'classify'> &
  Pick<ClassifyPlacementOptions, 'model' | 'deadline' | 'signal' | 'onDiagnostic'> &
  Required<Pick<ClassifyPlacementOptions, 'gate'>>;

export type PlacePendingCardsResult =
  | { status: 'idle' }
  | ({ status: 'applied' } & Awaited<ReturnType<TopicStore['applyCardPlacement']>>)
  | { status: 'failed'; error: { code: ErrorCode; retryable: boolean } };

export function placePendingCardsBatch(options: PlacePendingCardsBatchOptions): Promise<PlacePendingCardsResult>;
export function placePendingCards(options: PlacePendingCardsOptions): Promise<PlacePendingCardsResult>;
