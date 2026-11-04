import { attestContentSafety } from './content-safety-schema.mjs';
import { fail } from './validation.mjs';

// Product-only metadata attestation. These shapes come from the canonical
// installers at each accepted version; no canonical content is read or repaired.
// All version-boundary tables must exist exactly at their introduction. Full
// columns and seek indexes cover Memory evidence, Card support/Raw sources and
// v33 current-dependency resolution (including method/asset metadata).
const tables = {
  "admission_claims": 18,
  "capture_events": 18,
  "capture_initial_classification": 18,
  "capture_streams": 18,
  "confirmation_actions": 18,
  "confirmation_conflicts": 18,
  "confirmation_supersessions": 18,
  "episode_attempts": 18,
  "episode_controls": 18,
  "episode_events": 18,
  "episode_identity": 18,
  "episode_keep_actions": 18,
  "episode_memory_links": 18,
  "episode_messages": 18,
  "episode_sources": 18,
  "index_edges": 18,
  "index_generations": 18,
  "index_memories": 18,
  "index_memory_refs": 18,
  "index_mocs": 18,
  "index_title_sources": 18,
  "memories": 18,
  "memory_conflicts": 18,
  "memory_qualifications": 18,
  "memory_supersessions": 18,
  "moc_edges": 18,
  "moc_memory_refs": 18,
  "moc_title_sources": 18,
  "mocs": 18,
  "namespace_epochs": 18,
  "namespace_index_state": 18,
  "procedural_tags": 18,
  "qualification_anchors": 18,
  "qualified_claim_bindings": 18,
  "qualified_slots": 18,
  "rationale_edges": 18,
  "receipt_causality": 18,
  "receipts": 18,
  "session_episodes": 18,
  "staged_capture_clocks": 18,
  "staged_capture_evidence": 18,
  "store_metadata": 18,
  "suppressed": 18,
  "card_bindings": 20,
  "card_effects": 20,
  "card_epochs": 20,
  "card_note_usage": 20,
  "card_notes": 20,
  "card_operations": 20,
  "private_cards": 20,
  "card_memory_bindings": 21,
  "card_applicability_reviews": 22,
  "card_moc_edges": 23,
  "card_moc_epochs": 23,
  "card_moc_refs": 23,
  "card_moc_title_sources": 23,
  "card_mocs": 23,
  "evidence_mappings": 23,
  "raw_capture_controls": 24,
  "raw_conversations": 24,
  "raw_events": 24,
  "raw_messages": 24,
  "raw_owner_usage": 24,
  "raw_parts": 24,
  "raw_capture_events": 25,
  "raw_session_fences": 25,
  "raw_exclusion_clocks": 26,
  "raw_receipt_lineage": 26,
  "raw_receipt_origins": 26,
  "raw_source_exclusions": 26,
  "raw_source_maps": 26,
  "raw_closed_jobs": 27,
  "raw_deletion_actions": 27,
  "raw_deletion_effects": 27,
  "raw_job_sources": 27,
  "card_raw_bindings": 28,
  "card_raw_mutation_context": 28,
  "card_raw_pending_invalidations": 28,
  "local_capture_controls": 29,
  "method_binding_events": 30,
  "method_binding_generations": 30,
  "method_bindings": 30,
  "method_changes": 30,
  "method_effects": 30,
  "method_epochs": 30,
  "method_files": 30,
  "method_operations": 30,
  "method_owner_usage": 30,
  "method_packages": 30,
  "method_versions": 30,
  "asset_derivatives": 31,
  "asset_effects": 31,
  "asset_epochs": 31,
  "asset_operations": 31,
  "asset_versions": 31,
  "assets": 31,
  "binary_chunks": 31,
  "binary_objects": 31,
  "binary_owner_usage": 31,
  "method_manifest_formats": 31,
  "method_mixed_entries": 31,
  "role_profile_changes": 32,
  "role_profile_epochs": 32,
  "role_profile_events": 32,
  "role_profile_operations": 32,
  "role_profile_owner_usage": 32,
  "role_profile_releases": 32,
  "role_profiles": 32,
  "card_current_dependencies": 33
};
const layouts = {
  memories: [[18,{"columns":[["id","TEXT",1,1],["owner_id","TEXT",1,0],["scope","TEXT",1,0],["project_id","TEXT",1,0],["fingerprint","TEXT",1,0],["content","TEXT",0,0],["kind","TEXT",1,0],["origin","TEXT",1,0],["confidence","REAL",1,0],["revision","INTEGER",1,0],["deleted","INTEGER",1,0],["created_at","TEXT",1,0],["updated_at","TEXT",1,0],["filing_status","TEXT",1,0],["currentness","TEXT",1,0],["review_state","TEXT",1,0]],"indexes":[{"name":"active_identity","unique":1,"origin":"c","partial":1,"predicate":["deleted","=","0"],"keys":[["owner_id",0,"BINARY"],["scope",0,"BINARY"],["project_id",0,"BINARY"],["fingerprint",0,"BINARY"]]},{"name":"capture_current_memories","unique":0,"origin":"c","partial":1,"predicate":["deleted","=","0","and","currentness","=","'current'"],"keys":[["owner_id",0,"BINARY"],["scope",0,"BINARY"],["project_id",0,"BINARY"],["id",0,"BINARY"]]},{"name":"index_memory_keyset","unique":0,"origin":"c","partial":0,"keys":[["owner_id",0,"BINARY"],["scope",0,"BINARY"],["project_id",0,"BINARY"],["id",0,"BINARY"]]},{"name":"namespace_memories","unique":0,"origin":"c","partial":0,"keys":[["owner_id",0,"BINARY"],["scope",0,"BINARY"],["project_id",0,"BINARY"],["deleted",0,"BINARY"],["updated_at",1,"BINARY"],["id",0,"BINARY"]]},{"name":"sqlite_autoindex_memories_1","unique":1,"origin":"pk","partial":0,"keys":[["id",0,"BINARY"]]}]}]],
  memory_qualifications: [[18,{"columns":[["memory_id","TEXT",1,1],["version","INTEGER",1,0],["bound_revision","INTEGER",1,0],["content_digest","TEXT",1,0],["subject","TEXT",0,0],["property","TEXT",0,0],["scope","TEXT",0,0],["applies","TEXT",0,0],["value","TEXT",0,0],["attribution","TEXT",1,0],["commitment","TEXT",1,0],["anchor_count","INTEGER",1,0]],"indexes":[{"name":"sqlite_autoindex_memory_qualifications_1","unique":1,"origin":"pk","partial":0,"keys":[["memory_id",0,"BINARY"]]}]}]],
  namespace_epochs: [[18,{"columns":[["owner_id","TEXT",1,1],["scope","TEXT",1,2],["project_id","TEXT",1,3],["epoch","INTEGER",1,0]],"indexes":[{"name":"sqlite_autoindex_namespace_epochs_1","unique":1,"origin":"pk","partial":0,"keys":[["owner_id",0,"BINARY"],["scope",0,"BINARY"],["project_id",0,"BINARY"]]}]}]],
  qualification_anchors: [[18,{"columns":[["memory_id","TEXT",1,1],["ordinal","INTEGER",1,2],["receipt_id","TEXT",1,0],["receipt_digest","TEXT",1,0],["start","INTEGER",1,0],["end","INTEGER",1,0],["fields","TEXT",1,0]],"indexes":[{"name":"qualification_receipts","unique":0,"origin":"c","partial":0,"keys":[["receipt_id",0,"BINARY"]]},{"name":"sqlite_autoindex_qualification_anchors_1","unique":1,"origin":"pk","partial":0,"keys":[["memory_id",0,"BINARY"],["ordinal",0,"BINARY"]]}]}]],
  receipts: [[18,{"columns":[["id","TEXT",1,0],["memory_id","TEXT",1,1],["receipt_key","TEXT",1,2],["client","TEXT",1,0],["session_id","TEXT",1,0],["event_id","TEXT",1,0],["role","TEXT",1,0],["excerpt","TEXT",1,0],["created_at","TEXT",1,0]],"indexes":[{"name":"capture_memory_receipts","unique":0,"origin":"c","partial":0,"keys":[["memory_id",0,"BINARY"],["id",0,"BINARY"]]},{"name":"memory_receipts","unique":0,"origin":"c","partial":0,"keys":[["memory_id",0,"BINARY"],["created_at",0,"BINARY"],["id",0,"BINARY"]]},{"name":"receipt_time_read","unique":0,"origin":"c","partial":0,"keys":[["created_at",1,"BINARY"],["id",0,"BINARY"],["memory_id",0,"BINARY"]]},{"name":"sqlite_autoindex_receipts_1","unique":1,"origin":"u","partial":0,"keys":[["id",0,"BINARY"]]},{"name":"sqlite_autoindex_receipts_2","unique":1,"origin":"pk","partial":0,"keys":[["memory_id",0,"BINARY"],["receipt_key",0,"BINARY"]]}]}]],
  store_metadata: [[18,{"columns":[["singleton","INTEGER",0,1],["store_id","TEXT",1,0],["cursor_secret","TEXT",1,0]],"indexes":[{"name":"sqlite_autoindex_store_metadata_1","unique":1,"origin":"u","partial":0,"keys":[["store_id",0,"BINARY"]]}]}]],
  card_bindings: [[20,{"columns":[["card_id","TEXT",1,1],["source_id","TEXT",1,2],["source_ref","TEXT",1,0],["position","INTEGER",1,0]],"indexes":[{"name":"card_source_dependents","unique":0,"origin":"c","partial":0,"keys":[["source_id",0,"BINARY"],["card_id",0,"BINARY"]]},{"name":"sqlite_autoindex_card_bindings_1","unique":1,"origin":"pk","partial":0,"keys":[["card_id",0,"BINARY"],["source_id",0,"BINARY"]]}]}]],
  card_epochs: [[20,{"columns":[["owner_id","TEXT",1,1],["scope","TEXT",1,2],["project_id","TEXT",1,3],["generation","INTEGER",1,0]],"indexes":[{"name":"sqlite_autoindex_card_epochs_1","unique":1,"origin":"pk","partial":0,"keys":[["owner_id",0,"BINARY"],["scope",0,"BINARY"],["project_id",0,"BINARY"]]}]}]],
  card_notes: [[20,{"columns":[["id","TEXT",1,1],["owner_id","TEXT",1,0],["scope","TEXT",1,0],["project_id","TEXT",1,0],["revision","INTEGER",1,0],["state","TEXT",1,0],["text","TEXT",0,0],["byte_count","INTEGER",1,0],["occurred_at","TEXT",0,0],["received_at","TEXT",1,0]],"indexes":[{"name":"card_note_scope","unique":0,"origin":"c","partial":0,"keys":[["owner_id",0,"BINARY"],["scope",0,"BINARY"],["project_id",0,"BINARY"],["id",0,"BINARY"]]},{"name":"sqlite_autoindex_card_notes_1","unique":1,"origin":"pk","partial":0,"keys":[["id",0,"BINARY"]]}]}]],
  private_cards: [[20,{"columns":[["id","TEXT",1,1],["owner_id","TEXT",1,0],["scope","TEXT",1,0],["project_id","TEXT",1,0],["revision","INTEGER",1,0],["state","TEXT",1,0],["title","TEXT",0,0],["body","TEXT",0,0],["body_revision","INTEGER",0,0],["created_at","TEXT",1,0],["updated_at","TEXT",1,0],["confirmed_at","TEXT",0,0]],"indexes":[{"name":"private_card_scope","unique":0,"origin":"c","partial":0,"keys":[["owner_id",0,"BINARY"],["scope",0,"BINARY"],["project_id",0,"BINARY"],["state",0,"BINARY"],["id",0,"BINARY"]]},{"name":"sqlite_autoindex_private_cards_1","unique":1,"origin":"pk","partial":0,"keys":[["id",0,"BINARY"]]}]}]],
  card_memory_bindings: [[21,{"columns":[["card_id","TEXT",1,1],["memory_id","TEXT",1,0],["memory_revision","INTEGER",1,0],["receipt_id","TEXT",1,2],["source_ref","TEXT",1,0],["position","INTEGER",1,0]],"indexes":[{"name":"card_memory_dependents","unique":0,"origin":"c","partial":0,"keys":[["memory_id",0,"BINARY"],["card_id",0,"BINARY"]]},{"name":"card_receipt_dependents","unique":0,"origin":"c","partial":0,"keys":[["receipt_id",0,"BINARY"],["card_id",0,"BINARY"]]},{"name":"sqlite_autoindex_card_memory_bindings_1","unique":1,"origin":"pk","partial":0,"keys":[["card_id",0,"BINARY"],["receipt_id",0,"BINARY"]]}]}]],
  card_applicability_reviews: [[22,{"columns":[["card_id","TEXT",1,1],["reviewed_revision","INTEGER",1,0],["applicability","TEXT",1,0]],"indexes":[{"name":"sqlite_autoindex_card_applicability_reviews_1","unique":1,"origin":"pk","partial":0,"keys":[["card_id",0,"BINARY"]]}]}]],
  raw_conversations: [[24,{"columns":[["id","TEXT",1,1],["owner_id","TEXT",1,0],["scope","TEXT",1,0],["project_id","TEXT",1,0],["client","TEXT",1,0],["session_key","TEXT",1,0],["revision","INTEGER",1,0],["first_received_at","TEXT",1,0],["last_received_at","TEXT",1,0]],"indexes":[{"name":"sqlite_autoindex_raw_conversations_1","unique":1,"origin":"pk","partial":0,"keys":[["id",0,"BINARY"]]},{"name":"sqlite_autoindex_raw_conversations_2","unique":1,"origin":"u","partial":0,"keys":[["owner_id",0,"BINARY"],["scope",0,"BINARY"],["project_id",0,"BINARY"],["client",0,"BINARY"],["session_key",0,"BINARY"]]}]}]],
  raw_messages: [[24,{"columns":[["conversation_id","TEXT",1,1],["message_id","TEXT",1,2],["ordinal","INTEGER",1,0],["role","TEXT",1,0],["occurred_at","TEXT",0,0],["total_units","INTEGER",1,0],["total_bytes","INTEGER",1,0],["next_index","INTEGER",1,0],["next_start","INTEGER",1,0],["received_bytes","INTEGER",1,0],["assembly_state","TEXT",1,0],["reason","TEXT",0,0],["reserved_bytes","INTEGER",1,0],["first_event_id","TEXT",1,0]],"indexes":[{"name":"sqlite_autoindex_raw_messages_1","unique":1,"origin":"pk","partial":0,"keys":[["conversation_id",0,"BINARY"],["message_id",0,"BINARY"]]},{"name":"sqlite_autoindex_raw_messages_2","unique":1,"origin":"u","partial":0,"keys":[["conversation_id",0,"BINARY"],["ordinal",0,"BINARY"]]}]}]],
  raw_parts: [[24,{"columns":[["conversation_id","TEXT",1,1],["message_id","TEXT",1,2],["part_index","INTEGER",1,3],["start","INTEGER",1,0],["end","INTEGER",1,0],["byte_count","INTEGER",1,0],["digest","TEXT",1,0],["event_id","TEXT",1,0],["saved","INTEGER",1,0],["reason","TEXT",0,0],["format","TEXT",0,0],["key_version","TEXT",0,0],["sealed","BLOB",0,0]],"indexes":[{"name":"sqlite_autoindex_raw_parts_1","unique":1,"origin":"pk","partial":0,"keys":[["conversation_id",0,"BINARY"],["message_id",0,"BINARY"],["part_index",0,"BINARY"]]}]}],[28,{"columns":[["conversation_id","TEXT",1,1],["message_id","TEXT",1,2],["part_index","INTEGER",1,3],["start","INTEGER",1,0],["end","INTEGER",1,0],["byte_count","INTEGER",1,0],["digest","TEXT",1,0],["event_id","TEXT",1,0],["saved","INTEGER",1,0],["reason","TEXT",0,0],["format","TEXT",0,0],["key_version","TEXT",0,0],["sealed","BLOB",0,0]],"indexes":[{"name":"raw_source_part_start","unique":0,"origin":"c","partial":0,"keys":[["conversation_id",0,"BINARY"],["message_id",0,"BINARY"],["start",0,"BINARY"]]},{"name":"sqlite_autoindex_raw_parts_1","unique":1,"origin":"pk","partial":0,"keys":[["conversation_id",0,"BINARY"],["message_id",0,"BINARY"],["part_index",0,"BINARY"]]}]}]],
  raw_exclusion_clocks: [[26,{"columns":[["owner_id","TEXT",1,1],["scope","TEXT",1,2],["project_id","TEXT",1,3],["generation","INTEGER",1,0]],"indexes":[{"name":"sqlite_autoindex_raw_exclusion_clocks_1","unique":1,"origin":"pk","partial":0,"keys":[["owner_id",0,"BINARY"],["scope",0,"BINARY"],["project_id",0,"BINARY"]]}]}]],
  raw_receipt_lineage: [[26,{"columns":[["receipt_id","TEXT",1,1],["conversation_id","TEXT",1,2],["message_id","TEXT",1,3],["start","INTEGER",1,4],["end","INTEGER",1,5],["precision","TEXT",1,0]],"indexes":[{"name":"sqlite_autoindex_raw_receipt_lineage_1","unique":1,"origin":"pk","partial":0,"keys":[["receipt_id",0,"BINARY"],["conversation_id",0,"BINARY"],["message_id",0,"BINARY"],["start",0,"BINARY"],["end",0,"BINARY"]]}]}],[27,{"columns":[["receipt_id","TEXT",1,1],["conversation_id","TEXT",1,2],["message_id","TEXT",1,3],["start","INTEGER",1,4],["end","INTEGER",1,5],["precision","TEXT",1,0]],"indexes":[{"name":"raw_lineage_conversation","unique":0,"origin":"c","partial":0,"keys":[["conversation_id",0,"BINARY"],["receipt_id",0,"BINARY"]]},{"name":"sqlite_autoindex_raw_receipt_lineage_1","unique":1,"origin":"pk","partial":0,"keys":[["receipt_id",0,"BINARY"],["conversation_id",0,"BINARY"],["message_id",0,"BINARY"],["start",0,"BINARY"],["end",0,"BINARY"]]}]}]],
  raw_source_exclusions: [[26,{"columns":[["conversation_id","TEXT",1,1],["message_id","TEXT",1,2],["start","INTEGER",1,3],["end","INTEGER",1,4],["generation","INTEGER",1,0]],"indexes":[{"name":"sqlite_autoindex_raw_source_exclusions_1","unique":1,"origin":"pk","partial":0,"keys":[["conversation_id",0,"BINARY"],["message_id",0,"BINARY"],["start",0,"BINARY"],["end",0,"BINARY"]]}]}]],
  card_raw_bindings: [[28,{"columns":[["card_id","TEXT",1,1],["binding_id","TEXT",1,2],["conversation_id","TEXT",1,0],["message_id","TEXT",1,0],["start","INTEGER",1,0],["end","INTEGER",1,0],["source_ref","TEXT",1,0],["position","INTEGER",1,0]],"indexes":[{"name":"card_raw_dependents","unique":0,"origin":"c","partial":0,"keys":[["conversation_id",0,"BINARY"],["card_id",0,"BINARY"],["message_id",0,"BINARY"],["start",0,"BINARY"],["end",0,"BINARY"]]},{"name":"sqlite_autoindex_card_raw_bindings_1","unique":1,"origin":"pk","partial":0,"keys":[["card_id",0,"BINARY"],["binding_id",0,"BINARY"]]}]}]],
  method_binding_events: [[30,{"columns":[["event_id","TEXT",1,1],["owner_id","TEXT",1,0],["scope","TEXT",1,0],["project_id","TEXT",1,0],["package_id","TEXT",1,0],["role_key","TEXT",1,0],["kind","TEXT",1,0],["revision","INTEGER",1,0],["generation","INTEGER",1,0],["state","TEXT",1,0],["version_id","TEXT",0,0],["manifest_identity","TEXT",0,0],["action_id","TEXT",1,0],["created_at","TEXT",1,0],["reason_refs","TEXT",1,0],["ordinal","INTEGER",1,0]],"indexes":[{"name":"method_binding_event_generation","unique":1,"origin":"c","partial":0,"keys":[["owner_id",0,"BINARY"],["scope",0,"BINARY"],["project_id",0,"BINARY"],["package_id",0,"BINARY"],["generation",0,"BINARY"]]},{"name":"method_binding_event_package","unique":0,"origin":"c","partial":0,"keys":[["owner_id",0,"BINARY"],["scope",0,"BINARY"],["project_id",0,"BINARY"],["package_id",0,"BINARY"],["ordinal",0,"BINARY"]]},{"name":"method_binding_event_revision","unique":1,"origin":"c","partial":0,"keys":[["owner_id",0,"BINARY"],["scope",0,"BINARY"],["project_id",0,"BINARY"],["package_id",0,"BINARY"],["role_key",0,"BINARY"],["revision",0,"BINARY"]]},{"name":"method_binding_event_scope","unique":0,"origin":"c","partial":0,"keys":[["owner_id",0,"BINARY"],["scope",0,"BINARY"],["project_id",0,"BINARY"],["ordinal",0,"BINARY"]]},{"name":"sqlite_autoindex_method_binding_events_1","unique":1,"origin":"pk","partial":0,"keys":[["event_id",0,"BINARY"]]},{"name":"sqlite_autoindex_method_binding_events_2","unique":1,"origin":"u","partial":0,"keys":[["ordinal",0,"BINARY"]]}]}]],
  method_binding_generations: [[30,{"columns":[["owner_id","TEXT",1,1],["scope","TEXT",1,2],["project_id","TEXT",1,3],["package_id","TEXT",1,4],["generation","INTEGER",1,0]],"indexes":[{"name":"sqlite_autoindex_method_binding_generations_1","unique":1,"origin":"pk","partial":0,"keys":[["owner_id",0,"BINARY"],["scope",0,"BINARY"],["project_id",0,"BINARY"],["package_id",0,"BINARY"]]}]}]],
  method_bindings: [[30,{"columns":[["owner_id","TEXT",1,1],["scope","TEXT",1,2],["project_id","TEXT",1,3],["package_id","TEXT",1,4],["role_key","TEXT",1,5],["state","TEXT",1,0],["version_id","TEXT",0,0],["manifest_identity","TEXT",0,0],["revision","INTEGER",1,0],["generation","INTEGER",1,0],["created_at","TEXT",1,0],["updated_at","TEXT",1,0]],"indexes":[{"name":"sqlite_autoindex_method_bindings_1","unique":1,"origin":"pk","partial":0,"keys":[["owner_id",0,"BINARY"],["scope",0,"BINARY"],["project_id",0,"BINARY"],["package_id",0,"BINARY"],["role_key",0,"BINARY"]]}]}]],
  method_changes: [[30,{"columns":[["to_id","TEXT",1,1],["from_ref","TEXT",0,0],["to_ref","TEXT",1,0],["items","TEXT",1,0],["reason_refs","TEXT",1,0]],"indexes":[{"name":"sqlite_autoindex_method_changes_1","unique":1,"origin":"pk","partial":0,"keys":[["to_id",0,"BINARY"]]}]}]],
  method_effects: [[30,{"columns":[["effect_id","TEXT",1,1],["owner_id","TEXT",1,0],["scope","TEXT",1,0],["project_id","TEXT",1,0],["kind","TEXT",1,0],["entity_type","TEXT",1,0],["entity_id","TEXT",1,0],["revision","INTEGER",1,0],["action_id","TEXT",1,0],["ordinal","INTEGER",1,0]],"indexes":[{"name":"method_effect_scope","unique":0,"origin":"c","partial":0,"keys":[["owner_id",0,"BINARY"],["scope",0,"BINARY"],["project_id",0,"BINARY"],["ordinal",0,"BINARY"]]},{"name":"sqlite_autoindex_method_effects_1","unique":1,"origin":"pk","partial":0,"keys":[["effect_id",0,"BINARY"]]},{"name":"sqlite_autoindex_method_effects_2","unique":1,"origin":"u","partial":0,"keys":[["ordinal",0,"BINARY"]]}]}]],
  method_epochs: [[30,{"columns":[["owner_id","TEXT",1,1],["scope","TEXT",1,2],["project_id","TEXT",1,3],["generation","INTEGER",1,0]],"indexes":[{"name":"sqlite_autoindex_method_epochs_1","unique":1,"origin":"pk","partial":0,"keys":[["owner_id",0,"BINARY"],["scope",0,"BINARY"],["project_id",0,"BINARY"]]}]}]],
  method_files: [[30,{"columns":[["version_id","TEXT",1,1],["position","INTEGER",1,2],["path","TEXT",1,0],["text","TEXT",1,0],["byte_count","INTEGER",1,0],["content_identity","TEXT",1,0],["media_type","TEXT",1,0]],"indexes":[{"name":"sqlite_autoindex_method_files_1","unique":1,"origin":"pk","partial":0,"keys":[["version_id",0,"BINARY"],["position",0,"BINARY"]]},{"name":"sqlite_autoindex_method_files_2","unique":1,"origin":"u","partial":0,"keys":[["version_id",0,"BINARY"],["path",0,"BINARY"]]}]}]],
  method_operations: [[30,{"columns":[["owner_id","TEXT",1,1],["scope","TEXT",1,2],["project_id","TEXT",1,3],["action_id","TEXT",1,4],["method","TEXT",1,0],["payload_binding","TEXT",1,0],["target_id","TEXT",1,0],["result","TEXT",1,0],["created_at","TEXT",1,0]],"indexes":[{"name":"sqlite_autoindex_method_operations_1","unique":1,"origin":"pk","partial":0,"keys":[["owner_id",0,"BINARY"],["scope",0,"BINARY"],["project_id",0,"BINARY"],["action_id",0,"BINARY"]]}]}]],
  method_owner_usage: [[30,{"columns":[["owner_id","TEXT",1,1],["byte_count","INTEGER",1,0]],"indexes":[{"name":"sqlite_autoindex_method_owner_usage_1","unique":1,"origin":"pk","partial":0,"keys":[["owner_id",0,"BINARY"]]}]}]],
  method_packages: [[30,{"columns":[["id","TEXT",1,1],["owner_id","TEXT",1,0],["scope","TEXT",1,0],["project_id","TEXT",1,0],["state","TEXT",1,0],["revision","INTEGER",1,0],["next_ordinal","INTEGER",1,0],["created_at","TEXT",1,0],["updated_at","TEXT",1,0]],"indexes":[{"name":"method_package_scope","unique":0,"origin":"c","partial":0,"keys":[["owner_id",0,"BINARY"],["scope",0,"BINARY"],["project_id",0,"BINARY"],["id",0,"BINARY"]]},{"name":"sqlite_autoindex_method_packages_1","unique":1,"origin":"pk","partial":0,"keys":[["id",0,"BINARY"]]}]}]],
  method_versions: [[30,{"columns":[["id","TEXT",1,1],["package_id","TEXT",1,0],["ordinal","INTEGER",1,0],["based_on","TEXT",0,0],["manifest_identity","TEXT",1,0],["state","TEXT",1,0],["revision","INTEGER",1,0],["title","TEXT",0,0],["submitted_by","TEXT",0,0],["imported_at","TEXT",1,0],["byte_count","INTEGER",1,0]],"indexes":[{"name":"method_version_ref","unique":1,"origin":"c","partial":0,"keys":[["package_id",0,"BINARY"],["id",0,"BINARY"],["manifest_identity",0,"BINARY"]]},{"name":"sqlite_autoindex_method_versions_1","unique":1,"origin":"pk","partial":0,"keys":[["id",0,"BINARY"]]},{"name":"sqlite_autoindex_method_versions_2","unique":1,"origin":"u","partial":0,"keys":[["package_id",0,"BINARY"],["ordinal",0,"BINARY"]]}]}]],
  asset_derivatives: [[31,{"columns":[["id","TEXT",1,1],["version_id","TEXT",1,0],["source_identity","TEXT",1,0],["state","TEXT",1,0],["revision","INTEGER",1,0],["kind","TEXT",0,0],["text","TEXT",0,0],["content_identity","TEXT",1,0],["provenance","TEXT",0,0],["language","TEXT",0,0],["timecodes","TEXT",0,0],["byte_count","INTEGER",1,0],["created_at","TEXT",1,0]],"indexes":[{"name":"asset_derivative_source","unique":0,"origin":"c","partial":0,"keys":[["version_id",0,"BINARY"],["id",0,"BINARY"]]},{"name":"sqlite_autoindex_asset_derivatives_1","unique":1,"origin":"pk","partial":0,"keys":[["id",0,"BINARY"]]}]}]],
  asset_epochs: [[31,{"columns":[["owner_id","TEXT",1,1],["scope","TEXT",1,2],["project_id","TEXT",1,3],["generation","INTEGER",1,0]],"indexes":[{"name":"sqlite_autoindex_asset_epochs_1","unique":1,"origin":"pk","partial":0,"keys":[["owner_id",0,"BINARY"],["scope",0,"BINARY"],["project_id",0,"BINARY"]]}]}]],
  asset_versions: [[31,{"columns":[["id","TEXT",1,1],["asset_id","TEXT",1,0],["ordinal","INTEGER",1,0],["content_identity","TEXT",1,0],["state","TEXT",1,0],["revision","INTEGER",1,0],["title","TEXT",0,0],["filename","TEXT",0,0],["media_type","TEXT",0,0],["byte_count","INTEGER",1,0],["object_id","TEXT",0,0],["imported_at","TEXT",1,0]],"indexes":[{"name":"asset_version_parent","unique":0,"origin":"c","partial":0,"keys":[["asset_id",0,"BINARY"],["ordinal",0,"BINARY"]]},{"name":"sqlite_autoindex_asset_versions_1","unique":1,"origin":"pk","partial":0,"keys":[["id",0,"BINARY"]]},{"name":"sqlite_autoindex_asset_versions_2","unique":1,"origin":"u","partial":0,"keys":[["object_id",0,"BINARY"]]},{"name":"sqlite_autoindex_asset_versions_3","unique":1,"origin":"u","partial":0,"keys":[["asset_id",0,"BINARY"],["ordinal",0,"BINARY"]]},{"name":"sqlite_autoindex_asset_versions_4","unique":1,"origin":"u","partial":0,"keys":[["id",0,"BINARY"],["content_identity",0,"BINARY"]]}]}]],
  assets: [[31,{"columns":[["id","TEXT",1,1],["owner_id","TEXT",1,0],["scope","TEXT",1,0],["project_id","TEXT",1,0],["state","TEXT",1,0],["revision","INTEGER",1,0],["next_ordinal","INTEGER",1,0],["created_at","TEXT",1,0],["updated_at","TEXT",1,0]],"indexes":[{"name":"asset_scope","unique":0,"origin":"c","partial":0,"keys":[["owner_id",0,"BINARY"],["scope",0,"BINARY"],["project_id",0,"BINARY"],["id",0,"BINARY"]]},{"name":"sqlite_autoindex_assets_1","unique":1,"origin":"pk","partial":0,"keys":[["id",0,"BINARY"]]}]}]],
  binary_chunks: [[31,{"columns":[["object_id","TEXT",1,1],["chunk_index","INTEGER",1,2],["chunk_mac","TEXT",1,0],["bytes","BLOB",1,0]],"indexes":[{"name":"sqlite_autoindex_binary_chunks_1","unique":1,"origin":"pk","partial":0,"keys":[["object_id",0,"BINARY"],["chunk_index",0,"BINARY"]]}]}]],
  binary_objects: [[31,{"columns":[["id","TEXT",1,1],["owner_id","TEXT",1,0],["scope","TEXT",1,0],["project_id","TEXT",1,0],["media_type","TEXT",1,0],["content_identity","TEXT",1,0],["byte_count","INTEGER",1,0],["asset_version_id","TEXT",0,0],["method_version_id","TEXT",0,0],["position","INTEGER",0,0]],"indexes":[{"name":"binary_object_method","unique":0,"origin":"c","partial":0,"keys":[["method_version_id",0,"BINARY"],["position",0,"BINARY"]]},{"name":"binary_object_scope","unique":0,"origin":"c","partial":0,"keys":[["owner_id",0,"BINARY"],["scope",0,"BINARY"],["project_id",0,"BINARY"],["id",0,"BINARY"]]},{"name":"sqlite_autoindex_binary_objects_1","unique":1,"origin":"pk","partial":0,"keys":[["id",0,"BINARY"]]},{"name":"sqlite_autoindex_binary_objects_2","unique":1,"origin":"u","partial":0,"keys":[["asset_version_id",0,"BINARY"]]},{"name":"sqlite_autoindex_binary_objects_3","unique":1,"origin":"u","partial":0,"keys":[["method_version_id",0,"BINARY"],["position",0,"BINARY"]]}]}]],
  method_manifest_formats: [[31,{"columns":[["version_id","TEXT",1,1],["format","TEXT",1,0]],"indexes":[{"name":"sqlite_autoindex_method_manifest_formats_1","unique":1,"origin":"pk","partial":0,"keys":[["version_id",0,"BINARY"]]}]}]],
  method_mixed_entries: [[31,{"columns":[["version_id","TEXT",1,1],["position","INTEGER",1,2],["kind","TEXT",1,0],["path","TEXT",1,0],["folded_path","TEXT",1,0],["media_type","TEXT",1,0],["content_identity","TEXT",1,0],["byte_count","INTEGER",1,0],["binary_object_id","TEXT",0,0]],"indexes":[{"name":"method_mixed_binary","unique":0,"origin":"c","partial":0,"keys":[["binary_object_id",0,"BINARY"]]},{"name":"sqlite_autoindex_method_mixed_entries_1","unique":1,"origin":"u","partial":0,"keys":[["binary_object_id",0,"BINARY"]]},{"name":"sqlite_autoindex_method_mixed_entries_2","unique":1,"origin":"pk","partial":0,"keys":[["version_id",0,"BINARY"],["position",0,"BINARY"]]},{"name":"sqlite_autoindex_method_mixed_entries_3","unique":1,"origin":"u","partial":0,"keys":[["version_id",0,"BINARY"],["folded_path",0,"BINARY"]]}]}]],
  card_current_dependencies: [[33,{"columns":[["card_id","TEXT",1,1],["owner_id","TEXT",1,0],["scope","TEXT",1,0],["project_id","TEXT",1,0],["revision","INTEGER",1,0],["card_revision","INTEGER",1,0],["body_revision","INTEGER",1,0],["context","TEXT",1,0],["vector","TEXT",1,0]],"indexes":[{"name":"card_current_namespace","unique":0,"origin":"c","partial":0,"keys":[["owner_id",0,"BINARY"],["scope",0,"BINARY"],["project_id",0,"BINARY"],["card_id",0,"BINARY"]]},{"name":"sqlite_autoindex_card_current_dependencies_1","unique":1,"origin":"pk","partial":0,"keys":[["card_id",0,"BINARY"]]}]}]],
};

// Tokenize rather than strip whitespace inside literals (which changes meaning).
// Unknown spellings fail closed; only canonical installer predicates attest.
function indexPredicate(sql) {
  const tokens = (sql ?? '').match(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[A-Za-z_][A-Za-z_0-9]*|[0-9]+|[^\s]/g) ?? [];
  const normalized = tokens.map(token => /^[A-Za-z_]/.test(token) ? token.toLowerCase() : token);
  const where = normalized.indexOf('where');
  return where < 0 ? null : normalized.slice(where + 1);
}

export function validateContextProductLayout(db, layout = attestContentSafety(db)) {
  const version = layout.base;
  if (![18,20,21,22,23,24,25,26,27,28,29,30,31,32,33].includes(version)) fail('unsupported_database');
  const present = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?");
  const columns = db.prepare('SELECT name,type,"notnull",pk FROM pragma_table_info(?) ORDER BY cid');
  const indexes = db.prepare('SELECT name,"unique",origin,partial FROM pragma_index_list(?) ORDER BY name');
  const indexSql = db.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND name=?");
  const keys = db.prepare('SELECT name,"desc",coll FROM pragma_index_xinfo(?) WHERE key=1 ORDER BY seqno');
  for (const [name, first] of Object.entries(tables)) {
    if (Boolean(present.get(name)) !== (version >= first)) fail('unsupported_database');
    if (version < first || !layouts[name]) continue;
    const expected = layouts[name].findLast(([first]) => version >= first)[1];
    const actualColumns = columns.all(name).map(r => [r.name,r.type,r.notnull,r.pk]);
    if (JSON.stringify(actualColumns) !== JSON.stringify(expected.columns) ||
        db.prepare('SELECT strict FROM pragma_table_list WHERE schema=? AND name=?').get('main', name)?.strict !== 1) fail('unsupported_database');
    const actualIndexes = indexes.all(name).map(r => ({ ...r, ...(r.partial ? { predicate: indexPredicate(indexSql.get(r.name)?.sql) } : {}),
      keys: keys.all(r.name).map(k => [k.name,k.desc,k.coll]) }));
    for (const index of expected.indexes) {
      if (!actualIndexes.some(actual => JSON.stringify(actual) === JSON.stringify(index))) fail('unsupported_database');
    }
  }
}
