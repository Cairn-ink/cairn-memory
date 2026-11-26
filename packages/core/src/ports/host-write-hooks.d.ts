import type { Receipt, Scope, SourceRef } from "./common.d.ts";
import type { FinishResult, CaptureMessage, CaptureKey } from "./capture.d.ts";
import type { Tx } from "./unit-of-work.d.ts";
import type { RawSourceTuple } from "./privacy.d.ts";
import type { SuppressionFact } from "../suppression-fact.mjs";
import type { CoreError } from "../errors.mjs";

export type HostSaveRequest = Readonly<{ key: string; fingerprint: string }>;
export type HostMemoryBinding = Readonly<{ id: string; revision: number }>;
export type HostPredecessor = HostMemoryBinding & Readonly<{ source: Readonly<SourceRef>; createdAtMs: number }>;
export type HostReceipt = Readonly<Omit<Receipt, "id" | "excerpt"> & { receiptId: string | null }>;
export type HostAttachment = HostReceipt & Readonly<{ outcome: "inserted" | "existing" }>;
export type HostCaptureWrite = Readonly<{
  itemPosition: number;
  memory: HostMemoryBinding;
  outcome: "inserted" | "touched" | "changed";
  receipts: readonly HostAttachment[];
}>;
export type HostCaptureSource = Pick<HostReceipt, "client" | "sessionId" | "messageId" | "role" | "occurredAtMs"> &
  Readonly<{ position: number }>;
export type HostSaveResult = Readonly<{
  status: "saved" | "duplicate";
  memory: HostMemoryBinding;
  indexRevision: number;
}>;
export type HostAdmissionDecision = Readonly<{ status: "proceed" }> | Readonly<{ status: "refuse" }>;
export type SaveRequestDecision = HostAdmissionDecision | Readonly<{ status: "conflict" }> |
  Readonly<{ status: "replay"; result: HostSaveResult }>;

type Scoped = Readonly<{ scope: Readonly<Scope> }>;
type MessageSelector = Pick<RawSourceTuple, "client" | "sessionId" | "messageId">;
export type SaveRequestContext = Scoped & Readonly<{ source: Readonly<SourceRef>; request: HostSaveRequest | null }>;
export type SaveContext = SaveRequestContext & Omit<HostSaveResult, "indexRevision"> &
  Readonly<{ receipts: readonly HostAttachment[] }>;
export type CaptureFinishContext = Scoped & Readonly<{
  client: string;
  sessionId: string;
  eventId: string;
  sources: readonly HostCaptureSource[];
  writes: readonly HostCaptureWrite[];
}>;
export type CorrectRequestContext = Scoped & Readonly<{ predecessor: HostPredecessor }>;
export type HostFactRef = Readonly<{ factId: string; kind: SuppressionFact["kind"]; epoch: bigint; createdAtMs: number }>;
type PrivacyContext = CorrectRequestContext & Readonly<{
  priorReceipts: readonly HostReceipt[];
  facts: readonly HostFactRef[];
  affectedSessions: readonly Readonly<{ client: string; sessionId: string; effect: "hide" | "erase" }>[];
  affectedMessages: readonly MessageSelector[];
  affectedSpans: readonly Readonly<{ sessionKeyHash: string; messageKey: string; start: number; end: number }>[];
}>;
export type ForgetContext = Omit<PrivacyContext, "affectedMessages"> & Readonly<{
  status: "forgotten";
  removedSimilar: number;
  affectedMessages: readonly (RawSourceTuple | (MessageSelector & { role?: never; occurredAtMs?: never }))[];
}>;
export type CorrectContext = PrivacyContext & Readonly<{
  status: "saved";
  replacement: HostMemoryBinding & Readonly<{ source: Readonly<SourceRef> }>;
  receipts: readonly HostAttachment[] | null;
}>;

export interface HostWriteHooks {
  beforeSave(tx: Tx, ctx: SaveRequestContext): Promise<SaveRequestDecision>;
  beforeCorrect(tx: Tx, ctx: CorrectRequestContext): Promise<HostAdmissionDecision>;
  onSave(tx: Tx, ctx: SaveContext): Promise<void>;
  onCaptureFinish(tx: Tx, ctx: CaptureFinishContext): Promise<void>;
  onForget(tx: Tx, ctx: ForgetContext): Promise<void>;
  onCorrect(tx: Tx, ctx: CorrectContext): Promise<void>;
}

/** Adapter context tracks only the live callback, including its asynchronous continuations. */
export interface HostHookRun {
  readonly tx: Tx;
  readonly scope: Readonly<Scope>;
  readonly phase: keyof HostWriteHooks;
  readonly keyedSave: boolean;
  readonly track: <T>(start: () => Promise<T>) => Promise<T>;
}

/** Engine-side adapter port. Host callbacks use the adapter's scoped transaction executor. */
export interface HostWriteHookPort {
  readonly context: {
    getStore(): HostHookRun | undefined;
    run<T>(store: HostHookRun, fn: () => T): T;
  };
  /** Core registers the reader of its live hook runs; ports authorize only from it. */
  bindHookAuthority(reader: (tx: Tx) => HostHookRun | undefined): void;
  priorReceipts(tx: Tx, scope: Scope, id: string): Promise<readonly HostReceipt[]>;
  predecessorEvidence(tx: Tx, scope: Scope, id: string): Promise<Pick<PrivacyContext, "priorReceipts" | "affectedMessages">>;
  beginCapture(tx: Tx, key: CaptureKey): Promise<void>;
  captureWrites(tx: Tx, key: CaptureKey, result: FinishResult): Promise<readonly HostCaptureWrite[]>;
  captureSources(tx: Tx, key: CaptureKey, sources: readonly HostCaptureSource[],
    messages: readonly CaptureMessage[]): Promise<readonly HostCaptureSource[]>;
  finalizeCapture(tx: Tx, key: CaptureKey, result: FinishResult, indexRevision: number): Promise<void>;
  finalizeSave(tx: Tx, context: SaveContext, indexRevision: number): Promise<void>;
  statementFailure(tx: Tx): CoreError | undefined;
}
