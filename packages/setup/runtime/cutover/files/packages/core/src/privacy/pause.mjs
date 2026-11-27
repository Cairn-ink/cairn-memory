/** @param {import("../ports/privacy.d.ts").PauseState | null | undefined} pauseState */
export function mayAdmitCapture(pauseState) {
  return pauseState?.paused === false;
}

/** Only metadata for an already-registered request may settle after pause returns.
 * @param {import("./pause.mjs").PauseSettlementKind} kind
 */
export function maySettleAfterPause(kind) {
  return kind === "status" || kind === "counts";
}

/** @param {number} prev @param {"pause" | "resume"} action */
export function pauseGenerationAfter(prev, action) {
  return action === "pause" ? prev + 1 : prev;
}
