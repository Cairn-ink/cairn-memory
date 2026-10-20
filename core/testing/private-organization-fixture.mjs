// Synthetic test layout construction only. Never used by a runtime migration.
export function stripOrganizationFixture(db) {
  db.exec(`DROP TRIGGER card_moc_card_insert; DROP TRIGGER card_moc_card_update;
    DROP TABLE evidence_mappings; DROP TABLE card_moc_edges; DROP TABLE card_moc_refs;
    DROP TABLE card_moc_title_sources; DROP TABLE card_mocs; DROP TABLE card_moc_epochs;`);
}
