export declare const PRIVACY_REDACTION_VERSIONS: Readonly<{ v1: 1; hostedCurrent: 2; core: 3 }>;
export declare const REDACT_CORE_POLICY: "union-pending";

/** Frozen v1 rules for historical fingerprints. */
export declare function redactV1(text: string): string;
export declare function redactHostedCurrent(text: string): string;
/** Masks the union of v1 and hosted-current matches. */
export declare function redactCore(text: string): string;
