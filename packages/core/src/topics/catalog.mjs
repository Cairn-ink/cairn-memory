import { compareUtf8 } from '../utf8.mjs';

/** @import { CatalogTopic } from './catalog.mjs' */
/** @import { ClassificationCatalogItem } from './catalog.mjs' */
/** @import { Scope, TopicStore, Tx } from '../ports/index.d.ts' */

export const CLASSIFICATION_CATALOG_LIMIT = 100;

/** @param {number} limit */
export function isClassificationCatalogLimit(limit) {
  return Number.isInteger(limit) && limit >= 1 && limit <= 200;
}

/**
 * @param {Pick<TopicStore, 'catalog'>} placement
 * @param {Tx} tx
 * @param {Scope} scope
 * @param {number} limit
 */
export async function readClassificationCatalog(placement, tx, scope, limit) {
  /** @type {ClassificationCatalogItem[]} */
  const map = [];
  // Keep individual store requests within the original page size.
  let page = await placement.catalog(tx, scope, { cursor: null, limit: Math.min(limit, CLASSIFICATION_CATALOG_LIMIT) });
  const { indexRevision } = page;
  while (true) {
    for (const { id, level, title } of page.items) map.push({ type: 'moc', moc: { id, level, title } });
    if (page.exhausted || map.length === limit) break;
    page = await placement.catalog(tx, scope, {
      cursor: page.nextCursor, limit: Math.min(limit - map.length, CLASSIFICATION_CATALOG_LIMIT),
    });
  }
  return { indexRevision, catalogView: { map, mapExhausted: page.exhausted } };
}

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
