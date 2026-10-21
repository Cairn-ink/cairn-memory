import { transaction } from './database.mjs';
import { rawClient, rawNamespace } from './raw-input.mjs';
import { fail, identifier } from './validation.mjs';

/** Reservation closure needs neither a crypto port nor host capture policy. */
export function createRawControlStorage(db) {
  function closePendingInside({ ownerId, client, namespace, sessionKey, reason }) {
    const ns = namespace === undefined ? null : rawNamespace(namespace);
    identifier(ownerId); if (client !== undefined) rawClient(client);
    if (!['tool_off','capture_barrier'].includes(reason) || ns && ns.ownerId !== ownerId) fail('invalid_input');
    const rows = db.prepare(`SELECT m.*,c.owner_id,c.scope,c.project_id FROM raw_messages m JOIN raw_conversations c ON c.id=m.conversation_id
      WHERE c.owner_id=? AND m.assembly_state='pending'${client === undefined ? '' : ' AND c.client=?'}${ns ? ' AND c.scope=? AND c.project_id=?' : ''}${sessionKey === undefined ? '' : ' AND c.session_key=?'}`)
      .all(ownerId, ...(client === undefined ? [] : [client]), ...(ns ? [ns.scope,ns.projectId] : []), ...(sessionKey === undefined ? [] : [sessionKey]));
    const touched = new Map(); let released = 0;
    for (const row of rows) {
      released += row.reserved_bytes;
      db.prepare("UPDATE raw_messages SET assembly_state='closed',reason=?,reserved_bytes=0 WHERE conversation_id=? AND message_id=?")
        .run(reason, row.conversation_id, row.message_id);
      touched.set(row.conversation_id, { ownerId, scope: row.scope, projectId: row.project_id });
    }
    if (released) db.prepare('UPDATE raw_owner_usage SET reserved_bytes=reserved_bytes-?,revision=revision+1 WHERE owner_id=?').run(released, ownerId);
    for (const [id, boundary] of touched) {
      db.prepare('UPDATE raw_conversations SET revision=revision+1,last_received_at=? WHERE id=?').run(new Date().toISOString(), id);
      db.prepare(`INSERT INTO namespace_epochs(owner_id,scope,project_id,epoch) VALUES(?,?,?,2)
        ON CONFLICT(owner_id,scope,project_id) DO UPDATE SET epoch=epoch+1`).run(boundary.ownerId, boundary.scope, boundary.projectId);
    }
    return { closedMessages: rows.length, releasedBytes: released };
  }
  return { closePendingInside, closePending: input => db.isTransaction ? closePendingInside(input) : transaction(db, () => closePendingInside(input)) };
}
