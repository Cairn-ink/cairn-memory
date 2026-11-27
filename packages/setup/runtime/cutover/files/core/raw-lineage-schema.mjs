export const RAW_LINEAGE_SCHEMA_VERSION = 26;

export function installRawLineage(db) {
  db.exec(`
    CREATE TABLE raw_source_maps (
      conversation_id TEXT NOT NULL REFERENCES raw_conversations(id), message_id TEXT NOT NULL,
      source_key TEXT NOT NULL, start INTEGER NOT NULL CHECK(start>=0), end INTEGER NOT NULL CHECK(end>start),
      precision TEXT NOT NULL CHECK(precision IN ('exact','whole-message')),
      PRIMARY KEY(conversation_id,message_id,source_key,start,end)
    ) STRICT;
    CREATE TABLE raw_receipt_lineage (
      receipt_id TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES raw_conversations(id), message_id TEXT NOT NULL,
      start INTEGER NOT NULL CHECK(start>=0), end INTEGER NOT NULL CHECK(end>start),
      precision TEXT NOT NULL CHECK(precision IN ('exact','whole-message')),
      PRIMARY KEY(receipt_id,conversation_id,message_id,start,end)
    ) STRICT;
    CREATE TABLE raw_receipt_origins (
      receipt_id TEXT PRIMARY KEY REFERENCES receipts(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('independent','derived','unknown'))
    ) STRICT;
    CREATE TABLE raw_exclusion_clocks (
      owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      generation INTEGER NOT NULL CHECK(generation>0), PRIMARY KEY(owner_id,scope,project_id)
    ) STRICT;
    CREATE TABLE raw_source_exclusions (
      conversation_id TEXT NOT NULL REFERENCES raw_conversations(id), message_id TEXT NOT NULL,
      start INTEGER NOT NULL CHECK(start>=0), end INTEGER NOT NULL CHECK(end>start),
      generation INTEGER NOT NULL CHECK(generation>0), PRIMARY KEY(conversation_id,message_id,start,end)
    ) STRICT;
  `);
}
