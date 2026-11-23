export type Capability =
  | "nearDuplicate" | "vectorSuppression" | "shingleSuppression" | "fingerprintKey"
  | "orderedCapture" | "stagedEvidence" | "placement" | "relations" | "cards" | "documentCards" | "episodes"
  | "spanLineage" | "sessionLineage" | "rawSpans" | "rawArchive" | "rawWindowHide"
  | "supersession" | "conflictEdges" | "semanticRetrieval" | "forgetLog"
  | "rationaleEdges" | "quantityLedger" | "embeddingRequiredOnInsert" | "documentCardSearch";

export type Capabilities = Readonly<Record<Capability, boolean>>;

export declare const CAPABILITIES: readonly Capability[];
/** Unknown names throw invalid_input; unset names are false. */
export declare function capabilities(flags: Partial<Record<Capability, boolean>>): Capabilities;
/** Throws capability_unavailable when the flag is not true. */
export declare function requireCapability(caps: Capabilities, name: Capability): void;

export declare const OPTIONAL_PORTS: Readonly<
  Record<"vector" | "raw" | "staged" | "placement" | "relations" | "causal" | "supersession" | "conflicts" | "forgetLog" | "sessionLineage" | "spanLineage", Capability>
  & { documentCards: "documentCards"; documentCardCandidates: "documentCardSearch"; quantityLedger: "quantityLedger"; rationale: "rationaleEdges" }
>;
/** Throws capability_unavailable unless optional ports match their flags and documentCardSearch implies documentCards. */
export declare function assertAdapterCapabilities(adapter: { capabilities: Capabilities } & Record<string, unknown>): void;
