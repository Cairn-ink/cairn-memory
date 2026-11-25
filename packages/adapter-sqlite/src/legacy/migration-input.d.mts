export interface MigrationInput {
  path: string;
  destination: string;
  expectedStoreId: string;
  backupDirectory: string;
  quiescence: { admissionsClosed: boolean; writersStopped: boolean; readersDrained: boolean; oldHandlesClosed: boolean };
}
interface NamespaceRow { owner_id: string; scope: string; project_id: string }
interface LegacyAdmission extends NamespaceRow { client: string; event_id: string }
export interface LegacySafetyFact extends NamespaceRow {
  fact_id: string; epoch_hi: bigint; epoch_lo: bigint; kind: string; stable_key: string;
  incarnation: string; match_mode: string; source_version: string; message_key: string;
  span_start: bigint; span_end: bigint; reason: string; action_id: string; recorded_at: string;
  evidence_origin: string; cleanup_status: string; cleanup_attempt: bigint;
}
export interface LegacyMemory extends NamespaceRow {
  id: string; fingerprint: string; content: string | null; kind: string; origin: string; confidence: number;
  revision: bigint; deleted: bigint; created_at: string; updated_at: string; review_state: string; currentness: string;
}
export interface LegacyReceipt {
  id: string; memory_id: string; receipt_key: string; client: string; session_id: string; event_id: string;
  role: "user" | "assistant"; excerpt: string; created_at: string;
}
export interface LegacyHistory extends NamespaceRow {
  previous_memory_id: string; previous_revision: bigint; replacement_memory_id: string;
  replacement_revision: bigint; receipt_ids: string;
}
export interface LegacyInput {
  storeId: string;
  physical: number;
  logicalDigest: string;
  target: string;
  checkSource(): void;
  withheldReceipts: number;
  inspect: {
    cursorSecret: string;
    receiptPositions: Map<string, number>;
    rawAncestryEmpty: Map<string, boolean>;
    epochs: { scope: { owner: string; namespace: string }; value: number }[];
    evidence: {
      scope: { owner: string; namespace: string };
      id: string;
      filing: "filed" | "unfiled";
      qualification: string | null;
      procedural: string | null;
      supersession: string | null;
    }[];
  };
  memories: LegacyMemory[];
  receipts: LegacyReceipt[];
  denials: Array<NamespaceRow & { fingerprint: string }>;
  namespaceEpochs: Array<NamespaceRow & { epoch: bigint }>;
  history: LegacyHistory[];
  episodeControls: Array<NamespaceRow & { generation: string; paused: bigint; enabled: bigint; ordinal: bigint }>;
  consent: Array<NamespaceRow & { revision: bigint; automatic_capture_enabled: bigint }>;
  rawControls: Array<{ owner_id: string; revision: bigint; enabled: bigint }>;
  rawPrivacy: {
    key: string;
    fences: string[][];
    rules: string[][];
    exactOnlyUuidRules: string[][];
    actions: unknown[];
    effects: unknown[];
  } | null;
  localRawPrivacy: boolean;
  archive: {
    rows: import("node:sqlite").SQLInputValue[][];
    fencedAnchors: string[][];
    anchors: Array<{scope: import("@cairn-ink/core/ports").Scope; client: string; sessionId: string;
      message: import("@cairn-ink/core/ports").CaptureMessage}>;
    spans: Map<string, Array<{sessionId: string; start: number; end: number; precision: string}>>;
    maps: import("node:sqlite").SQLInputValue[][];
    reservations: import("node:sqlite").SQLInputValue[][];
    counts: Record<string, number>;
  };
  admissions: Array<LegacyAdmission & {state: "reserved" | "pending" | "completed"}>;
  registered: LegacyAdmission[];
  safety: {
    facts: LegacySafetyFact[];
    reservations: Array<NamespaceRow & {kind: string; stable_key: string; incarnation: string; evidence_origin: string}>;
    epochs: Array<{owner_id: string; epoch_hi: bigint; epoch_lo: bigint}>;
  } | null;
  dropped: Record<string, number>;
}
export function readMigrationInput(input: MigrationInput): LegacyInput;
export class LegacyRefusal extends Error { readonly code: string }
export function legacyIdentifier(value: string): string;
export function refuse(code: string): never;
