import { compareUtf8 } from '../utf8.mjs';

/** @import { CatalogTopic } from './catalog.mjs' */

export const CLASSIFICATION_CATALOG_LIMIT = 100;

/** @param {CatalogTopic} a @param {CatalogTopic} b */
export function compareCatalogTopics(a, b) {
  return compareUtf8(a.level, b.level) || compareUtf8(a.title ?? '', b.title ?? '') || compareUtf8(a.id, b.id);
}

/** @template {CatalogTopic} T @param {readonly T[]} topics */
export function capCatalogTopics(topics) {
  return {
    topics: [...topics].sort(compareCatalogTopics).slice(0, CLASSIFICATION_CATALOG_LIMIT),
    mapExhausted: topics.length <= CLASSIFICATION_CATALOG_LIMIT,
  };
}
