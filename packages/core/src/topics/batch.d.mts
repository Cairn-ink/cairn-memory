import type { ErrorCode } from '../errors.mjs';
import type { MemoryStore, Scope, TopicStore, UnitOfWork } from '../ports/index.d.ts';
import type { ClassificationCatalog, ClassificationSnapshot, ClassifyPlacementOptions } from './classify.mjs';
import type { PlacementProposal } from './proposal.mjs';

type BatchSnapshot = Pick<ClassificationSnapshot, 'memories'>;

export interface PlacePendingBatchOptions {
  uow: UnitOfWork;
  scope: Scope;
  placement: TopicStore;
  memories: Pick<MemoryStore, 'get' | 'readRevision'>;
  classify(snapshot: BatchSnapshot, catalogView: ClassificationCatalog, options: {
    validateFresh(): Promise<void>;
  }): Promise<PlacementProposal>;
}

export type PlacePendingOptions = Omit<PlacePendingBatchOptions, 'classify'> &
  Pick<ClassifyPlacementOptions, 'model' | 'deadline' | 'signal' | 'onDiagnostic'> &
  Required<Pick<ClassifyPlacementOptions, 'gate'>>;

export type PlacePendingBatchResult =
  | { status: 'idle' }
  | ({ status: 'applied' } & Awaited<ReturnType<TopicStore['applyPlacement']>>)
  | { status: 'failed'; error: { code: ErrorCode; retryable: boolean } };

export function placePendingBatch(options: PlacePendingBatchOptions): Promise<PlacePendingBatchResult>;
export function placePending(options: PlacePendingOptions): Promise<PlacePendingBatchResult>;
