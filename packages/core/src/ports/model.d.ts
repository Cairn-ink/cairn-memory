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
  /** Structured-output format name sent verbatim (engine convention: `cairn_${method}`). */
  schemaName?: string;
  maxOutputTokens: number;
}

export type ModelStage = "extract" | "qualify" | "reconcile" | "classify" | "rationale";

/**
 * One model adapter for both stores (packages/model-openai). Core owns the prompts, the per-stage
 * schemas and any output mapping; it builds, sizes (countTokens(JSON.stringify({system, input,
 * maxOutputTokens})), the engine's sizing text) and validates. The adapter sends the request
 * verbatim, returns the raw output, never logs content, and always uses store:false. The result
 * is untrusted until core validates it.
 */
export interface ModelPort {
  readonly model: string;
  readonly contextWindow: number;
  call(stage: ModelStage, request: ModelRequest, options: CallOptions): Promise<unknown>;
  countTokens(text: string): number;
  /**
   * Optional (Phase 0 addendum 1). Whether the adapter's full provider request for this exact
   * `request` fits its own limits, measured on the body it would send (provider framing, model
   * id, schema). Synchronous, content-free, never logs. Core consults it only where the engine
   * consulted its adapter's hook (candidate qualification planning): its own count AND this hook
   * when present; when absent, its own count alone. A throw counts as false.
   */
  fits?(stage: ModelStage, request: ModelRequest): boolean;
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
  /** Wall-clock time (epoch ms) for timestamps only. May step; never use it for elapsed time. */
  nowMs(): number;
  /** Monotonic milliseconds for deadlines and elapsed time only (host: performance.now()). Never steps back. */
  monotonicMs(): number;
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
