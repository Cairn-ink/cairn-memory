-- Frozen synthetic v14 schema from 93e52b7afb298d728cb4831c34bbda6dcf750704
CREATE TABLE admission_claims (
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL,
      client TEXT NOT NULL,
      event_id TEXT NOT NULL,
      payload_digest TEXT NOT NULL CHECK (
        length(payload_digest) = 64 AND payload_digest NOT GLOB '*[^0-9a-f]*'),
      state TEXT NOT NULL CHECK (state IN ('pending','completed')),
      token TEXT,
      lease_expires_at INTEGER,
      memory_ids TEXT,
      suppressed_count INTEGER,
      PRIMARY KEY (owner_id, scope, project_id, client, event_id),
      CHECK ((scope = 'personal' AND project_id = '') OR
             (scope = 'project' AND length(project_id) > 0)),
      CHECK ((state = 'pending' AND token IS NOT NULL AND lease_expires_at IS NOT NULL
        AND memory_ids IS NULL AND suppressed_count IS NULL) OR
        (state = 'completed' AND token IS NULL AND lease_expires_at IS NULL
        -- Five opaque IDs of up to 200 characters, doubled by JSON escaping,
        -- plus quotes, commas and brackets (including IDs preserved by migration).
        AND memory_ids IS NOT NULL AND length(memory_ids) <= 2016
        AND suppressed_count IS NOT NULL AND suppressed_count BETWEEN 0 AND 5))
    ) STRICT;

CREATE TABLE capture_events (
      owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      client TEXT NOT NULL, event_id TEXT NOT NULL, stream_id TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK (sequence > 0),
      reconciliation TEXT CHECK (length(reconciliation) <= 120),
      PRIMARY KEY(owner_id, scope, project_id, client, event_id),
      UNIQUE(owner_id, scope, project_id, client, stream_id, sequence)
    ) STRICT;

CREATE TABLE capture_initial_classification (
    owner_id TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
    project_id TEXT NOT NULL,
    client TEXT NOT NULL,
    event_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('not_started','in_flight_or_interrupted',
      'applied','skipped_already_filed','failed','skipped_empty')),
    bound_refs TEXT NOT NULL CHECK (length(bound_refs) <= 4096),
    selected_refs TEXT CHECK (selected_refs IS NULL OR length(selected_refs) <= 4096),
    final_refs TEXT CHECK (final_refs IS NULL OR length(final_refs) <= 4096),
    attempt_token TEXT,
    PRIMARY KEY (owner_id,scope,project_id,client,event_id),
    FOREIGN KEY (owner_id,scope,project_id,client,event_id)
      REFERENCES admission_claims(owner_id,scope,project_id,client,event_id) ON DELETE CASCADE,
    CHECK ((scope = 'personal' AND project_id = '') OR
      (scope = 'project' AND length(project_id) > 0)),
    CHECK ((status = 'not_started' AND selected_refs IS NULL AND final_refs IS NULL
        AND attempt_token IS NULL) OR
      (status = 'skipped_empty' AND selected_refs IS NULL AND final_refs = '[]'
        AND attempt_token IS NULL) OR
      (status = 'in_flight_or_interrupted' AND selected_refs IS NOT NULL
        AND final_refs IS NULL AND attempt_token IS NOT NULL) OR
      (status = 'failed' AND selected_refs IS NOT NULL AND final_refs IS NULL
        AND attempt_token IS NULL) OR
      (status = 'skipped_already_filed' AND selected_refs = '[]'
        AND final_refs IS NOT NULL AND attempt_token IS NULL) OR
      (status = 'applied' AND selected_refs IS NOT NULL
        AND final_refs IS NOT NULL AND attempt_token IS NULL))
  ) STRICT;

CREATE TABLE capture_streams (
      owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      client TEXT NOT NULL, stream_id TEXT NOT NULL,
      high_water INTEGER NOT NULL CHECK (high_water >= 0),
      PRIMARY KEY(owner_id, scope, project_id, client, stream_id)
    ) STRICT;

CREATE TABLE index_edges (generation TEXT NOT NULL, parent_id TEXT NOT NULL,
      child_id TEXT NOT NULL, parent_revision INTEGER NOT NULL, child_revision INTEGER NOT NULL,
      PRIMARY KEY(generation,parent_id,child_id)) STRICT;

CREATE TABLE index_generations (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      captured_epoch INTEGER NOT NULL, page_limit INTEGER NOT NULL,
      phase INTEGER NOT NULL, last_key TEXT NOT NULL, sequence INTEGER NOT NULL,
      published INTEGER NOT NULL DEFAULT 0
    ) STRICT;

CREATE TABLE index_memories (generation TEXT NOT NULL, id TEXT NOT NULL,
      revision INTEGER NOT NULL, PRIMARY KEY(generation,id)) STRICT;

CREATE TABLE index_memory_refs (generation TEXT NOT NULL, moc_id TEXT NOT NULL,
      memory_id TEXT NOT NULL, moc_revision INTEGER NOT NULL, memory_revision INTEGER NOT NULL,
      PRIMARY KEY(generation,moc_id,memory_id)) STRICT;

CREATE TABLE index_mocs (generation TEXT NOT NULL, id TEXT NOT NULL,
      revision INTEGER NOT NULL, PRIMARY KEY(generation,id)) STRICT;

CREATE TABLE index_title_sources (generation TEXT NOT NULL, moc_id TEXT NOT NULL,
      memory_id TEXT NOT NULL, memory_revision INTEGER NOT NULL,
      PRIMARY KEY(generation,moc_id,memory_id)) STRICT;

CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      content TEXT,
      kind TEXT NOT NULL,
      origin TEXT NOT NULL CHECK (origin IN ('explicit','agent-inferred')),
      confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
      revision INTEGER NOT NULL CHECK (revision > 0),
      deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, filing_status TEXT NOT NULL DEFAULT 'unfiled'
      CHECK (filing_status IN ('filed','unfiled')), currentness TEXT NOT NULL DEFAULT 'current'
    CHECK (currentness IN ('current','historical')),
      CHECK ((scope = 'personal' AND project_id = '') OR
             (scope = 'project' AND length(project_id) > 0)),
      CHECK ((deleted = 0 AND content IS NOT NULL) OR (deleted = 1 AND content IS NULL))
    ) STRICT;

CREATE TABLE memory_conflicts (
      left_memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      left_revision INTEGER NOT NULL CHECK (left_revision > 0),
      right_memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      right_revision INTEGER NOT NULL CHECK (right_revision > 0),
      relation TEXT NOT NULL CHECK (relation = 'contradicts'),
      source TEXT NOT NULL CHECK (source IN ('explicit-hint','inferred-hint')),
      PRIMARY KEY (left_memory_id, left_revision, right_memory_id, right_revision, relation, source),
      CHECK (left_memory_id < right_memory_id)
    ) STRICT;

CREATE TABLE memory_qualifications (
      memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
      version INTEGER NOT NULL CHECK (version = 1),
      bound_revision INTEGER NOT NULL CHECK (bound_revision BETWEEN 1 AND 9007199254740991),
      content_digest TEXT NOT NULL CHECK (length(content_digest) = 64 AND content_digest NOT GLOB '*[^0-9a-f]*'),
      subject TEXT CHECK (subject IS NULL OR length(subject) BETWEEN 1 AND 160),
      property TEXT CHECK (property IS NULL OR length(property) BETWEEN 1 AND 160),
      scope TEXT CHECK (scope IS NULL OR length(scope) BETWEEN 1 AND 120),
      applies TEXT CHECK (applies IS NULL OR length(applies) BETWEEN 1 AND 120),
      value TEXT CHECK (value IS NULL OR length(value) BETWEEN 1 AND 160),
      attribution TEXT NOT NULL CHECK (attribution IN ('direct','reported','quoted','proposed','unknown')),
      commitment TEXT NOT NULL CHECK (commitment IN ('adopted','considered','rejected','unknown')),
      anchor_count INTEGER NOT NULL CHECK (anchor_count BETWEEN 1 AND 4)
    ) STRICT;

CREATE TABLE memory_supersessions (
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL,
      previous_memory_id TEXT PRIMARY KEY REFERENCES memories(id),
      previous_revision INTEGER NOT NULL CHECK (previous_revision > 0),
      replacement_memory_id TEXT NOT NULL REFERENCES memories(id),
      replacement_revision INTEGER NOT NULL CHECK (replacement_revision > 0),
      -- Four opaque 200-unit IDs, including worst-case JSON escaping/delimiters.
      receipt_ids TEXT NOT NULL CHECK (length(receipt_ids) <= 1613),
      CHECK (previous_memory_id != replacement_memory_id),
      CHECK ((scope = 'personal' AND project_id = '') OR
             (scope = 'project' AND length(project_id) > 0))
    ) STRICT;

CREATE TABLE moc_edges (
      parent_id TEXT NOT NULL REFERENCES mocs(id) ON DELETE CASCADE,
      parent_revision INTEGER NOT NULL CHECK (parent_revision > 0),
      child_id TEXT NOT NULL REFERENCES mocs(id) ON DELETE CASCADE,
      child_revision INTEGER NOT NULL CHECK (child_revision > 0),
      PRIMARY KEY (parent_id, child_id),
      CHECK (parent_id != child_id)
    ) STRICT;

CREATE TABLE moc_memory_refs (
      moc_id TEXT NOT NULL REFERENCES mocs(id) ON DELETE CASCADE,
      moc_revision INTEGER NOT NULL CHECK (moc_revision > 0),
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      memory_revision INTEGER NOT NULL CHECK (memory_revision > 0),
      PRIMARY KEY (moc_id, memory_id)
    ) STRICT;

CREATE TABLE moc_title_sources (
      moc_id TEXT NOT NULL REFERENCES mocs(id) ON DELETE CASCADE,
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      memory_revision INTEGER NOT NULL CHECK (memory_revision > 0),
      PRIMARY KEY (moc_id, memory_id)
    ) STRICT;

CREATE TABLE mocs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL,
      level INTEGER NOT NULL CHECK (level IN (1,2)),
      title TEXT NOT NULL,
      canonical_title TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK ((scope = 'personal' AND project_id = '') OR
             (scope = 'project' AND length(project_id) > 0))
    ) STRICT;

CREATE TABLE namespace_epochs (
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL,
      epoch INTEGER NOT NULL CHECK (epoch >= 1),
      PRIMARY KEY (owner_id, scope, project_id)
    ) STRICT;

CREATE TABLE namespace_index_state (
      owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      active_generation TEXT, PRIMARY KEY(owner_id, scope, project_id)
    ) STRICT;

CREATE TABLE qualification_anchors (
      memory_id TEXT NOT NULL REFERENCES memory_qualifications(memory_id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 3),
      receipt_id TEXT NOT NULL REFERENCES receipts(id),
      receipt_digest TEXT NOT NULL CHECK (length(receipt_digest) = 64 AND receipt_digest NOT GLOB '*[^0-9a-f]*'),
      start INTEGER NOT NULL CHECK (start BETWEEN 0 AND 799),
      end INTEGER NOT NULL CHECK (end > start AND end <= 800 AND end - start <= 200),
      fields TEXT NOT NULL CHECK (length(fields) BETWEEN 2 AND 128),
      PRIMARY KEY (memory_id, ordinal)
    ) STRICT;

CREATE TABLE qualified_claim_bindings (
      memory_id TEXT PRIMARY KEY REFERENCES memory_qualifications(memory_id) ON DELETE CASCADE,
      slot_id TEXT NOT NULL REFERENCES qualified_slots(id),
      bound_revision INTEGER NOT NULL CHECK (bound_revision BETWEEN 1 AND 9007199254740991),
      content_digest TEXT NOT NULL CHECK (length(content_digest) = 64 AND content_digest NOT GLOB '*[^0-9a-f]*'),
      single_claim INTEGER NOT NULL CHECK (single_claim = 1)
    ) STRICT;

CREATE TABLE qualified_slots (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
      owner_id TEXT NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 200),
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL CHECK (length(project_id) <= 200),
      subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 160),
      property TEXT NOT NULL CHECK (length(property) BETWEEN 1 AND 160),
      claim_scope TEXT NOT NULL CHECK (length(claim_scope) BETWEEN 1 AND 120),
      applies TEXT NOT NULL CHECK (length(applies) BETWEEN 1 AND 120),
      CHECK ((scope = 'personal' AND project_id = '') OR (scope = 'project' AND length(project_id) > 0))
    ) STRICT;

CREATE TABLE rationale_edges (
      from_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      from_revision INTEGER NOT NULL CHECK(from_revision > 0),
      to_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      to_revision INTEGER NOT NULL CHECK(to_revision > 0),
      relation TEXT NOT NULL CHECK(relation IN ('supports-decision','challenges-premise')),
      from_receipt TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
      to_receipt TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
      from_digest TEXT NOT NULL,
      to_digest TEXT NOT NULL,
      CHECK(from_id != to_id OR relation = 'supports-decision'),
      PRIMARY KEY(from_id, to_id, relation, from_receipt, to_receipt)
    ) STRICT;

CREATE TABLE receipt_causality (
      receipt_id TEXT PRIMARY KEY REFERENCES receipts(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      client TEXT NOT NULL, stream_id TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK (sequence > 0)
    ) STRICT;

CREATE TABLE receipts (
      id TEXT NOT NULL UNIQUE,
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      receipt_key TEXT NOT NULL,
      client TEXT NOT NULL,
      session_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user','assistant')),
      excerpt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (memory_id, receipt_key)
    ) STRICT;

CREATE TABLE staged_capture_clocks (
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL,
      watermark INTEGER NOT NULL,
      PRIMARY KEY (owner_id, scope, project_id)
    ) STRICT;

CREATE TABLE staged_capture_evidence (
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL,
      client TEXT NOT NULL,
      event_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending','failed','admitted','discarded','expired','forgotten')),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      payload TEXT,
      payload_bytes INTEGER NOT NULL CHECK (payload_bytes BETWEEN 0 AND 131072),
      PRIMARY KEY (owner_id, scope, project_id, client, event_id),
      FOREIGN KEY (owner_id, scope, project_id, client, event_id)
        REFERENCES admission_claims(owner_id, scope, project_id, client, event_id),
      CHECK ((payload IS NULL AND payload_bytes = 0) OR
        (payload IS NOT NULL AND payload_bytes > 0)),
      CHECK ((scope = 'personal' AND project_id = '') OR
        (scope = 'project' AND length(project_id) > 0))
    ) STRICT;

CREATE TABLE store_metadata (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      store_id TEXT NOT NULL UNIQUE,
      cursor_secret TEXT NOT NULL
    ) STRICT;

CREATE TABLE suppressed (
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      project_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      PRIMARY KEY (owner_id, scope, project_id, fingerprint)
    ) STRICT;

CREATE UNIQUE INDEX active_identity ON memories(owner_id, scope, project_id, fingerprint)
      WHERE deleted = 0;

CREATE INDEX capture_current_memories ON memories(owner_id,scope,project_id,id)
      WHERE deleted = 0 AND currentness = 'current';

CREATE INDEX capture_memory_receipts ON receipts(memory_id,id);

CREATE INDEX child_moc_edges ON moc_edges(child_id, parent_id);

CREATE TRIGGER index_memories_delete AFTER DELETE ON memories BEGIN DELETE FROM index_memories WHERE id = OLD.id
      AND generation IN (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = OLD.owner_id AND s.scope = OLD.scope AND s.project_id = OLD.project_id); END;

CREATE TRIGGER index_memories_insert AFTER INSERT ON memories BEGIN INSERT OR REPLACE INTO index_memories(generation,id,revision)
      SELECT (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = r.owner_id AND s.scope = r.scope AND s.project_id = r.project_id),r.id,r.revision
      FROM memories r WHERE r.id = NEW.id AND r.deleted = 0 AND r.currentness = 'current' AND (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = r.owner_id AND s.scope = r.scope AND s.project_id = r.project_id) IS NOT NULL; END;

CREATE TRIGGER index_memories_update AFTER UPDATE ON memories BEGIN UPDATE index_memories SET id = NEW.id,revision = NEW.revision
      WHERE id = OLD.id AND generation IN
        (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = OLD.owner_id AND s.scope = OLD.scope AND s.project_id = OLD.project_id);
      DELETE FROM index_memories WHERE id = NEW.id
        AND generation IN (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = OLD.owner_id AND s.scope = OLD.scope AND s.project_id = OLD.project_id)
        AND NOT EXISTS (SELECT 1 FROM memories r WHERE r.id = NEW.id AND r.deleted = 0 AND r.currentness = 'current'); END;

CREATE INDEX index_memory_keyset ON memories(owner_id, scope, project_id, id);

CREATE TRIGGER index_moc_edges_delete AFTER DELETE ON moc_edges BEGIN DELETE FROM index_edges WHERE parent_id = OLD.parent_id AND child_id = OLD.child_id
      AND generation IN (SELECT s.active_generation FROM namespace_index_state s JOIN mocs p ON s.owner_id = p.owner_id AND s.scope = p.scope AND s.project_id = p.project_id
        WHERE p.id = OLD.parent_id
       UNION SELECT s.active_generation FROM namespace_index_state s
        JOIN mocs c ON s.owner_id = c.owner_id AND s.scope = c.scope AND s.project_id = c.project_id
        WHERE c.id = OLD.child_id); END;

CREATE TRIGGER index_moc_edges_insert AFTER INSERT ON moc_edges BEGIN INSERT OR REPLACE INTO index_edges(generation,parent_id,child_id,parent_revision,child_revision)
      SELECT (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = p.owner_id AND s.scope = p.scope AND s.project_id = p.project_id),r.parent_id,r.child_id,r.parent_revision,r.child_revision
      FROM moc_edges r JOIN mocs p ON p.id = r.parent_id JOIN mocs c ON c.id = r.child_id WHERE r.parent_id = NEW.parent_id AND r.child_id = NEW.child_id AND p.owner_id = c.owner_id AND p.scope = c.scope AND p.project_id = c.project_id AND p.level = 2 AND c.level = 1 AND p.revision = r.parent_revision AND c.revision = r.child_revision AND (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = p.owner_id AND s.scope = p.scope AND s.project_id = p.project_id) IS NOT NULL; END;

CREATE TRIGGER index_moc_edges_update AFTER UPDATE ON moc_edges BEGIN UPDATE index_edges SET parent_id = NEW.parent_id,child_id = NEW.child_id,parent_revision = NEW.parent_revision,child_revision = NEW.child_revision
      WHERE parent_id = OLD.parent_id AND child_id = OLD.child_id AND generation IN
        (SELECT s.active_generation FROM namespace_index_state s JOIN mocs p ON s.owner_id = p.owner_id AND s.scope = p.scope AND s.project_id = p.project_id
        WHERE p.id = OLD.parent_id
       UNION SELECT s.active_generation FROM namespace_index_state s
        JOIN mocs c ON s.owner_id = c.owner_id AND s.scope = c.scope AND s.project_id = c.project_id
        WHERE c.id = OLD.child_id);
      DELETE FROM index_edges WHERE parent_id = NEW.parent_id AND child_id = NEW.child_id
        AND generation IN (SELECT s.active_generation FROM namespace_index_state s JOIN mocs p ON s.owner_id = p.owner_id AND s.scope = p.scope AND s.project_id = p.project_id
        WHERE p.id = OLD.parent_id
       UNION SELECT s.active_generation FROM namespace_index_state s
        JOIN mocs c ON s.owner_id = c.owner_id AND s.scope = c.scope AND s.project_id = c.project_id
        WHERE c.id = OLD.child_id)
        AND NOT EXISTS (SELECT 1 FROM moc_edges r JOIN mocs p ON p.id = r.parent_id JOIN mocs c ON c.id = r.child_id WHERE r.parent_id = NEW.parent_id AND r.child_id = NEW.child_id AND p.owner_id = c.owner_id AND p.scope = c.scope AND p.project_id = c.project_id AND p.level = 2 AND c.level = 1 AND p.revision = r.parent_revision AND c.revision = r.child_revision); END;

CREATE INDEX index_moc_keyset ON mocs(owner_id, scope, project_id, id);

CREATE TRIGGER index_moc_memory_refs_delete AFTER DELETE ON moc_memory_refs BEGIN DELETE FROM index_memory_refs WHERE moc_id = OLD.moc_id AND memory_id = OLD.memory_id
      AND generation IN (SELECT s.active_generation FROM namespace_index_state s JOIN mocs p ON s.owner_id = p.owner_id AND s.scope = p.scope AND s.project_id = p.project_id
        WHERE p.id = OLD.moc_id
       UNION SELECT s.active_generation FROM namespace_index_state s
        JOIN memories c ON s.owner_id = c.owner_id AND s.scope = c.scope AND s.project_id = c.project_id
        WHERE c.id = OLD.memory_id); END;

CREATE TRIGGER index_moc_memory_refs_insert AFTER INSERT ON moc_memory_refs BEGIN INSERT OR REPLACE INTO index_memory_refs(generation,moc_id,memory_id,moc_revision,memory_revision)
      SELECT (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = p.owner_id AND s.scope = p.scope AND s.project_id = p.project_id),r.moc_id,r.memory_id,r.moc_revision,r.memory_revision
      FROM moc_memory_refs r JOIN mocs p ON p.id = r.moc_id JOIN memories c ON c.id = r.memory_id WHERE r.moc_id = NEW.moc_id AND r.memory_id = NEW.memory_id AND p.owner_id = c.owner_id AND p.scope = c.scope AND p.project_id = c.project_id AND p.level = 1 AND c.deleted = 0 AND p.revision = r.moc_revision AND c.revision = r.memory_revision AND c.currentness = 'current' AND (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = p.owner_id AND s.scope = p.scope AND s.project_id = p.project_id) IS NOT NULL; END;

CREATE TRIGGER index_moc_memory_refs_update AFTER UPDATE ON moc_memory_refs BEGIN UPDATE index_memory_refs SET moc_id = NEW.moc_id,memory_id = NEW.memory_id,moc_revision = NEW.moc_revision,memory_revision = NEW.memory_revision
      WHERE moc_id = OLD.moc_id AND memory_id = OLD.memory_id AND generation IN
        (SELECT s.active_generation FROM namespace_index_state s JOIN mocs p ON s.owner_id = p.owner_id AND s.scope = p.scope AND s.project_id = p.project_id
        WHERE p.id = OLD.moc_id
       UNION SELECT s.active_generation FROM namespace_index_state s
        JOIN memories c ON s.owner_id = c.owner_id AND s.scope = c.scope AND s.project_id = c.project_id
        WHERE c.id = OLD.memory_id);
      DELETE FROM index_memory_refs WHERE moc_id = NEW.moc_id AND memory_id = NEW.memory_id
        AND generation IN (SELECT s.active_generation FROM namespace_index_state s JOIN mocs p ON s.owner_id = p.owner_id AND s.scope = p.scope AND s.project_id = p.project_id
        WHERE p.id = OLD.moc_id
       UNION SELECT s.active_generation FROM namespace_index_state s
        JOIN memories c ON s.owner_id = c.owner_id AND s.scope = c.scope AND s.project_id = c.project_id
        WHERE c.id = OLD.memory_id)
        AND NOT EXISTS (SELECT 1 FROM moc_memory_refs r JOIN mocs p ON p.id = r.moc_id JOIN memories c ON c.id = r.memory_id WHERE r.moc_id = NEW.moc_id AND r.memory_id = NEW.memory_id AND p.owner_id = c.owner_id AND p.scope = c.scope AND p.project_id = c.project_id AND p.level = 1 AND c.deleted = 0 AND p.revision = r.moc_revision AND c.revision = r.memory_revision AND c.currentness = 'current'); END;

CREATE TRIGGER index_moc_title_sources_delete AFTER DELETE ON moc_title_sources BEGIN DELETE FROM index_title_sources WHERE moc_id = OLD.moc_id AND memory_id = OLD.memory_id
      AND generation IN (SELECT s.active_generation FROM namespace_index_state s JOIN mocs p ON s.owner_id = p.owner_id AND s.scope = p.scope AND s.project_id = p.project_id
        WHERE p.id = OLD.moc_id
       UNION SELECT s.active_generation FROM namespace_index_state s
        JOIN memories c ON s.owner_id = c.owner_id AND s.scope = c.scope AND s.project_id = c.project_id
        WHERE c.id = OLD.memory_id); END;

CREATE TRIGGER index_moc_title_sources_insert AFTER INSERT ON moc_title_sources BEGIN INSERT OR REPLACE INTO index_title_sources(generation,moc_id,memory_id,memory_revision)
      SELECT (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = p.owner_id AND s.scope = p.scope AND s.project_id = p.project_id),r.moc_id,r.memory_id,r.memory_revision
      FROM moc_title_sources r JOIN mocs p ON p.id = r.moc_id JOIN memories c ON c.id = r.memory_id WHERE r.moc_id = NEW.moc_id AND r.memory_id = NEW.memory_id AND p.owner_id = c.owner_id AND p.scope = c.scope AND p.project_id = c.project_id AND p.level IN (1,2) AND c.deleted = 0 AND c.revision = r.memory_revision AND c.currentness = 'current' AND (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = p.owner_id AND s.scope = p.scope AND s.project_id = p.project_id) IS NOT NULL; END;

CREATE TRIGGER index_moc_title_sources_update AFTER UPDATE ON moc_title_sources BEGIN UPDATE index_title_sources SET moc_id = NEW.moc_id,memory_id = NEW.memory_id,memory_revision = NEW.memory_revision
      WHERE moc_id = OLD.moc_id AND memory_id = OLD.memory_id AND generation IN
        (SELECT s.active_generation FROM namespace_index_state s JOIN mocs p ON s.owner_id = p.owner_id AND s.scope = p.scope AND s.project_id = p.project_id
        WHERE p.id = OLD.moc_id
       UNION SELECT s.active_generation FROM namespace_index_state s
        JOIN memories c ON s.owner_id = c.owner_id AND s.scope = c.scope AND s.project_id = c.project_id
        WHERE c.id = OLD.memory_id);
      DELETE FROM index_title_sources WHERE moc_id = NEW.moc_id AND memory_id = NEW.memory_id
        AND generation IN (SELECT s.active_generation FROM namespace_index_state s JOIN mocs p ON s.owner_id = p.owner_id AND s.scope = p.scope AND s.project_id = p.project_id
        WHERE p.id = OLD.moc_id
       UNION SELECT s.active_generation FROM namespace_index_state s
        JOIN memories c ON s.owner_id = c.owner_id AND s.scope = c.scope AND s.project_id = c.project_id
        WHERE c.id = OLD.memory_id)
        AND NOT EXISTS (SELECT 1 FROM moc_title_sources r JOIN mocs p ON p.id = r.moc_id JOIN memories c ON c.id = r.memory_id WHERE r.moc_id = NEW.moc_id AND r.memory_id = NEW.memory_id AND p.owner_id = c.owner_id AND p.scope = c.scope AND p.project_id = c.project_id AND p.level IN (1,2) AND c.deleted = 0 AND c.revision = r.memory_revision AND c.currentness = 'current'); END;

CREATE TRIGGER index_mocs_delete AFTER DELETE ON mocs BEGIN DELETE FROM index_mocs WHERE id = OLD.id
      AND generation IN (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = OLD.owner_id AND s.scope = OLD.scope AND s.project_id = OLD.project_id); END;

CREATE TRIGGER index_mocs_insert AFTER INSERT ON mocs BEGIN INSERT OR REPLACE INTO index_mocs(generation,id,revision)
      SELECT (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = r.owner_id AND s.scope = r.scope AND s.project_id = r.project_id),r.id,r.revision
      FROM mocs r WHERE r.id = NEW.id AND r.level IN (1,2) AND (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = r.owner_id AND s.scope = r.scope AND s.project_id = r.project_id) IS NOT NULL; END;

CREATE TRIGGER index_mocs_update AFTER UPDATE ON mocs BEGIN UPDATE index_mocs SET id = NEW.id,revision = NEW.revision
      WHERE id = OLD.id AND generation IN
        (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = OLD.owner_id AND s.scope = OLD.scope AND s.project_id = OLD.project_id);
      DELETE FROM index_mocs WHERE id = NEW.id
        AND generation IN (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = OLD.owner_id AND s.scope = OLD.scope AND s.project_id = OLD.project_id)
        AND NOT EXISTS (SELECT 1 FROM mocs r WHERE r.id = NEW.id AND r.level IN (1,2)); END;

CREATE VIEW index_read_edges AS
      SELECT r.* FROM moc_edges r LEFT JOIN mocs p ON p.id = r.parent_id WHERE (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = p.owner_id AND s.scope = p.scope AND s.project_id = p.project_id) IS NULL
      UNION ALL SELECT r.* FROM moc_edges r JOIN mocs p ON p.id = r.parent_id JOIN mocs c ON c.id = r.child_id
      JOIN index_edges i ON i.parent_id = r.parent_id AND i.child_id = r.child_id AND i.parent_revision = r.parent_revision AND i.child_revision = r.child_revision AND i.generation = (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = p.owner_id AND s.scope = p.scope AND s.project_id = p.project_id)
      WHERE p.owner_id = c.owner_id AND p.scope = c.scope AND p.project_id = c.project_id AND p.level = 2 AND c.level = 1 AND p.revision = r.parent_revision AND c.revision = r.child_revision;

CREATE VIEW index_read_memories AS
      SELECT r.* FROM memories r WHERE (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = r.owner_id AND s.scope = r.scope AND s.project_id = r.project_id) IS NULL AND r.currentness = 'current'
      UNION ALL SELECT r.* FROM memories r
      JOIN index_memories i ON i.id = r.id AND i.revision = r.revision AND i.generation = (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = r.owner_id AND s.scope = r.scope AND s.project_id = r.project_id)
      WHERE r.deleted = 0 AND r.currentness = 'current';

CREATE VIEW index_read_memory_refs AS
      SELECT r.* FROM moc_memory_refs r LEFT JOIN mocs p ON p.id = r.moc_id WHERE (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = p.owner_id AND s.scope = p.scope AND s.project_id = p.project_id) IS NULL AND NOT EXISTS (SELECT 1 FROM memories h WHERE h.id = r.memory_id AND h.currentness = 'historical')
      UNION ALL SELECT r.* FROM moc_memory_refs r JOIN mocs p ON p.id = r.moc_id JOIN memories c ON c.id = r.memory_id
      JOIN index_memory_refs i ON i.moc_id = r.moc_id AND i.memory_id = r.memory_id AND i.moc_revision = r.moc_revision AND i.memory_revision = r.memory_revision AND i.generation = (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = p.owner_id AND s.scope = p.scope AND s.project_id = p.project_id)
      WHERE p.owner_id = c.owner_id AND p.scope = c.scope AND p.project_id = c.project_id AND p.level = 1 AND c.deleted = 0 AND p.revision = r.moc_revision AND c.revision = r.memory_revision AND c.currentness = 'current';

CREATE VIEW index_read_mocs AS
      SELECT r.* FROM mocs r WHERE (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = r.owner_id AND s.scope = r.scope AND s.project_id = r.project_id) IS NULL
      UNION ALL SELECT r.* FROM mocs r
      JOIN index_mocs i ON i.id = r.id AND i.revision = r.revision AND i.generation = (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = r.owner_id AND s.scope = r.scope AND s.project_id = r.project_id)
      WHERE r.level IN (1,2);

CREATE VIEW index_read_title_sources AS
      SELECT r.* FROM moc_title_sources r LEFT JOIN mocs p ON p.id = r.moc_id WHERE (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = p.owner_id AND s.scope = p.scope AND s.project_id = p.project_id) IS NULL AND NOT EXISTS (SELECT 1 FROM memories h WHERE h.id = r.memory_id AND h.currentness = 'historical')
      UNION ALL SELECT r.* FROM moc_title_sources r JOIN mocs p ON p.id = r.moc_id JOIN memories c ON c.id = r.memory_id
      JOIN index_title_sources i ON i.moc_id = r.moc_id AND i.memory_id = r.memory_id AND i.memory_revision = r.memory_revision AND i.generation = (SELECT active_generation FROM namespace_index_state s WHERE s.owner_id = p.owner_id AND s.scope = p.scope AND s.project_id = p.project_id)
      WHERE p.owner_id = c.owner_id AND p.scope = c.scope AND p.project_id = c.project_id AND p.level IN (1,2) AND c.deleted = 0 AND c.revision = r.memory_revision AND c.currentness = 'current';

CREATE INDEX memory_moc_refs ON moc_memory_refs(memory_id, moc_id);

CREATE INDEX memory_receipts ON receipts(memory_id, created_at, id);

CREATE INDEX memory_title_sources ON moc_title_sources(memory_id, moc_id);

CREATE INDEX namespace_memories ON memories(
      owner_id, scope, project_id, deleted, updated_at DESC, id);

CREATE UNIQUE INDEX namespace_moc_titles ON mocs(
      owner_id, scope, project_id, level, canonical_title);

CREATE INDEX namespace_mocs ON mocs(
      owner_id, scope, project_id, level, canonical_title, id);

CREATE INDEX qualification_receipts ON qualification_anchors(receipt_id);

CREATE TRIGGER qualified_slot_cleanup AFTER DELETE ON qualified_claim_bindings
    BEGIN
      DELETE FROM qualified_slots WHERE id = OLD.slot_id
        AND NOT EXISTS (SELECT 1 FROM qualified_claim_bindings WHERE slot_id = OLD.slot_id);
    END;

CREATE INDEX qualified_slot_members ON qualified_claim_bindings(slot_id);

CREATE INDEX rationale_incoming ON rationale_edges(to_id, relation);

CREATE TRIGGER rationale_memory_changed AFTER UPDATE ON memories
    WHEN NEW.revision != OLD.revision OR NEW.deleted != OLD.deleted
      OR NEW.content IS NOT OLD.content OR NEW.currentness != OLD.currentness
      OR NEW.owner_id != OLD.owner_id OR NEW.scope != OLD.scope OR NEW.project_id != OLD.project_id
    BEGIN
      DELETE FROM rationale_edges WHERE from_id = OLD.id OR to_id = OLD.id;
    END;

CREATE TRIGGER rationale_receipt_added AFTER INSERT ON receipts
    BEGIN
      DELETE FROM rationale_edges WHERE from_id = NEW.memory_id OR to_id = NEW.memory_id;
    END;

CREATE TRIGGER rationale_receipt_changed AFTER UPDATE ON receipts
    BEGIN
      DELETE FROM rationale_edges WHERE from_id = OLD.memory_id OR to_id = OLD.memory_id
        OR from_id = NEW.memory_id OR to_id = NEW.memory_id;
    END;

CREATE TRIGGER rationale_receipt_removed AFTER DELETE ON receipts
    BEGIN
      DELETE FROM rationale_edges WHERE from_id = OLD.memory_id OR to_id = OLD.memory_id;
    END;

CREATE INDEX replacement_supersessions ON memory_supersessions(replacement_memory_id);

CREATE INDEX right_memory_conflicts ON memory_conflicts(right_memory_id);
PRAGMA application_id=1128352082;
PRAGMA user_version=14;
