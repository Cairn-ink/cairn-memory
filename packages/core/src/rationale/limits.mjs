export const RATIONALE_LIMITS = Object.freeze({
  refs: 6,
  placed: 5,
  proposalEdges: 10,
  degree: 10,
  inspectEdges: 10,
  inspectSources: 6,
  snapshotUnits: 24_000,
  receipts: 100,
  excerptUnits: 800,
  queryUnits: 4_000,
});

/** @param {string} text @param {number} limit */
export function cutRationaleText(text, limit) {
  const cut = text.slice(0, limit);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
