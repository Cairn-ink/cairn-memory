import { ASSET_SCHEMA_VERSION } from '../../../../core/asset-schema.mjs';
import { CARD_CURRENT_SCHEMA_VERSION } from '../../../../core/card-current-schema.mjs';
import { extendedReceiptDeclarations, lineageBaseDeclarations } from '../../../../core/card-lineage-base-schema.mjs';
import { CONFIRMATION_SCHEMA_VERSION } from '../../../../core/confirmation-schema.mjs';
import { LOCAL_RAW_PRIVACY_DDL, attestContentSafety, cardLineageRevision,
  contentSafetyDDL, receiptEventTimeEnabled } from '../../../../core/content-safety-schema.mjs';
import { validateContextProductLayout } from '../../../../core/context-product-schema.mjs';
import { LOCAL_AUTHORITY_SCHEMA_VERSION, LOCAL_BINDING_COLUMNS, validateLocalAuthority } from '../../../../core/local-authority-schema.mjs';
import { PRIVATE_CARD_SCHEMA_VERSION } from '../../../../core/private-card-schema.mjs';
import { PRIVATE_ORGANIZATION_SCHEMA_VERSION } from '../../../../core/private-organization-schema.mjs';
import { RAW_DELETION_SCHEMA_VERSION } from '../../../../core/raw-deletion-schema.mjs';
import { RAW_SOURCE_SCHEMA_VERSION } from '../../../../core/raw-source-schema.mjs';
import { LegacyRefusal } from './refusal.mjs';

const declaration = /(?:^|\n)\s*CREATE (?:UNIQUE )?(TABLE|INDEX|TRIGGER)(?: IF NOT EXISTS)? (\w+)\b/g;
// Compare SQL tokens, preserving quoted values and trigger statement boundaries.
const tokens = sql => JSON.stringify(sql.trim().replace(/;$/, '').match(
  /'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[\w]+|[^\s]/g));
const localPackage = new Map(LOCAL_RAW_PRIVACY_DDL.map(sql => {
  const canonical = sql.replace(' IF NOT EXISTS', '');
  const [, type, name] = [...canonical.matchAll(declaration)][0];
  return [name, { type: type.toLowerCase(), sql: canonical }];
}));
const namedObjects = lineageBaseDeclarations[CARD_CURRENT_SCHEMA_VERSION].map(row => ({
  ...row,
  // The base views apply to every supported layout. For indexes and
  // triggers, ON identifies the relation that brings them into scope.
  parent: row.type === 'table' ? row.name :
    row.type === 'view' ? null : /\bON\s+(\w+)/i.exec(row.sql)[1],
}));
const earlyCardInvalidation = lineageBaseDeclarations[PRIVATE_ORGANIZATION_SCHEMA_VERSION]
  .find(row => row.name === 'card_memory_revision_invalidation').sql;

function minimumVersion(name) {
  if (name === 'card_memory_revision_invalidation' || name === 'card_memory_purge') return PRIVATE_CARD_SCHEMA_VERSION;
  if (name === 'card_moc_card_insert' || name === 'card_moc_card_update') return PRIVATE_ORGANIZATION_SCHEMA_VERSION;
  if (name === 'sqlite_sequence' || name === 'raw_lineage_conversation') return RAW_DELETION_SCHEMA_VERSION;
  if (name === 'raw_source_part_start' || name === 'card_raw_purge') return RAW_SOURCE_SCHEMA_VERSION;
  if (name.startsWith('local_capture_binding_')) return LOCAL_AUTHORITY_SCHEMA_VERSION;
  if (name.startsWith('method_binary_')) return ASSET_SCHEMA_VERSION;
  if (name.startsWith('card_current_')) return CARD_CURRENT_SCHEMA_VERSION;
  return 0;
}

function canonicalSQL(row, layout) {
  if (row.name === 'card_memory_revision_invalidation' && layout.base < RAW_SOURCE_SCHEMA_VERSION) {
    return earlyCardInvalidation;
  }
  if (row.name === 'raw_capture_events' && !layout.localControls) {
    return LOCAL_BINDING_COLUMNS.reduce((sql, column) => sql.replace(', ' + column + ' TEXT', ''), row.sql);
  }
  if (row.name === 'receipts' && receiptEventTimeEnabled(layout)) {
    // The engine's Card lineage catalogue omits the no-Card safety family.
    // Its receipt-time installer applies the same ALTER TABLE to base 18.
    return layout.base === CONFIRMATION_SCHEMA_VERSION
      ? row.sql.replace('created_at TEXT NOT NULL,', 'created_at TEXT NOT NULL, occurred_at TEXT,')
      : extendedReceiptDeclarations[layout.base];
  }
  return row.sql;
}

export function attestLegacySchema(db, physical) {
  const layout = attestContentSafety(db, physical);
  validateContextProductLayout(db, layout);
  if (layout.localControls) validateLocalAuthority(db);

  const actual = new Map(db.prepare('SELECT name,type,sql FROM sqlite_schema WHERE sql IS NOT NULL')
    .all().map(row => [row.name, row]));
  const matches = (row, expected, sql = expected.sql) =>
    row?.type === expected.type && tokens(row.sql) === tokens(sql);
  const localRawPrivacy = [...actual.keys()].some(name => localPackage.has(name));
  if (localRawPrivacy && (!layout.localControls ||
      [...localPackage].some(([name, expected]) => !matches(actual.get(name), expected)))) {
    throw new LegacyRefusal('legacy_incomplete');
  }
  // The engine already checks the complete inherited + safety schema for the
  // lineage-attested package. Other engine openers check a subset of base DDL.
  if (cardLineageRevision(layout) === 1) return { layout, localRawPrivacy };

  const wanted = new Set(localRawPrivacy ? localPackage.keys() : []);
  if (layout.suppressionRevision) {
    const ddl = contentSafetyDDL(layout.base, receiptEventTimeEnabled(layout), layout.attestedFeatures);
    for (const [, , name] of ddl.matchAll(declaration)) wanted.add(name);
  }
  for (const row of namedObjects) {
    // The engine's product validator already checks table introduction. SQL
    // here closes extra objects and missing or altered attached guards/indexes.
    if ((row.parent && row.name !== 'sqlite_sequence' && !actual.has(row.parent)) ||
        layout.base < minimumVersion(row.name)) continue;
    wanted.add(row.name);
    if (!matches(actual.get(row.name), row, canonicalSQL(row, layout))) throw new LegacyRefusal('legacy_incomplete');
  }
  if (actual.size !== wanted.size || [...actual.keys()].some(name => !wanted.has(name))) {
    throw new LegacyRefusal('legacy_incomplete');
  }
  return { layout, localRawPrivacy };
}
