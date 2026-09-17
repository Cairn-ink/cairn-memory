// Offline design experiment only. This is not an SDK, MCP, or answer-consumer DTO.
const fail = code => { throw Object.assign(new Error(code), { code }); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.length > 0 && value.isWellFormed();
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const identity = namespace => JSON.stringify([namespace.ownerId, namespace.scope, namespace.projectId]);
const metadata = (namespace, receipt) => JSON.stringify([identity(namespace), receipt.client,
  receipt.sessionId, receipt.eventId, receipt.role]);
const sourceKey = (namespace, receipt) => JSON.stringify([metadata(namespace, receipt), receipt.excerpt]);

function check(entry) {
  if (!record(entry) || !record(entry.namespace) || !record(entry.memory)
    || !Array.isArray(entry.receipts) || !entry.receipts.length
    || !nonempty(entry.namespace.ownerId)
    || !['personal', 'project'].includes(entry.namespace.scope)
    || (entry.namespace.scope === 'personal' ? entry.namespace.projectId !== null
      : !nonempty(entry.namespace.projectId))
    || !nonempty(entry.memory.id)
    || !Number.isSafeInteger(entry.memory.revision) || entry.memory.revision < 1
    || !['current', 'historical'].includes(entry.memory.currentness)) fail('invalid_input');
  for (const receipt of entry.receipts) {
    if (!record(receipt) || !nonempty(receipt.id) || !nonempty(receipt.client)
      || !nonempty(receipt.sessionId) || !nonempty(receipt.eventId)
      || !['user', 'assistant'].includes(receipt.role) || !nonempty(receipt.excerpt)) fail('invalid_input');
  }
}

/** Group exact submitted events while retaining every distinct memory/receipt link. */
export function groupSourceEvents(entries) {
  if (!Array.isArray(entries) || Object.keys(entries).length !== entries.length) fail('invalid_input');
  const groups = new Map(), metadataTexts = new Map(), associations = new Map();
  for (const entry of entries) {
    check(entry);
    for (const receipt of entry.receipts) {
      const key = sourceKey(entry.namespace, receipt);
      const meta = metadata(entry.namespace, receipt);
      let group = groups.get(key);
      if (!group) {
        if (groups.size === 6) fail('context_item_too_large');
        group = { namespace: { ownerId: entry.namespace.ownerId, scope: entry.namespace.scope,
          projectId: entry.namespace.projectId }, client: receipt.client,
          sessionId: receipt.sessionId, eventId: receipt.eventId, role: receipt.role,
          excerpt: receipt.excerpt, provenanceCollision: false, associations: [] };
        groups.set(key, group);
      }
      const texts = metadataTexts.get(meta) ?? new Set();
      texts.add(receipt.excerpt);
      metadataTexts.set(meta, texts);
      const association = { memoryId: entry.memory.id, revision: entry.memory.revision,
        currentness: entry.memory.currentness, receiptId: receipt.id };
      const associationKey = JSON.stringify([identity(entry.namespace), association.memoryId,
        association.revision, association.receiptId]);
      const prior = associations.get(associationKey);
      if (prior) fail(prior.key === key && prior.currentness === association.currentness
        ? 'duplicate_association' : 'conflicting_association');
      if (associations.size === 36) fail('context_item_too_large');
      associations.set(associationKey, { key, currentness: association.currentness });
      group.associations.push(association);
    }
  }
  const sources = [...groups.entries()].sort(([a], [b]) => compare(a, b)).map(([, group]) => {
    group.provenanceCollision = metadataTexts.get(metadata(group.namespace, group)).size > 1;
    group.associations.sort((a, b) => compare(
      JSON.stringify([a.memoryId, a.revision, a.currentness, a.receiptId]),
      JSON.stringify([b.memoryId, b.revision, b.currentness, b.receiptId])));
    return group;
  });
  const packet = { version: 'source-event-grouping-experiment-v1',
    sources, counts: { sourceEventGroups: sources.length, associations: associations.size,
      provenanceCollisionGroups: sources.filter(source => source.provenanceCollision).length },
    evidenceTrust: 'submitted-provenance-untrusted' };
  if (Buffer.byteLength(JSON.stringify(packet), 'utf8') > 24_000) fail('context_item_too_large');
  return packet;
}
