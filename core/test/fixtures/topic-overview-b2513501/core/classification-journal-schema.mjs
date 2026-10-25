/** One bounded initial-capture attempt per admission claim; no source text. */
export function migrateVersion13(db) {
  db.exec(`CREATE TABLE capture_initial_classification (
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
  ) STRICT;`);
}
