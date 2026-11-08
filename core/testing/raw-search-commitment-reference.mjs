// Independent unpaged projections for commitment row-set comparisons.
export function commitmentReference(db,readSet,bounds) {
  const boundary=ns=>[ns.ownerId,ns.scope,ns.projectId??''];
  const where='owner_id=? AND scope=? AND project_id=?';
  const read=work=>work();
  const scan=(sql,args)=>{
    const statement=db.prepare(sql),columns=statement.columns().map(c=>c.name);
    return {columns,rows:statement.all(...args).map(row=>columns.map(name=>row[name]))};
  };
    const rows=readSet.map(ns=>{
      const args=boundary(ns), horizon=`c.rowid<=${bounds.conversations} AND m.rowid<=${bounds.messages}`;
      // A proof keeps its original source population. Appending another message
      // cannot change that population's inputs; edits and inbound edges can.
      const related=`WITH roots AS MATERIALIZED (
        SELECT c.id AS conversation_id,m.message_id,c.owner_id,c.scope,c.project_id,c.client
        FROM raw_conversations c JOIN raw_messages m ON m.conversation_id=c.id
        WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND ${horizon}),
      bound_memories AS MATERIALIZED (
        SELECT r.memory_id FROM raw_receipt_lineage l CROSS JOIN receipts r ON r.id=l.receipt_id
        WHERE (l.conversation_id,l.message_id) IN (SELECT conversation_id,message_id FROM roots)
        UNION SELECT r.memory_id FROM receipts r JOIN memories m ON m.id=r.memory_id
        WHERE EXISTS(SELECT 1 FROM roots s WHERE s.owner_id=m.owner_id AND s.scope=m.scope AND s.project_id=m.project_id
          AND s.client=r.client AND s.message_id=r.event_id)),
      bound_receipts AS MATERIALIZED (
        SELECT r.id FROM bound_memories b CROSS JOIN receipts r ON r.memory_id=b.memory_id),
      edges AS MATERIALIZED (
        SELECT l.* FROM raw_receipt_lineage l WHERE l.receipt_id IN (SELECT id FROM bound_receipts)
        OR (l.conversation_id,l.message_id) IN (SELECT conversation_id,message_id FROM roots)),
      bound_scopes AS MATERIALIZED (
        SELECT owner_id,scope,project_id FROM roots
        UNION SELECT c.owner_id,c.scope,c.project_id FROM edges l JOIN raw_conversations c ON c.id=l.conversation_id
        UNION SELECT m.owner_id,m.scope,m.project_id FROM bound_memories b JOIN memories m ON m.id=b.memory_id)
      `;
      const conversations=scan(`SELECT id,owner_id,scope,project_id,client,session_key FROM raw_conversations WHERE ${where}
        AND rowid<=${bounds.conversations} ORDER BY id LIMIT 50001`,args);
      const parts=scan(`SELECT p.conversation_id,p.message_id,p.part_index,p.start,p.end,p.saved,p.digest,
        p.byte_count,p.event_id,p.reason,p.format,p.key_version,length(p.sealed) AS bytes,raw_search_sealed_digest(p.sealed) AS fingerprint,
        m.role,m.ordinal,m.occurred_at,m.total_units,m.total_bytes
        FROM raw_parts p CROSS JOIN raw_conversations c ON c.id=p.conversation_id
        JOIN raw_messages m ON m.conversation_id=p.conversation_id AND m.message_id=p.message_id
        WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND ${horizon}
        ORDER BY p.conversation_id,p.message_id,p.part_index LIMIT 50001`,args);
      const exclusions=scan(related+`SELECT x.* FROM raw_source_exclusions x WHERE (x.conversation_id,x.message_id) IN (
        SELECT conversation_id,message_id FROM roots UNION SELECT conversation_id,message_id FROM edges)
        ORDER BY x.conversation_id,x.message_id,x.start,x.end LIMIT 50001`,args);
      const fences=scan(related+`SELECT f.* FROM raw_session_fences f
        WHERE (f.owner_id,f.scope,f.project_id) IN (SELECT owner_id,scope,project_id FROM bound_scopes)
        ORDER BY f.owner_id,f.scope,f.project_id,f.client,f.session_key LIMIT 50001`,args);
      const lineage=scan(related+`SELECT l.* FROM edges l
        ORDER BY l.receipt_id,l.conversation_id,l.message_id,l.start,l.end LIMIT 50001`,args);
      // Preserve every endpoint, even if the other end is absent, foreign or in
      // another namespace. Scope belongs to that endpoint, never to the searcher.
      const ancestors=scan(related+`SELECT l.receipt_id,l.conversation_id,l.message_id,l.start,l.end,
        c.id,c.owner_id,c.scope,c.project_id,c.client,c.session_key,m.role,m.total_units
        FROM edges l LEFT JOIN raw_conversations c ON c.id=l.conversation_id
        LEFT JOIN raw_messages m ON m.conversation_id=l.conversation_id AND m.message_id=l.message_id
        ORDER BY l.receipt_id,l.conversation_id,l.message_id,l.start,l.end LIMIT 50001`,args);
      const receipts=scan(related+`SELECT r.*,m.id AS parent_id,m.owner_id,m.scope,m.project_id,
        m.revision,m.currentness,m.review_state,m.deleted,o.kind
        FROM bound_receipts b CROSS JOIN receipts r ON r.id=b.id
        LEFT JOIN memories m ON m.id=r.memory_id LEFT JOIN raw_receipt_origins o ON o.receipt_id=r.id
        ORDER BY r.id LIMIT 50001`,args);
      const maps=scan(`SELECT a.* FROM raw_source_maps a JOIN raw_conversations c ON c.id=a.conversation_id
        JOIN raw_messages m ON m.conversation_id=a.conversation_id AND m.message_id=a.message_id
        WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND ${horizon}
        ORDER BY a.conversation_id,a.message_id,a.source_key,a.start,a.end LIMIT 50001`,args);
      const controls=read(()=>db.prepare("SELECT 1 FROM sqlite_master WHERE name='local_capture_controls'").get())?
        scan(`SELECT client,revision FROM local_capture_controls WHERE ${where} ORDER BY client LIMIT 50001`,args):[];
      const facts=read(()=>db.prepare("SELECT 1 FROM sqlite_master WHERE name='content_suppressions'").get())?
        scan(related+`SELECT f.* FROM content_suppressions f WHERE f.owner_id=? OR f.owner_id IN (SELECT owner_id FROM bound_scopes)
          ORDER BY f.owner_id,f.fact_id LIMIT 50001`,[...args,ns.ownerId]):[];
      const suppressions=read(()=>db.prepare("SELECT 1 FROM sqlite_master WHERE name='owner_suppression_epochs'").get())?
        scan(related+`SELECT e.* FROM owner_suppression_epochs e WHERE e.owner_id=? OR e.owner_id IN (SELECT owner_id FROM bound_scopes)
          ORDER BY e.owner_id LIMIT 50001`,[...args,ns.ownerId]):[];
      return {ns,conversations,parts,exclusions,fences,lineage,ancestors,receipts,maps,controls,facts,suppressions,
        exclusion:read(()=>db.prepare(`SELECT generation FROM raw_exclusion_clocks WHERE ${where}`).get(...args))};
    });
    const schema=scan('SELECT type,name,tbl_name,sql FROM sqlite_master WHERE 1 ORDER BY type,name LIMIT 50001',[]);
    const control=read(()=>db.prepare("SELECT 1 FROM sqlite_master WHERE name='content_safety_control'").get())?
      scan('SELECT * FROM content_safety_control WHERE 1 ORDER BY singleton LIMIT 50001',[]):[];
    const identities=read(()=>({store:db.prepare('SELECT singleton,store_id,cursor_secret FROM store_metadata WHERE singleton=1').get(),
      episode:db.prepare('SELECT singleton,secret FROM episode_identity WHERE singleton=1').get(),
      schema:db.prepare('PRAGMA schema_version').get(),version:db.prepare('PRAGMA user_version').get(),
      application:db.prepare('PRAGMA application_id').get()}));
    return {rows,schema,control,identities};
}
