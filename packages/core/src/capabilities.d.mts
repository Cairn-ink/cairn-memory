export type Capability =
  | "nearDuplicate" | "vectorSuppression" | "shingleSuppression" | "fingerprintKey"
  | "orderedCapture" | "stagedEvidence" | "placement" | "relations" | "cards" | "documentCards" | "episodes"
  | "spanLineage" | "sessionLineage" | "rawSpans" | "rawArchive" | "rawWindowHide"
  | "supersession" | "conflictEdges" | "semanticRetrieval" | "forgetLog";

export type Capabilities = Readonly<Record<Capability, boolean>>;

export declare const CAPABILITIES: readonly Capability[];
/** Unknown names throw invalid_input; unset names are false. */
export declare function capabilities(flags: Partial<Record<Capability, boolean>>): Capabilities;
/** Throws capability_unavailable when the flag is not true. */
export declare function requireCapability(caps: Capabilities, name: Capability): void;

export declare const OPTIONAL_PORTS: Readonly<
  Record<"vector" | "raw" | "staged" | "placement" | "relations" | "causal" | "supersession" | "conflicts" | "forgetLog" | "sessionLineage" | "spanLineage", Capability>
  & { documentCards: "documentCards" }
>;
/** Throws capability_unavailable unless every optional port is present exactly when its flag is true. */
export declare function assertAdapterCapabilities(adapter: { capabilities: Capabilities } & Record<string, unknown>): void;
