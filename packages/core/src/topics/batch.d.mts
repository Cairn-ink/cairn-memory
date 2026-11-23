import type { ErrorCode } from '../errors.mjs';
import type { MemoryKind, MemoryStore, Revision, Scope, TopicStore, UnitOfWork } from '../ports/index.d.ts';
import type { ClassificationCatalogItem } from './catalog.mjs';
import type { PlacementProposal } from './proposal.mjs';

interface BatchSnapshot {
  memories: Array<{ id: string; revision: Revision; kind: MemoryKind; content: string }>;
}

interface CatalogView {
  map: ClassificationCatalogItem[];
  mapExhausted: boolean;
}

export interface PlacePendingBatchOptions {
  uow: UnitOfWork;
  scope: Scope;
  placement: TopicStore;
  memories: Pick<MemoryStore, 'get' | 'readRevision'>;
  classify(snapshot: BatchSnapshot, catalogView: CatalogView, options: {
    validateFresh(): Promise<void>;
  }): Promise<PlacementProposal>;
}

export type PlacePendingBatchResult =
  | { status: 'idle' }
  | ({ status: 'applied' } & Awaited<ReturnType<TopicStore['applyPlacement']>>)
  | { status: 'failed'; error: { code: ErrorCode; retryable: boolean } };

export function placePendingBatch(options: PlacePendingBatchOptions): Promise<PlacePendingBatchResult>;
