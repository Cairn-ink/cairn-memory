export const PRIVATE_EVIDENCE_SCHEMA_VERSION = 22;

// Additive after v21 receipt support. A review never applies to another revision.
export function installPrivateEvidence(db) {
  db.exec(`CREATE TABLE card_applicability_reviews (
    card_id TEXT PRIMARY KEY REFERENCES private_cards(id),
    reviewed_revision INTEGER NOT NULL CHECK(reviewed_revision>0),
    applicability TEXT NOT NULL CHECK(applicability IN ('current','historical','conflict','unknown'))
  ) STRICT;`);
}

export function cardApplicabilityInside(db, row) {
  const review = db.prepare('SELECT reviewed_revision,applicability FROM card_applicability_reviews WHERE card_id=?').get(row.id);
  return review?.reviewed_revision === row.revision ?
    { applicability: review.applicability, reviewedRevision: review.reviewed_revision } :
    { applicability: 'unknown', reviewedRevision: null };
}

export function reviewCardApplicabilityInside(db, id, revision, applicability) {
  db.prepare(`INSERT INTO card_applicability_reviews VALUES(?,?,?) ON CONFLICT(card_id)
    DO UPDATE SET reviewed_revision=excluded.reviewed_revision,applicability=excluded.applicability`)
    .run(id, revision, applicability);
}
