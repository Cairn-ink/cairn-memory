import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createRawSearchAuthority } from "../../../../core/raw-search-authority.mjs";
import { rawSessionKeys } from "../../../../core/raw-source-roots.mjs";
import { createRawLineage } from "../raw-lineage.mjs";
import { scopeKey } from "../storage-values.mjs";
import { sessionHasher } from "../suppressions.mjs";
import { LegacyRefusal } from "./refusal.mjs";

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const namespaceOf = row => ({ ownerId: row.owner_id, scope: row.scope, projectId: row.project_id || null });
const scopeOf = row => ({ owner: row.owner_id, namespace: row.scope + "\0" + row.project_id });
const pair = (conversation, message) => JSON.stringify([conversation, message]);
const refuse = () => { throw new LegacyRefusal("legacy_raw_privacy_unrepresentable"); };

// The canonical Raw authority makes the visibility decision; its extra
// read-only handle is pinned to the same cold source as the conversion read.
function visibleParts(db, file) {
  const namespaces = new Map();
  for (const row of db.prepare("SELECT DISTINCT owner_id, scope, project_id FROM raw_conversations").all()) {
    const group = namespaces.get(row.owner_id) ?? [];
    group.push(namespaceOf(row));
    namespaces.set(row.owner_id, group);
  }
  const parts = new Map();
  if (!namespaces.size) return parts;
  file.check();
  const reader = new DatabaseSync(file.path, { readOnly: true });
  try {
    reader.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF");
    for (const [ownerId, readSet] of namespaces) {
      const authority = createRawSearchAuthority({ db: reader, assertFile() {} }, {
        ownerId, readSet,
        // Inventory resolves authority and manifests without invoking either port.
        crypto: { openRaw: refuse }, authority: { authorize: refuse, isCurrent: refuse },
      });
      let after;
      for (;;) {
        const page = authority.inventory(after, 128);
        for (const { key: [conversation, message, index], source, disposition } of page.rows) {
          // Pause is the last canonical check and can be reversed by the host.
          if (!source && disposition !== "paused") continue;
          const id = pair(conversation, message);
          const indexes = parts.get(id) ?? [];
          indexes.push(index);
          parts.set(id, indexes);
        }
        if (page.complete) break;
        after = page.rows.at(-1).key;
      }
    }
    file.check();
    return parts;
  } finally {
    reader.close();
  }
}

function partText(key, row, part) {
  const text = decoder.decode(part.sealed);
  const digest = createHmac("sha256", Buffer.from(key, "hex"))
    .update(JSON.stringify(["raw-part-v1", row.message_id, row.ordinal, row.role, row.occurred_at,
      part.part_index, part.start, row.total_units, row.total_bytes, text])).digest("hex");
  if (text.length !== part.end - part.start || Buffer.byteLength(text) !== part.byte_count ||
      !text || text.includes("\0") || digest !== part.digest) refuse();
  return text;
}

function assemble(key, row, parts, indexes) {
  let end = 0;
  const content = parts.map((part, index) => {
    if (!part.saved || part.part_index !== indexes[index] || part.start !== end) refuse();
    end = part.end;
    return partText(key, row, part);
  }).join("");
  if (end !== row.total_units || Buffer.byteLength(content) !== row.total_bytes) refuse();
  return content;
}

function readFencedAnchors(db, key) {
  const lineage = createRawLineage(key, sessionHasher(key, true));
  const messages = db.prepare(`SELECT c.owner_id, c.scope, c.project_id, c.client, c.session_key, m.*
    FROM raw_conversations c JOIN raw_session_fences f USING (owner_id, scope, project_id, client, session_key)
    JOIN raw_messages m ON m.conversation_id=c.id`);
  const parts = db.prepare("SELECT * FROM raw_parts WHERE conversation_id=? AND message_id=? ORDER BY part_index");
  const anchors = [];
  for (const row of messages.iterate()) {
    const sessionId = row.session_key.replace(/^s1:([0-9a-f]{64})$/, "legacy-raw:$1");
    // Without a complete local payload, a fenced row can attest only its ID.
    const saved = row.assembly_state === "complete" ? parts.all(row.conversation_id, row.message_id) : [];
    const content = saved.length && saved.every(part => part.saved && part.format === "local-plain-v1")
      ? assemble(key, row, saved, saved.map((_, index) => index)) : "";
    anchors.push(...lineage.anchorRows(scopeOf(row), { client: row.client, sessionId },
      [{ id: row.message_id, content }]));
  }
  return anchors;
}

export function readLegacyArchive(db, file, privacy, receipts) {
  const rows = [], anchors = [], retained = new Set(), spans = new Map(), maps = [], reservations = [];
  const counts = { rawConversations: 0, rawMessages: 0, rawParts: 0, rawSourceMaps: 0, rawReceiptLineage: 0, rawReceiptOrigins: 0 };
  if (!privacy) return { rows, anchors, spans, maps, reservations, counts, fencedAnchors: [] };
  const selections = visibleParts(db, file);
  const { key } = privacy;
  const fencedAnchors = readFencedAnchors(db, key);
  const reserved = db.prepare(`SELECT c.id, c.owner_id, c.scope, c.project_id, c.client, c.session_key, m.message_id
    FROM raw_messages m JOIN raw_conversations c ON c.id=m.conversation_id WHERE m.assembly_state <> 'pending'`);
  for (const row of reserved.iterate()) {
    if (selections.has(pair(row.id, row.message_id))) continue;
    const aliases = rawSessionKeys(namespaceOf(row), row.client, row.session_key, key);
    const hash = (/^s1:[0-9a-f]{64}$/.test(row.session_key) ? aliases[0] : aliases[1]).slice(3);
    reservations.push([...scopeKey(scopeOf(row)), JSON.stringify(row.client), "reservation", hash, JSON.stringify(row.message_id)]);
  }
  if (!selections.size) return { rows, anchors, spans, maps, reservations, counts, fencedAnchors };
  const find = db.prepare(`SELECT c.*, m.* FROM raw_conversations c
    JOIN raw_messages m ON m.conversation_id = c.id WHERE c.id = ? AND m.message_id = ?`);
  const parts = db.prepare("SELECT * FROM raw_parts WHERE conversation_id=? AND message_id=? ORDER BY part_index");
  const lineage = db.prepare(`SELECT l.*, o.kind, r.session_id, r.event_id, r.client, r.role
    FROM raw_receipt_lineage l JOIN receipts r ON r.id=l.receipt_id
    LEFT JOIN raw_receipt_origins o ON o.receipt_id=l.receipt_id
    WHERE l.conversation_id=? AND l.message_id=? ORDER BY l.receipt_id,l.start,l.end`);
  const sourceMaps = db.prepare(`SELECT source_key, start, end, precision FROM raw_source_maps
    WHERE conversation_id=? AND message_id=? ORDER BY source_key,start,end`);
  const conversations = new Map(), origins = new Set();
  const consumed = new Set(receipts.map(row => row.id));
  const sessionAliases = new Map();
  for (const [address] of selections) {
    const [conversation, message] = JSON.parse(address);
    const row = find.get(conversation, message);
    const ids = sessionAliases.get(conversation) ?? new Set();
    for (const link of lineage.iterate(conversation, message)) {
      if (consumed.has(link.receipt_id) && link.kind === "derived" &&
          rawSessionKeys(namespaceOf(row), row.client, link.session_id, key).includes(row.session_key)) ids.add(link.session_id);
    }
    sessionAliases.set(conversation, ids);
  }
  for (const [address, indexes] of selections) {
    const [conversation, message] = JSON.parse(address);
    const row = find.get(conversation, message);
    const partsOfMessage = parts.all(conversation, message);
    const aliases = sessionAliases.get(conversation);
    if (aliases.size > 1 || row.assembly_state !== "complete" || indexes.length !== partsOfMessage.length) refuse();
    const sessionId = aliases.values().next().value ?? row.session_key.replace(/^s1:([0-9a-f]{64})$/, "legacy-raw:$1");
    const scope = scopeOf(row);
    const group = JSON.stringify([...scopeKey(scope), row.client, sessionId]);
    if (conversations.has(group) && conversations.get(group) !== conversation) refuse();
    conversations.set(group, conversation);
    const content = assemble(key, row, partsOfMessage, indexes);
    const occurredAtMs = row.occurred_at === null ? null : Date.parse(row.occurred_at);
    if (occurredAtMs !== null && !Number.isSafeInteger(occurredAtMs)) refuse();
    rows.push([...scopeKey(scope), JSON.stringify(row.client), JSON.stringify(sessionId),
      JSON.stringify(message), row.role, JSON.stringify(content), occurredAtMs]);
    anchors.push({ scope, client: row.client, sessionId, message: { id: message, role: row.role, content, occurredAtMs } });
    retained.add(conversation);
    counts.rawParts += indexes.length;
    for (const link of lineage.iterate(conversation, message)) {
      if (!consumed.has(link.receipt_id) || link.kind !== "derived" ||
          link.client !== row.client || link.event_id !== message || link.role !== row.role ||
          link.start < 0 || link.end > content.length || link.end <= link.start) refuse();
      const entries = spans.get(link.receipt_id) ?? [];
      entries.push({ sessionId, start: link.start, end: link.end, precision: link.precision });
      spans.set(link.receipt_id, entries);
      origins.add(link.receipt_id);
      counts.rawReceiptLineage++;
    }
    for (const map of sourceMaps.iterate(conversation, message)) {
      maps.push([...scopeKey(scope), JSON.stringify(row.client), JSON.stringify(sessionId), JSON.stringify(message),
        map.source_key, map.start, map.end, map.precision]);
      counts.rawSourceMaps++;
    }
  }
  counts.rawConversations = retained.size;
  counts.rawMessages = rows.length;
  counts.rawReceiptOrigins = origins.size;
  return { rows, anchors, spans, maps, reservations, counts, fencedAnchors };
}
