/** Normalizes engine input after enforcing the raw UTF-16 bound. Throws invalid_text on refusal. */
export declare function normalizeBoundedText(value: unknown, rawMax?: number): string;
/** Applies the normalized UTF-16 bound. Truncation preserves whole code points. */
export declare function boundedText(value: unknown, max: number, truncate?: boolean, rawMax?: number): string;
/** Replaces lone UTF-16 surrogates and removes NUL. */
export declare function cleanContent(text: string): string;
/** NFKC, lowercase, collapse whitespace, then trim. */
export declare function normalizeForHash(text: string): string;
/** New-content pipeline: clean, NFKC, mask, collapse whitespace, then trim. */
export declare function prepareCoreText(raw: string): string;
export declare function receiptExcerpt(text: string): string;
