export declare const NEAR_DUPLICATE_DISTANCE: 0.08;
export declare const SUPPRESSION_DISTANCE: 0.2;
export declare const CONTAINMENT_THRESHOLD: 0.6;
export declare const VECTOR_ONLY_FLOOR: 0.45;
export interface HostedFusionPreset { k: 60; lexicalWeight: 0.5; vectorWeight: 1; pool: 50; tieBreak: readonly ["updatedAt:desc", "id:desc"] }
export declare const FUSION_PRESETS: Readonly<{ hosted: Readonly<HostedFusionPreset>; "rrf-k60-d12": Readonly<{ k: 60; depth: 12; weights: readonly [0.45, 0.45]; unionMaximum: 24; tieBreak: "canonical" }> }>;
export declare const DEFAULT_FUSION_PRESET: Readonly<{ hosted: "hosted"; local: "rrf-k60-d12" }>;
export declare const LINEAGE_CLOSURE_MAX_SESSIONS: 1000;
export declare const LINEAGE_CLOSURE_MAX_VERTICES: 20000;
export declare const EXTRACTION_SLICE: 24;
export declare const MAX_TOOL_RESPONSE_BYTES: 262144;
export declare const REDACTION_VERSIONS: Readonly<{ v1: 1; current: 2 }>;
export type ForgetArm = "exact" | "hmac" | "shingles" | "vector" | "lineage";
export declare const FORGET_POLICY: Readonly<{ withKey: readonly ForgetArm[]; withoutKey: readonly ForgetArm[] }>;
