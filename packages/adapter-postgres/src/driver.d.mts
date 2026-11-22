export interface QueryResult {
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
