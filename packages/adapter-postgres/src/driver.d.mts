export interface QueryResult {
  /** Server command tag as the driver reports it (some drivers report "DISCARD" for DISCARD ALL; both are accepted). */
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
