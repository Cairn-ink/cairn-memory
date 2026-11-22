/** UTF-8 byte order; the canonical comparator for ids and namespaces. */
export declare function compareUtf8(a: string, b: string): -1 | 0 | 1;
/** Compares exact microsecond sort keys. */
export declare function compareSortKey(a: bigint, b: bigint): -1 | 0 | 1;
