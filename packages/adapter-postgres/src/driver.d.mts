export interface QueryResult {
  /** Server command tag as the driver reports it (some drivers report "DISCARD" for DISCARD ALL; both are accepted). */
  command: string;
  rows: any[];
  rowCount?: number;
}

export interface ConnectionSource {
  /** A source opts into batching by supplying queryBatch on the connections it returns. */
  connect(): Promise<Connection>;
}

/** Unnamed queries only: the contract has no statement-name parameter by design. */
export interface Connection {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  /**
   * Optional. Send the adapter's fixed multi-statement SQL in one simple-protocol
   * request, without bind values. Return one result per statement in execution
   * order, or reject with the original driver error. A failed request can leave
   * a transaction open or aborted, so the adapter may follow it with ROLLBACK.
   */
  queryBatch?(text: string): Promise<QueryResult[]>;
  release(destroy?: boolean): void | Promise<void>;
}
