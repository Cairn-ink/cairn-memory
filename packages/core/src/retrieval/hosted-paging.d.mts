import type { UnfiledTopicPage } from "../ports/topics.d.ts";

export function pageLimit(limit?: number): number;
export function encodeCursor(value: unknown): string;
export function decodeCursor(cursor: string): unknown;
export function searchOffset(cursor?: string | null): number;
export declare const RAW_FIND_DEPTH: 100;

type UnfiledItem = UnfiledTopicPage["items"][number];
type UnfiledPosition = Pick<UnfiledItem, "id" | "createdAtUs"> & { revision: number; digest: string };
export function readUnfiledCursor(owner: string, cursor: string | null, limit: number): UnfiledPosition | null;
export function unfiledDigestInput(rows: UnfiledItem[]): string;
export function compareUnfiled(a: UnfiledItem, b: Pick<UnfiledItem, "id" | "createdAtUs">): number;
export function unfiledPage(owner: string, revision: number, digest: string, count: number, rows: UnfiledItem[],
  limit: number, position: UnfiledPosition | null): UnfiledTopicPage;
