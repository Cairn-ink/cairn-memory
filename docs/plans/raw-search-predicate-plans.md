# Raw search predicate plans

Historical predicate-plan observations: search now ranks before applying these predicates to returned candidates. The old full-store selection and eligibility memo have been removed. See [the interface](raw-search-interface.md) for default-on configuration and the current safety contract.

The synthetic 1,000- and 10,000-turn fixtures use the measurement seeder and its receipt, ancestry and suppression density. The predicate-plan tool runs on a functional clock. These are plan and call-count observations; timing gates remain unqualified. No predicate query is changed.

| Predicate path | 1K prepares | 10K prepares | Header prepares |
| --- | ---: | ---: | ---: |
| First linked row, inspect/check/select | 41 | 41 | 2 |
| First bare row, inspect/check/select | 20 | 20 | 2 |
| 32 checked rows in one unit | 980 | 1,188 | 33 |

The unit samples contain different mixes of linked sources and ancestors. Their averages are 30.625 and 37.125 prepares per checked row; they do not show a growth in SQL call count for an identical source shape. The header is read once per subsequent row, plus the first request-state header. `installedContentLayout` is a candidate for snapshot-scoped reuse: the header cannot change inside one canonical snapshot. Header reads account for 33/980 (3.37%) and 33/1,188 (2.78%) of prepare calls in these units. This estimates its call share, not its time share. It belongs to the safety owner.

The same 25 distinct statement texts and plans were observed at both sizes, across `inspectInside`, `checkInside`, linked/bare sources and selection. Every observed statement is listed below. Complete SQL and plan details can be reproduced with `tools/testing/raw-search-row-plans.mjs` and an owned measurement fixture.

| # | Statement | Plan |
| --- | --- | --- |
| 1 | `SELECT c.client,c.session_key,0 AS revision,m.ordinal,m.role,m.occurred_at,m.total_units,m.total_bytes FROM raw_conversations c JOIN raw_...` | SEARCH c USING INDEX sqlite_autoindex_raw_conversations_1 (id=?); SEARCH m USING INDEX sqlite_autoindex_raw_messages_1 (conversation_id=? AND message_id=?) |
| 2 | `SELECT 1 FROM raw_source_exclusions WHERE conversation_id=? AND message_id=? AND start<? AND end>?` | SEARCH raw_source_exclusions USING COVERING INDEX sqlite_autoindex_raw_source_exclusions_1 (conversation_id=? AND message_id=? AND start<?) |
| 3 | `SELECT start FROM raw_parts INDEXED BY raw_source_part_start WHERE conversation_id=? AND message_id=? AND start<=? ORDER BY start DESC LI...` | SEARCH raw_parts USING COVERING INDEX raw_source_part_start (conversation_id=? AND message_id=? AND start<?) |
| 4 | `SELECT conversation_id,message_id,part_index,start,end,byte_count,digest,event_id,saved,reason,format,key_version,length(sealed) AS seale...` | SEARCH raw_parts USING INDEX raw_source_part_start (conversation_id=? AND message_id=? AND start>? AND start<?) |
| 5 | `SELECT sealed FROM raw_parts WHERE conversation_id=? AND message_id=? AND part_index=?` | SEARCH raw_parts USING INDEX sqlite_autoindex_raw_parts_1 (conversation_id=? AND message_id=? AND part_index=?) |
| 6 | `SELECT 1 FROM raw_session_fences WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?` | SEARCH raw_session_fences USING COVERING INDEX sqlite_autoindex_raw_session_fences_1 (owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?) |
| 7 | `SELECT 1 FROM sqlite_master WHERE type='table' AND name='raw_conversations'` | SCAN sqlite_master |
| 8 | `SELECT 1 FROM raw_conversations c JOIN raw_messages m ON m.conversation_id=c.id WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND c...` | SEARCH c USING INDEX sqlite_autoindex_raw_conversations_1 (id=?); SEARCH m USING COVERING INDEX sqlite_autoindex_raw_messages_1 (conversation_id=? AND message_id=?) |
| 9 | `SELECT 1 FROM sqlite_master WHERE name='card_raw_bindings'` | SCAN sqlite_master |
| 10 | `SELECT schema_version AS cookie,(SELECT user_version FROM pragma_user_version) AS physical, (SELECT application_id FROM pragma_applicatio...` | SCAN pragma_schema_version VIRTUAL TABLE INDEX 0:; SCALAR SUBQUERY 1; SCAN pragma_user_version VIRTUAL TABLE INDEX 0:; SCALAR SUBQUERY 2; SCAN pragma_application_id VIRTUAL TABLE INDEX 0:; SCALAR SUBQUERY 3; SEARCH content_safety_control USING PRIMARY KEY (singleton=?) |
| 11 | `SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs WHERE owner_id=?` | SEARCH owner_suppression_epochs USING PRIMARY KEY (owner_id=?) |
| 12 | `SELECT * FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?...` | SEARCH content_suppressions USING INDEX content_suppression_target (owner_id=? AND scope=? AND project_id=? AND kind=? AND stable_key=? AND incarnation=?) |
| 13 | `SELECT * FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id)=(?,?,?) LIMIT ?` | SEARCH content_suppressions USING INDEX content_suppression_target (owner_id=? AND scope=? AND project_id=?) |
| 14 | `SELECT 1 FROM raw_source_maps WHERE conversation_id=? AND message_id=? LIMIT 1` | SEARCH raw_source_maps USING COVERING INDEX sqlite_autoindex_raw_source_maps_1 (conversation_id=? AND message_id=?) |
| 15 | `SELECT l.receipt_id,l.start,l.end,l.precision,r.memory_id,r.client,r.session_id,r.event_id,r.role,r.excerpt, m.id,m.revision,m.owner_id,m...` | SEARCH l USING INDEX raw_lineage_conversation (conversation_id=?); SEARCH r USING INDEX sqlite_autoindex_receipts_1 (id=?) LEFT-JOIN; SEARCH m USING INDEX sqlite_autoindex_memories_1 (id=?) LEFT-JOIN; SEARCH o USING INDEX sqlite_autoindex_raw_receipt_origins_1 (receipt_id=?) LEFT-JOIN; USE TEMP B-TREE FOR ORDER BY |
| 16 | `SELECT id,revision,deleted,currentness,review_state,EXISTS( SELECT 1 FROM receipts ar JOIN raw_receipt_lineage al ON al.receipt_id=ar.id ...` | SEARCH memories USING INDEX sqlite_autoindex_memories_1 (id=?); CORRELATED SCALAR SUBQUERY 1; SEARCH ar USING COVERING INDEX capture_memory_receipts (memory_id=?); SEARCH al USING COVERING INDEX sqlite_autoindex_raw_receipt_lineage_1 (receipt_id=?); SEARCH ac USING INDEX sqlite_autoindex_raw_conversations_1 (id=?) LEFT-JOIN |
| 17 | `SELECT * FROM receipts WHERE memory_id=? AND id=?` | SEARCH receipts USING INDEX sqlite_autoindex_receipts_1 (id=?) |
| 18 | `SELECT 1 FROM sqlite_master WHERE name='raw_source_maps'` | SCAN sqlite_master |
| 19 | `SELECT name FROM sqlite_master WHERE type='table' AND name IN (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)` | SCAN sqlite_master |
| 20 | `SELECT l.conversation_id AS conversationId,l.message_id AS messageId,l.start,l.end,l.precision, c.owner_id,c.scope,c.project_id,c.client,...` | SEARCH l USING INDEX sqlite_autoindex_raw_receipt_lineage_1 (receipt_id=?); SEARCH c USING INDEX sqlite_autoindex_raw_conversations_1 (id=?) LEFT-JOIN; SEARCH m USING INDEX sqlite_autoindex_raw_messages_1 (conversation_id=? AND message_id=?) LEFT-JOIN |
| 21 | `SELECT 1 FROM sqlite_master WHERE name='raw_session_fences'` | SCAN sqlite_master |
| 22 | `SELECT secret FROM episode_identity WHERE singleton=1` | SEARCH episode_identity USING INTEGER PRIMARY KEY (rowid=?) |
| 23 | `SELECT 1 FROM raw_source_exclusions WHERE conversation_id=? AND message_id=? AND start<? AND end>?` | SEARCH raw_source_exclusions USING COVERING INDEX sqlite_autoindex_raw_source_exclusions_1 (conversation_id=? AND message_id=? AND start<?) |
| 24 | `SELECT DISTINCT c.id AS conversationId,c.client,c.session_key AS sessionKey FROM raw_receipt_lineage l JOIN raw_conversations c ON c.id=l...` | SEARCH c USING INDEX sqlite_autoindex_raw_conversations_2 (owner_id=? AND scope=? AND project_id=?); SEARCH l USING COVERING INDEX raw_lineage_conversation (conversation_id=? AND receipt_id=?) |
| 25 | `SELECT r.id,r.session_id FROM receipts r JOIN memories m ON m.id=r.memory_id WHERE m.owner_id=? AND m.scope=? AND m.project_id=? AND r.cl...` | SEARCH m USING COVERING INDEX index_memory_keyset (owner_id=? AND scope=? AND project_id=?); SEARCH r USING INDEX capture_memory_receipts (memory_id=?); CORRELATED SCALAR SUBQUERY 1; SEARCH l USING COVERING INDEX sqlite_autoindex_raw_receipt_lineage_1 (receipt_id=? AND conversation_id=? AND message_id=?) |

The two growing range traversals are:

- Receipt roots: `rawSessionRoots.receipt` starts with the namespace prefix of `raw_conversations`, then probes `raw_lineage_conversation` for the receipt. This walks about 35 versus 350 conversations in these fixtures even for one receipt. A receipt-led traversal of the existing receipt primary-key prefix followed by conversation ID lookups would remove that namespace walk.
- Missing lineage: `inspectInside` starts with every Memory in the namespace, then probes `capture_memory_receipts` and filters client/event. This walks 200 versus 2,000 Memories. A receipt index led by client/event (with the Memory identity retained), followed by exact Memory and lineage lookups, would bound work to matching receipts.

The direct lineage query uses `raw_lineage_conversation` with only conversation ID as its seek bound and a temporary B-tree for `ORDER BY m.id`. Its sort grows with matching lineage, and its scanned prefix grows with a conversation. The standard fixtures keep ordinary conversations at 50 messages, so this is not itself a whole-store scan. A message/range-led index plus a bounded, equivalently ordered projection is a candidate; preserving the 1,025-row refusal boundary and complete ancestry needs a census and projection comparison before implementation.

Other `SCAN` entries are over `sqlite_master` or singleton PRAGMA virtual tables. They grow with schema objects rather than source population. The scoped suppression query is bounded by the existing 4,097-fact refusal boundary. Remaining seeks are exact identities or source/receipt-local ranges.

These plan shapes can explain increased per-row cost without increased statement counts. They do not establish how much of the observed latency each query contributes. Query changes, statement reuse and narrower hint invalidation require separate review.
