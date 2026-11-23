export interface CatalogTopic {
  id: string;
  level: 'L1' | 'L2';
  title?: string | null;
}

export interface ClassificationCatalogItem {
  type: 'moc';
  moc: CatalogTopic;
}

export const CLASSIFICATION_CATALOG_LIMIT: 100;
export function compareCatalogTopics(a: CatalogTopic, b: CatalogTopic): number;
export function capCatalogTopics<T extends CatalogTopic>(topics: readonly T[]): { topics: T[]; mapExhausted: boolean };
