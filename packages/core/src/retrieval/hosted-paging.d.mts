export function pageLimit(limit?: number): number;
export function encodeCursor(value: unknown): string;
export function decodeCursor(cursor: string): unknown;
export function searchOffset(cursor?: string | null): number;
export declare const RAW_FIND_DEPTH: 100;
