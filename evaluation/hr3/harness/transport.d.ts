/** No client, credentials, retries, or network implementation is supplied. */
export type Operation = 'extraction' | 'reader' | 'research-embedding' | 'product-embedding';
export interface Request {
  /** Unique attempt ID; the harness reserves this ID durably before send. */
  id: string;
  logicalId?: string;
  operation: Operation;
  /** Exact provider JSON. A client must not add model parameters or tools. */
  body: Record<string, unknown>;
}
export interface Reply {
  /** Actual provider request ID, used once for settlement. */
  requestId: string;
  /** Observed model, not merely the requested model. */
  model: string;
  status: 'completed' | 'incomplete' | 'refused';
  /** Original output text, without JSON repair or quality retry. */
  outputText?: string;
  vectors?: number[][];
  /** Full billed output, including reasoning. Embeddings have outputTokens=0. */
  usage: { inputTokens: number; outputTokens: number };
}
export interface Transport {
  /** One dispatch only. Throw TransportError for retryable transport failures. */
  send(request: Request, options: { signal: AbortSignal }): Promise<Reply>;
}
