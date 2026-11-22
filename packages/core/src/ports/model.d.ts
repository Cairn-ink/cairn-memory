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

/** A model request built and sized by core. Prompts live in core; the adapter only sends it. */
export interface ModelRequest {
  system: string;
  input: unknown;
  /** Strict JSON schema for structured output, when the stage uses one. */
  schema?: object;
  maxOutputTokens: number;
}

export type ModelStage = "extract" | "qualify" | "reconcile" | "classify" | "rationale";

/**
 * One model adapter for both stores (cairn-model-openai). Core builds, sizes (countTokens on
 * exactly system + serialized input) and validates; the adapter sends the request verbatim,
 * never logs content, and always uses store:false. The result is untrusted until core validates it.
 */
export interface ModelPort {
  readonly model: string;
  readonly contextWindow: number;
  call(stage: ModelStage, request: ModelRequest, options: CallOptions): Promise<unknown>;
  countTokens(text: string): number;
}

/** Core helper over ModelPort.call for the plain extract stage (prompt, spec and validation from core). */
export type ExtractHelper = (model: ModelPort, input: ExtractInput, options: CallOptions) => Promise<ExtractedCandidate[]>;

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
