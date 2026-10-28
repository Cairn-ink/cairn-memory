// Independent, read-only canonical fixture inventory. This never reads a
// ranking/vector cache and does not mutate, migrate, or repair engine storage.
export async function verifyCanonical(path, cell, fixture, identities) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (db.prepare('PRAGMA user_version').get().user_version !== cell.schema) throw Error('physical_schema_mismatch');
    const memories = db.prepare('SELECT id,owner_id,scope,project_id,content,revision FROM memories').all();
    const cards = cell.schema >= 23 ? db.prepare('SELECT id,owner_id,scope,project_id,title,body,revision,body_revision FROM private_cards').all() : [];
    const expected = fixture.documents.filter(d => d.minWorld <= cell.world && cell.types.includes(d.type));
    if (memories.length !== cell.world || memories.length + cards.length !== expected.length || identities.length !== expected.length) throw Error('canonical_fixture_population_mismatch');
    const memoryMap = new Map(memories.map(row => [row.id, row])), cardMap = new Map(cards.map(row => [row.id, row]));
    const documents = new Map(expected.map(d => [d.id, d]));
    for (const item of identities) {
      const d = documents.get(item.fixtureId), ref = item.ref;
      const row = ref.type === 'memory' ? memoryMap.get(ref.memoryId) : cardMap.get(ref.cardId);
      const text = ref.type === 'memory' ? row?.content : `${row?.title}\n${row?.body}`;
      if (!d || !row || text !== d.text || row.owner_id !== d.namespace.ownerId || row.scope !== d.namespace.scope
        || (row.project_id || null) !== d.namespace.projectId || row.revision !== d.revision
        || ref.type === 'card' && row.body_revision !== d.bodyRevision) throw Error('canonical_fixture_bytes_mismatch');
    }
    return { schema: cell.schema, memories: memories.length, cards: cards.length, verified: true };
  } finally { db.close(); }
}
