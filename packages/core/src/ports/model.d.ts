import type { CallOptions, MemoryKind, OwnerId, Role } from "./common.d.ts";

export interface ExtractInput {
  messages: ReadonlyArray<{ role: Role; content: string }>;
}

export interface ExtractedCandidate {
  content: string;
  kind: MemoryKind;
  confidence: number;
  /** Indices into ExtractInput.messages. */
  sourceIndices: number[];
}

/**
 * One model adapter for both stores (cairn-model-openai). Callers pass already redacted,
 * eligible text; the adapter never logs content and always sends store:false.
 * Optional methods are absent when the host does not use them.
 */
export interface ModelPort {
  readonly model: string;
  readonly contextWindow: number;
  extract(input: ExtractInput, options: CallOptions): Promise<ExtractedCandidate[]>;
  qualify?(input: unknown, options: CallOptions): Promise<unknown>;
  reconcile?(input: unknown, options: CallOptions): Promise<unknown>;
  classify?(input: unknown, options: CallOptions): Promise<unknown>;
  countTokens(text: string): number;
}

export interface EmbedderPort {
  readonly model: string;
  readonly dimensions: number;
  /** Returns unit vectors in input order; throws embedding_failed on provider failure. */
  embed(texts: readonly string[], options: CallOptions): Promise<Float32Array[]>;
}

/** Checked at send time; fails closed. phase: before building, right before dispatch, after the await. */
export interface ModelGate {
  assertOpen(owner: OwnerId, phase: "pre-send" | "dispatch" | "post-send"): Promise<void>;
}

export interface ClockAndHash {
  nowMs(): number;
  sha256Hex(bytes: Uint8Array | string): Promise<string>;
  hmacHex(key: CryptoKey | Uint8Array, bytes: Uint8Array | string): Promise<string>;
}

export interface TokenCounter {
  countTokens(text: string): number;
}

export interface SemanticBudget {
  reserve(owner: OwnerId, budgetClass: "capture" | "recall" | "import", estimate: number): Promise<{ reservationId: string } | { denied: true }>;
  settle(reservationId: string, actual: number): Promise<void>;
}
