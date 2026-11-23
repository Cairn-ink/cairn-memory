/** Replaces lone UTF-16 surrogates and removes NUL. */
export declare function cleanContent(text: string): string;
/** NFKC, lowercase, collapse whitespace, then trim. */
export declare function normalizeForHash(text: string): string;
/** New-content pipeline: clean, NFKC, mask, collapse whitespace, then trim. */
export declare function prepareCoreText(raw: string): string;
