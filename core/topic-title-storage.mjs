import { cachedContentLayout } from './content-safety-schema.mjs';
import { requireSuppressionTransaction } from './content-suppression-storage.mjs';

export function retireTopicTitleSourceInside(db, kind, id) {
  requireSuppressionTransaction(db);
  const card = kind === 'card';
  if (card && !db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='card_moc_title_sources'").get()) return [];
  const table = card ? 'card_mocs' : 'mocs';
  const sources = card ? 'card_moc_title_sources' : 'moc_title_sources';
  const column = card ? 'card_id' : 'memory_id';
  const topics = db.prepare(`DELETE FROM ${sources} WHERE ${column}=? RETURNING moc_id`).all(id);
  if (!topics.length) return [];

  // Empty titles require fresh placement evidence. Preserve the legacy sort
  // key and title reservation. Safety layouts can also erase the old key.
  const key = cachedContentLayout(db)?.suppressionRevision ? ", canonical_title=' ' || id" : '';
  const invalidate = db.prepare(`UPDATE ${table} SET title=''${key} WHERE id=? AND title<>''`);
  for (const { moc_id } of topics) invalidate.run(moc_id);
  return topics.map(row => row.moc_id);
}
