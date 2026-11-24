export type Capability =
  | "nearDuplicate" | "vectorSuppression" | "shingleSuppression" | "fingerprintKey"
  | "orderedCapture" | "stagedEvidence" | "placement" | "relations" | "cards" | "documentCards" | "episodes"
  | "spanLineage" | "sessionLineage" | "rawSpans" | "rawArchive" | "rawWindowHide"
  | "supersession" | "conflictEdges" | "semanticRetrieval" | "forgetLog"
  | "rationaleEdges" | "quantityLedger" | "embeddingRequiredOnInsert" | "documentCardSearch"
  | "contextRead" | "contextRawRead" | "inspect";

type OptionalReadCapability = "contextRead" | "contextRawRead" | "inspect";
type WriteParityCapability = "proceduralTags" | "receiptAttachAdvancesRevision";
type WriteParityCapabilities = Readonly<Partial<Record<WriteParityCapability, boolean>>>;
export type Capabilities = Readonly<Record<Exclude<Capability, OptionalReadCapability>, boolean> &
  Partial<Record<OptionalReadCapability, boolean>>>;

export declare const CAPABILITIES: readonly Exclude<Capability, OptionalReadCapability>[];
export declare const READ_CONTRACT_CAPABILITIES: readonly OptionalReadCapability[];
export declare const WRITE_PARITY_CAPABILITIES: readonly WriteParityCapability[];
/** Unknown names throw invalid_input. Optional read-contract and write-parity names are omitted when unset. */
export declare function capabilities(flags: Partial<Record<Capability | WriteParityCapability, boolean>>): Capabilities & WriteParityCapabilities;
/** Throws capability_unavailable when the flag is not true. */
export declare function requireCapability(caps: Capabilities & WriteParityCapabilities, name: Capability | WriteParityCapability): void;

export declare const OPTIONAL_PORTS: Readonly<
  Record<"vector" | "raw" | "staged" | "placement" | "relations" | "causal" | "supersession" | "conflicts" | "forgetLog" | "sessionLineage" | "spanLineage", Capability>
  & { documentCards: "documentCards"; documentCardCandidates: "documentCardSearch"; quantityLedger: "quantityLedger"; rationale: "rationaleEdges" }
>;
export declare function assertReadContractCapabilities(adapter: {
  capabilities: Capabilities;
  contextRead?: { raw?: object };
  inspect?: object;
}): void;
/** Throws capability_unavailable unless optional ports match their flags and documentCardSearch implies documentCards. */
export declare function assertAdapterCapabilities(adapter: { capabilities: Capabilities } & Record<string, unknown>): void;
