import type { CallOptions, MemoryKind, ModelGate, ModelPort, OwnerId, Revision } from '../ports/index.d.ts';
import type { ClassificationCatalogItem } from './catalog.mjs';
import type { PlacementProposal } from './proposal.mjs';

export interface ClassificationSnapshot {
  memories: Array<{ id: string; revision: Revision; kind: MemoryKind; content: string }>;
  indexRevision: Revision;
}

export interface ClassificationCatalog {
  map: ClassificationCatalogItem[];
  mapExhausted: boolean;
}

export interface ClassifyPlacementOptions {
  model?: ModelPort | null;
  snapshot: ClassificationSnapshot;
  catalog: ClassificationCatalog;
  validateFresh(): Promise<void>;
  deadline?: { check(): void; expired(): boolean; remainingMs(): number };
  gate?: ModelGate;
  owner?: OwnerId;
  signal?: CallOptions['signal'];
  onDiagnostic?: CallOptions['onDiagnostic'];
}

export interface ClassifyPlacementResult {
  proposal: PlacementProposal;
  basedOn: {
    memoryRevisions: Array<{ memoryId: string; revision: Revision }>;
    indexRevision: Revision;
    mapExhausted: boolean;
  };
  classificationTruncated?: { memoriesShortened: number; catalogItemsOmitted: number };
}

export function classifyPlacement(options: ClassifyPlacementOptions): Promise<ClassifyPlacementResult>;
