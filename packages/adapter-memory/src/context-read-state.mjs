/** @import { Entry, State } from "./unit-of-work.mjs" */

/** @param {Entry} next @param {Entry | undefined} previous */
function unchanged(next, previous) {
  return previous !== undefined && next.row.revision === previous.row.revision &&
    next.row.updatedAtUs === previous.row.updatedAtUs && next.row.historical === previous.row.historical &&
    JSON.stringify(next.receipts) === JSON.stringify(previous.receipts);
}

/** Advance canonical namespace epochs only at publication of a committed owner state.
 * @param {State} previous @param {State} next */
export function advanceContextEpochs(previous, next) {
  for (const namespace of new Set([...previous.rows.keys(), ...next.rows.keys()])) {
    const before = previous.rows.get(namespace);
    const after = next.rows.get(namespace);
    if (before?.size === after?.size && after &&
        [...after].every(([id, entry]) => unchanged(entry, before?.get(id)))) continue;
    next.contextEpochs.set(namespace, (previous.contextEpochs.get(namespace) ?? 1) + 1);
  }
}
