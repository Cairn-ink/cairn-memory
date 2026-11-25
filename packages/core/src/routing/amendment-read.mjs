import { compareUtf8 } from "../utf8.mjs";
import { documentCardSourceWithheld } from "./visibility.mjs";

const READ_LIMIT = 5;
const PRECEDENCE = "These amendments are later changes and take precedence over the card text.";

/** @param {{date: string}} a @param {{date: string}} b */
const byDate = (a, b) => compareUtf8(a.date, b.date);

/**
 * Equal dates retain the store's insertion order through the stable sort.
 * @template {Pick<import("../ports/document-card.d.ts").DocumentCardAmendment, "date">} T
 * @param {readonly T[]} amendments
 */
export function selectAmendmentsForRead(amendments) {
  return [...amendments].sort(byDate).slice(-READ_LIMIT);
}

/** @template {Pick<import("../ports/document-card.d.ts").DocumentCardAmendment, "date">} T
 * @param {readonly T[]} amendments @param {(amendment: T) => Promise<boolean>} visible */
export async function selectVisibleAmendmentsForRead(amendments, visible) {
  const ordered = [...amendments].sort(byDate);
  const selected = [];
  for (let i = ordered.length - 1; i >= 0 && selected.length < READ_LIMIT; i--) {
    if (await visible(ordered[i])) selected.push(ordered[i]);
  }
  return selected.reverse();
}

/**
 * @template {Pick<import("../ports/document-card.d.ts").DocumentCardAmendment, "date" | "sentence">} T
 * @param {{ amendments: readonly T[], countTokens: (text: string, amendments: readonly T[]) => number, maxTokens: number }} input
 */
export function renderCardAmendments({ amendments, countTokens, maxTokens }) {
  const selected = selectAmendmentsForRead(amendments);
  for (let start = 0; start < selected.length; start++) {
    const shown = selected.slice(start);
    const text = [...shown.map(({ date, sentence }) => `${date}: ${sentence}`), PRECEDENCE].join("\n");
    const tokens = countTokens(text, shown);
    if (Number.isSafeInteger(tokens) && tokens >= 0 && tokens <= maxTokens) return { text, amendments: shown };
  }
  return { text: "", amendments: [] };
}

/** @type {typeof import("./amendments.mjs").documentCardAmendmentVisible} */
export function documentCardAmendmentVisible(input) {
  try {
    const { cardVisibility, scope, source, sourceIdentity } = input;
    if (cardVisibility?.visible !== true || cardVisibility.reason !== null || !sourceIdentity) return false;
    const first = source?.rawRows?.[0];
    return !!first && first.scope.owner === scope.owner && first.scope.namespace === scope.namespace &&
      first.sessionKeyHash === sourceIdentity.sessionKeyHash && first.messageKey === sourceIdentity.messageKey &&
      documentCardSourceWithheld(source) === false;
  } catch {
    return false;
  }
}
