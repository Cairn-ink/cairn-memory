export interface QueryResult {
  /** Server command tag. Preserve the full multiword tag for DISCARD ALL. */
  command: string;
  rows: any[];
  rowCount?: number;
}

export interface ConnectionSource {
  connect(): Promise<Connection>;
}

export interface Connection {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  release(destroy?: boolean): void | Promise<void>;
}
