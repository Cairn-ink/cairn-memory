import { installCardMemoryInvalidation } from './private-card-schema.mjs';
// Complete authored lineage declarations. Installation is offline and explicit.
export const cardLineageDDL = `CREATE TABLE card_body_authorizations (
 owner_id TEXT NOT NULL, host_action_id TEXT NOT NULL CHECK(length(host_action_id) BETWEEN 1 AND 200),
 scope TEXT NOT NULL CHECK(scope IN ('personal','project')), project_id TEXT NOT NULL CHECK((scope='personal' AND project_id='') OR (scope='project' AND length(project_id)>0)),
 method TEXT NOT NULL, request_target TEXT NOT NULL, actor_id TEXT NOT NULL CHECK(length(actor_id) BETWEEN 1 AND 200),
 authorized_at TEXT NOT NULL CHECK(length(authorized_at)>0),
 payload_binding TEXT NOT NULL CHECK(length(payload_binding)=64 AND payload_binding NOT GLOB '*[^0-9a-f]*'),
 authorization_kind TEXT NOT NULL CHECK(authorization_kind IN ('operation','authored-input','keep-as-own','user-rewrite')),
 card_id TEXT, body_revision INTEGER, body_digest TEXT,
 PRIMARY KEY(owner_id,host_action_id),
 UNIQUE(owner_id,card_id,body_revision),
 CHECK((authorization_kind='operation' AND card_id IS NULL AND body_revision IS NULL AND body_digest IS NULL) OR
 (authorization_kind!='operation' AND card_id IS NOT NULL AND body_revision IS NOT NULL AND body_digest IS NOT NULL AND body_revision BETWEEN 1 AND 9007199254740991 AND length(body_digest)=64 AND body_digest NOT GLOB '*[^0-9a-f]*'))
) STRICT, WITHOUT ROWID;
CREATE TABLE card_body_provenance (
 owner_id TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('personal','project')),
 project_id TEXT NOT NULL CHECK((scope='personal' AND project_id='') OR (scope='project' AND length(project_id)>0)),
 card_kind TEXT NOT NULL DEFAULT 'card' CHECK(card_kind='card'), card_id TEXT NOT NULL,
 body_revision INTEGER NOT NULL CHECK(body_revision BETWEEN 1 AND 9007199254740991),
 provenance_revision INTEGER NOT NULL CHECK(provenance_revision BETWEEN 1 AND 9007199254740991),
 body_digest TEXT NOT NULL CHECK(length(body_digest)=64 AND body_digest NOT GLOB '*[^0-9a-f]*'),
 provenance_digest TEXT NOT NULL CHECK(length(provenance_digest)=64 AND provenance_digest NOT GLOB '*[^0-9a-f]*'),
 completeness TEXT NOT NULL CHECK(completeness IN ('complete','unknown')),
 origin TEXT NOT NULL CHECK(origin IN ('derived','user-authored','legacy-unknown')),
 source_count INTEGER NOT NULL CHECK(source_count BETWEEN 0 AND 9007199254740991), authorization_action TEXT,
 PRIMARY KEY(owner_id,scope,project_id,card_id,body_revision,provenance_revision),
 FOREIGN KEY(owner_id,scope,project_id,card_kind,card_id,card_id)
 REFERENCES content_identity_reservations(owner_id,scope,project_id,kind,stable_key,incarnation),
 FOREIGN KEY(owner_id,authorization_action) REFERENCES card_body_authorizations(owner_id,host_action_id),
 CHECK(origin!='legacy-unknown' OR completeness='unknown'),
 CHECK(origin!='user-authored' OR (completeness='complete' AND authorization_action IS NOT NULL AND source_count=0)),
 CHECK(completeness!='complete' OR source_count>0 OR origin='user-authored')
) STRICT, WITHOUT ROWID;
CREATE TABLE card_body_sources (
 owner_id TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('personal','project')),
 project_id TEXT NOT NULL CHECK((scope='personal' AND project_id='') OR (scope='project' AND length(project_id)>0)),
 card_id TEXT NOT NULL, body_revision INTEGER NOT NULL CHECK(body_revision BETWEEN 1 AND 9007199254740991),
 source_scope TEXT NOT NULL CHECK(source_scope IN ('personal','project')),
 source_project TEXT NOT NULL CHECK((source_scope='personal' AND source_project='') OR (source_scope='project' AND length(source_project)>0)),
 source_kind TEXT NOT NULL CHECK(source_kind IN ('memory','receipt','submitted-note','raw')),
 source_key TEXT NOT NULL, source_incarnation TEXT NOT NULL CHECK(source_key=source_incarnation),
 source_version TEXT NOT NULL CHECK(json_valid(source_version) AND json_type(source_version)='array' AND length(CAST(source_version AS BLOB))<=16384),
 content_identity TEXT NOT NULL CHECK(content_identity='' OR (length(content_identity)=64 AND content_identity NOT GLOB '*[^0-9a-f]*')),
 added_revision INTEGER NOT NULL CHECK(added_revision BETWEEN 1 AND 9007199254740991),
 evidence_origin TEXT NOT NULL CHECK(evidence_origin IN ('writer','binding','receipt-ancestry','canonical-operation','canonical-trace')),
 evidence_digest TEXT NOT NULL CHECK(length(evidence_digest)=64 AND evidence_digest NOT GLOB '*[^0-9a-f]*'),
 PRIMARY KEY(owner_id,scope,project_id,card_id,body_revision,source_scope,source_project,source_kind,source_key,source_incarnation,source_version),
 FOREIGN KEY(owner_id,source_scope,source_project,source_kind,source_key,source_incarnation)
 REFERENCES content_identity_reservations(owner_id,scope,project_id,kind,stable_key,incarnation),
 FOREIGN KEY(owner_id,scope,project_id,card_id,body_revision,added_revision)
 REFERENCES card_body_provenance(owner_id,scope,project_id,card_id,body_revision,provenance_revision) DEFERRABLE INITIALLY DEFERRED
) STRICT, WITHOUT ROWID;
CREATE INDEX card_body_source_erasure ON card_body_sources(owner_id,source_scope,source_project,source_kind,source_key,source_incarnation);
CREATE INDEX card_body_header_latest ON card_body_provenance(owner_id,scope,project_id,card_id,body_revision DESC,provenance_revision DESC);
CREATE UNIQUE INDEX card_operations_owner_action ON card_operations(owner_id,action_id);

CREATE TRIGGER safety_action_insert BEFORE INSERT ON card_body_authorizations
 WHEN EXISTS(SELECT 1 FROM card_body_authorizations WHERE (owner_id,host_action_id)=(NEW.owner_id,NEW.host_action_id) OR (owner_id,card_id,body_revision)=(NEW.owner_id,NEW.card_id,NEW.body_revision)) BEGIN SELECT RAISE(ABORT,'safety_replace'); END;
CREATE TRIGGER safety_action_update BEFORE UPDATE ON card_body_authorizations BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_action_delete BEFORE DELETE ON card_body_authorizations BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_operation_insert BEFORE INSERT ON card_operations
 WHEN EXISTS(SELECT 1 FROM card_operations WHERE (owner_id,action_id)=(NEW.owner_id,NEW.action_id) OR rowid=NEW.rowid) BEGIN SELECT RAISE(ABORT,'safety_replace'); END;
CREATE TRIGGER safety_source_update BEFORE UPDATE ON card_body_sources BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_source_delete BEFORE DELETE ON card_body_sources BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_source_insert BEFORE INSERT ON card_body_sources
 WHEN NEW.body_revision < coalesce((SELECT max(body_revision) FROM card_body_provenance p WHERE (p.owner_id,p.scope,p.project_id,p.card_id)=(NEW.owner_id,NEW.scope,NEW.project_id,NEW.card_id)),NEW.body_revision) OR
 NEW.added_revision != 1+coalesce((SELECT max(provenance_revision) FROM card_body_provenance p WHERE (p.owner_id,p.scope,p.project_id,p.card_id,p.body_revision)=(NEW.owner_id,NEW.scope,NEW.project_id,NEW.card_id,NEW.body_revision)),0) OR
 EXISTS(SELECT 1 FROM card_body_sources s WHERE (s.owner_id,s.scope,s.project_id,s.card_id,s.body_revision,s.source_scope,s.source_project,s.source_kind,s.source_key,s.source_incarnation,s.source_version)=(NEW.owner_id,NEW.scope,NEW.project_id,NEW.card_id,NEW.body_revision,NEW.source_scope,NEW.source_project,NEW.source_kind,NEW.source_key,NEW.source_incarnation,NEW.source_version))
 BEGIN SELECT RAISE(ABORT,'safety_source_sealed'); END;
CREATE TRIGGER safety_header_update BEFORE UPDATE ON card_body_provenance BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_header_delete BEFORE DELETE ON card_body_provenance BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_header_insert BEFORE INSERT ON card_body_provenance
 WHEN NEW.body_revision < coalesce((SELECT max(body_revision) FROM card_body_provenance p WHERE (p.owner_id,p.scope,p.project_id,p.card_id)=(NEW.owner_id,NEW.scope,NEW.project_id,NEW.card_id)),NEW.body_revision) OR
 NEW.provenance_revision != 1+coalesce((SELECT max(provenance_revision) FROM card_body_provenance p WHERE (p.owner_id,p.scope,p.project_id,p.card_id,p.body_revision)=(NEW.owner_id,NEW.scope,NEW.project_id,NEW.card_id,NEW.body_revision)),0) OR
 NEW.source_count != (SELECT count(*) FROM card_body_sources s WHERE (s.owner_id,s.scope,s.project_id,s.card_id,s.body_revision)=(NEW.owner_id,NEW.scope,NEW.project_id,NEW.card_id,NEW.body_revision)) OR
 EXISTS(SELECT 1 FROM card_body_provenance p WHERE (p.owner_id,p.scope,p.project_id,p.card_id,p.body_revision)=(NEW.owner_id,NEW.scope,NEW.project_id,NEW.card_id,NEW.body_revision) AND
 (p.body_digest IS NOT NEW.body_digest OR p.completeness IS NOT NEW.completeness OR p.authorization_action IS NOT NEW.authorization_action OR (p.origin!=NEW.origin AND NOT(p.origin='user-authored' AND NEW.origin='derived')))) OR
 (NEW.completeness='complete' AND EXISTS(SELECT 1 FROM card_body_sources s WHERE (s.owner_id,s.scope,s.project_id,s.card_id,s.body_revision)=(NEW.owner_id,NEW.scope,NEW.project_id,NEW.card_id,NEW.body_revision) AND s.content_identity='')) OR
 (NEW.authorization_action IS NOT NULL AND NOT EXISTS(SELECT 1 FROM card_body_authorizations a WHERE (a.owner_id,a.host_action_id,a.scope,a.project_id,a.card_id,a.body_revision,a.body_digest)=(NEW.owner_id,NEW.authorization_action,NEW.scope,NEW.project_id,NEW.card_id,NEW.body_revision,NEW.body_digest) AND a.authorization_kind!='operation'))
 BEGIN SELECT RAISE(ABORT,'safety_header_invalid'); END;
CREATE TRIGGER safety_card_body_update BEFORE UPDATE ON private_cards
 WHEN (NEW.state IN ('draft','confirmed') AND (NEW.body_revision IS NULL OR NEW.body_revision<1)) OR
 EXISTS(SELECT 1 FROM card_body_provenance p WHERE (p.owner_id,p.scope,p.project_id,p.card_id)=(OLD.owner_id,OLD.scope,OLD.project_id,OLD.id) AND (NEW.body_revision IS NULL OR NEW.body_revision<p.body_revision)) OR
 (OLD.body_revision IS NOT NULL AND (NEW.body_revision IS NULL OR NEW.body_revision<OLD.body_revision)) OR
 (OLD.state IN ('draft','confirmed') AND NEW.state IN ('draft','confirmed') AND NEW.body_revision=OLD.body_revision AND (NEW.title IS NOT OLD.title OR NEW.body IS NOT OLD.body))
 BEGIN SELECT RAISE(ABORT,'safety_body_rollback'); END;
`;

export function authoredInvalidationDDL(base) {
  let sql;
  installCardMemoryInvalidation({exec:value=>{sql=value;}},base===33);
  return sql.replace(/UPDATE private_cards SET revision=revision\+1,updated_at=NEW.updated_at,[\s\S]*?\n      WHERE/,
    'UPDATE private_cards SET revision=revision+1,updated_at=NEW.updated_at\n      WHERE');
}
