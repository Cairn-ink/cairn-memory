import type { ClassificationCatalogItem } from './catalog.mjs';

export interface NewPlacementTopic {
  title: string;
  parentL2Ids: string[];
  newL2Title?: string;
}

export interface PlacementItem {
  memoryId: string;
  parentIds: string[];
  newL1?: NewPlacementTopic;
}

export interface PlacementProposal {
  items: PlacementItem[];
}

export function uniqueIds(input: unknown, max: number, min?: number): string[];
export function memoryGuards(input: unknown, ids: readonly string[]): { memoryId: string; revision: number }[];
export function placementTitle(input: unknown): string;
export function placementProposal(input: unknown, requestedIds?: readonly string[], limit?: number): PlacementProposal;
export function checkProposalAgainstCatalog(
  proposal: PlacementProposal, shownMap: readonly ClassificationCatalogItem[], mapExhausted: boolean,
): void;
