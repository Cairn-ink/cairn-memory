import { legacyRawHash } from "../migrate/raw-privacy.mjs";
import { scopeKey } from "../storage-values.mjs";
import { LegacyRefusal } from "./refusal.mjs";

function refuse() {
  throw new LegacyRefusal("legacy_raw_privacy_unrepresentable");
}

function keys(row) {
  if ((row.scope !== "personal" || row.project_id !== "") &&
      (row.scope !== "project" || !row.project_id || row.project_id.includes("\0"))) refuse();
  return { owner: row.owner_id, namespace: row.scope + "\0" + row.project_id };
}

function integers(...values) {
  if (values.some(value => !Number.isSafeInteger(value))) refuse();
}

function actionResult(row) {
  let result;
  try { result = JSON.parse(row.result); }
  catch { refuse(); }
  const counts = ["revision", "forgottenMemories", "retainedMemories", "removedReceipts", "invalidatedEpisodes", "effectCount"];
  if (!result || Object.keys(result).length !== counts.length + 2 || result.actionId !== row.action_id ||
      typeof result.conversationId !== "string" || !result.conversationId) refuse();
  integers(...counts.map(name => result[name]));
  return result;
}

// Record the absence proof before conversion drops the Raw and episode rows.
// Use the same exact/hashed session aliases as legacy Raw source resolution.
export function legacyReceiptHasRawAncestry(db, key) {
  const scope = "owner_id = $owner AND scope = $scope AND project_id = $project";
  const session = "session_key IN ($session, $hashed)";
  const possible = db.prepare(`
    SELECT 1 FROM raw_receipt_lineage WHERE receipt_id = $id
    UNION ALL SELECT 1 WHERE NOT EXISTS (
      SELECT 1 FROM raw_receipt_origins WHERE receipt_id = $id AND kind = 'independent')
    UNION ALL SELECT 1 FROM episode_memory_links l JOIN json_each(l.receipt_ids) r
      WHERE l.memory_id = $memory AND r.value = $id
    UNION ALL SELECT 1 FROM raw_conversations WHERE ${scope} AND client = $client AND ${session}
    UNION ALL SELECT 1 FROM session_episodes WHERE ${scope} AND client = $client AND ${session}
    UNION ALL SELECT 1 FROM raw_job_sources WHERE ${scope} AND source_client = $client AND ${session}
    LIMIT 1`);
  return (memory, receipt) => Boolean(possible.get({
    id: receipt.id, memory: receipt.memory_id, owner: memory.owner_id, scope: memory.scope,
    project: memory.project_id, client: receipt.client, session: receipt.session_id,
    hashed: "s1:" + legacyRawHash(key, keys(memory), "episode-v1", receipt.client, receipt.session_id),
  }));
}

// All input comes from the attested snapshot. Journals contain only
// coordinates and counts. Body and projection payloads are never copied here.
export function readRawPrivacy(db, inventory) {
  if (!inventory.raw) return null;
  const all = table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  const key = db.prepare("SELECT secret FROM episode_identity WHERE singleton = 1").get().secret;
  const hashKeys = row => {
    if (typeof row.client !== "string" || !row.client || typeof row.session_key !== "string" || !row.session_key) refuse();
    const direct = legacyRawHash(key, keys(row), "episode-v1", row.client, row.session_key);
    if (direct === null) refuse();
    return /^s1:[0-9a-f]{64}$/u.test(row.session_key) ? [direct, row.session_key.slice(3)] : [direct];
  };
  const fences = new Map();
  const fenceCounts = new Map();
  const sourceFences = all("raw_session_fences");
  for (const row of sourceFences) {
    const scoped = scopeKey(keys(row));
    const group = JSON.stringify(scoped);
    fenceCounts.set(group, (fenceCounts.get(group) ?? 0) + 1);
    for (const hash of hashKeys(row)) {
      const fact = [...scoped, hash];
      fences.set(JSON.stringify(fact), fact);
    }
  }
  const rules = new Map();
  const rule = (row, client, kind, selector, body) => {
    const fact = [...scopeKey(keys(row)), client === null ? "" : JSON.stringify(client), kind, selector, JSON.stringify(body)];
    rules.set(JSON.stringify(fact), fact);
  };
  if (inventory.localRawPrivacy) {
    for (const row of all("local_raw_uuid_fences")) rule(row, row.client, "uuid", row.uuid_hash, null);
    // A frozen pending hash job can be completed exactly from its retained
    // coordinates. The legacy delete guard forbids deleting these messages
    // until the required UUID hashes are durable.
    const root = row => JSON.stringify([...scopeKey(keys(row)), row.client, row.session_key]);
    const roots = new Set(sourceFences.filter(row => row.client === "claude-code").map(root));
    for (const row of all("local_raw_uuid_jobs")) if (!roots.has(root(row))) refuse();
    const uuidMessages = db.prepare(`SELECT c.owner_id, c.scope, c.project_id, c.client, c.session_key, m.message_id
      FROM raw_conversations c JOIN raw_messages m ON m.conversation_id = c.id
      JOIN raw_session_fences f USING (owner_id, scope, project_id, client, session_key)
      WHERE c.client = 'claude-code'`).all();
    for (const row of uuidMessages) {
      rule(row, row.client, "uuid", legacyRawHash(key, keys(row), "local-raw-forgotten-uuid-v1", row.client, row.message_id), null);
    }
    for (const row of all("local_raw_hide_windows")) {
      integers(row.start_ms, row.end_ms);
      rule(row, null, "window", "", [row.start_ms, row.end_ms]);
    }
    for (const row of all("local_raw_session_ranges")) {
      if (row.min_ms !== null) integers(row.min_ms, row.max_ms);
      for (const hash of hashKeys(row)) rule(row, row.client, "range", hash, [row.min_ms, row.max_ms, row.unknown_time === 1]);
    }
    const noRange = db.prepare(`SELECT c.id, c.owner_id, c.scope, c.project_id, c.client, c.session_key
      FROM raw_conversations c LEFT JOIN local_raw_session_ranges r USING (owner_id, scope, project_id, client, session_key)
      WHERE r.session_key IS NULL`).all();
    const messageTimes = db.prepare("SELECT occurred_at FROM raw_messages WHERE conversation_id = ?");
    for (const row of noRange) {
      // Old receive-time fallbacks cannot prove event time.
      let min = null;
      let max = null;
      for (const { occurred_at } of messageTimes.iterate(row.id)) {
        const time = Date.parse(occurred_at);
        if (!Number.isSafeInteger(time)) continue;
        min = min === null ? time : Math.min(min, time);
        max = max === null ? time : Math.max(max, time);
      }
      for (const hash of hashKeys(row)) rule(row, row.client, "range", hash, [min, max, true]);
    }
  }
  const exclusions = db.prepare(`SELECT c.owner_id, c.scope, c.project_id, c.client, c.session_key,
      x.message_id, x.start, x.end, x.generation, m.total_units
    FROM raw_source_exclusions x JOIN raw_conversations c ON c.id = x.conversation_id
    LEFT JOIN raw_messages m ON m.conversation_id=x.conversation_id AND m.message_id=x.message_id
    ORDER BY x.conversation_id, x.message_id, x.start, x.end`).all();
  for (const row of exclusions) {
    integers(row.start, row.end, row.generation);
    for (const hash of hashKeys(row)) {
      // A fence proves closure even after physical message removal. Otherwise
      // the retained message must prove exactly which coordinates were denied.
      if (!fences.has(JSON.stringify([...scopeKey(keys(row)), hash])) &&
          (!Number.isSafeInteger(row.total_units) || row.start < 0 || row.end > row.total_units || row.end <= row.start)) refuse();
      rule(row, row.client, "span", hash, [row.message_id, row.start, row.end, row.generation]);
    }
  }
  for (const row of all("raw_closed_jobs")) rule(row, row.client, "event", row.event_id, null);
  const effects = all("raw_deletion_effects");
  const actions = all("raw_deletion_actions");
  const conversations = new Map();
  for (const row of effects) {
    if (row.entity_type !== "conversation") continue;
    if (row.source_type !== "conversation" || row.entity_id !== row.source_id) refuse();
    const group = JSON.stringify(scopeKey(keys(row)));
    const deleted = conversations.get(group) ?? new Set();
    deleted.add(row.source_id);
    conversations.set(group, deleted);
  }
  for (const row of actions) {
    const result = actionResult(row);
    const group = JSON.stringify(scopeKey(keys(row)));
    const bound = effects.filter(effect => JSON.stringify(scopeKey(keys(effect))) === group &&
      effect.source_type === "conversation" && effect.source_id === result.conversationId && effect.action_id === row.action_id);
    if (!bound.some(effect => effect.entity_type === "conversation") || bound.length !== result.effectCount) refuse();
  }
  for (const [group, deleted] of conversations) {
    if (deleted.size > (fenceCounts.get(group) ?? 0)) refuse();
  }
  return { key, fences: [...fences.values()], rules: [...rules.values()], actions, effects };
}
