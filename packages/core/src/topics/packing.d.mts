import type { ModelPort } from '../ports/model.d.ts';
import type { ClassificationCatalogItem } from './catalog.mjs';

export interface ClassificationMemory {
  id: string;
  content: string;
  contentShortened?: boolean;
}

export interface ClassificationInput {
  memories: readonly ClassificationMemory[];
  map: readonly ClassificationCatalogItem[];
  mapExhausted: boolean;
}

export interface ClassificationPacking {
  input: ClassificationInput;
  memoriesShortened: number;
  catalogItemsOmitted: number;
  overflow: boolean;
}

export function packClassification(
  model: Pick<ModelPort, 'countTokens'>, system: string, input: ClassificationInput, deadline?: { check(): void },
): ClassificationPacking;
