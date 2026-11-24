export interface MigrationInput {
  path: string;
  destination: string;
  expectedStoreId: string;
  backupDirectory: string;
  quiescence: { admissionsClosed: boolean; writersStopped: boolean; readersDrained: boolean; oldHandlesClosed: boolean };
}
interface NamespaceRow { owner_id: string; scope: string; project_id: string }
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
    actions: unknown[];
    effects: unknown[];
  } | null;
  dropped: Record<string, number>;
}
export function readMigrationInput(input: MigrationInput): LegacyInput;
export class LegacyRefusal extends Error { readonly code: string }
export function legacyIdentifier(value: string): string;
export function refuse(code: string): never;
