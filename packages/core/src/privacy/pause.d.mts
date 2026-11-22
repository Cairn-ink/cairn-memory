import type { PauseState } from "../ports/privacy.d.ts";

export type PauseSettlementKind = "status" | "counts" | "memory" | "raw" | "embedding";

export declare function mayAdmitCapture(pauseState: PauseState | null | undefined): boolean;
/** Only metadata for an already-registered request may settle after pause returns. */
export declare function maySettleAfterPause(kind: PauseSettlementKind): boolean;
export declare function pauseGenerationAfter(prev: number, action: "pause" | "resume"): number;
