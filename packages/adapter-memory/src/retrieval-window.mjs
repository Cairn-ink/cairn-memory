import { CoreError } from "@cairn-ink/core";

/** @typedef {NonNullable<import("@cairn-ink/core/ports").RetrievalScope["window"]>} Window */

/** @param {unknown} value */
function validBound(value) {
  return value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

/** @param {Window | undefined} window */
export function copyWindow(window) {
  if (window === undefined) return undefined;
  if (!window || typeof window !== "object" || Array.isArray(window)) throw new CoreError("invalid_input");
  const { sinceMs, untilMs } = window;
  if (!validBound(sinceMs) || !validBound(untilMs) ||
      (sinceMs !== undefined && untilMs !== undefined && sinceMs >= untilMs)) {
    throw new CoreError("invalid_input");
  }
  return { sinceMs, untilMs };
}

/** @param {Window | undefined} window @param {number | null} time */
export function withinWindow(window, time) {
  return window === undefined || (time !== null &&
    (window.sinceMs === undefined || time >= window.sinceMs) &&
    (window.untilMs === undefined || time < window.untilMs));
}

/** @param {import("@cairn-ink/core/ports").RetrievalScope} scope
 * @param {import("@cairn-ink/core/ports").MemoryRow} row
 */
export function matchesMemoryFilters({ clients, window }, { source, createdAtMs }) {
  return withinWindow(window, createdAtMs) &&
    (clients === undefined || (source.client !== null && clients.includes(source.client)));
}
