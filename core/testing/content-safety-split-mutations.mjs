// Shared by the in-process negative controls and the loader-only baseline probe.
// No source or SQLite files are rewritten to execute a mutation.
const privacy = `privacyErase(ns, memoryId) {
      ready(); return transaction(db, () => suppressReceiptsInside(db, ns, memoryId,
        { reason: 'privacy_erase', actionId: 'synthetic-unreviewed' }));
    },`;
function replace(source, before, after) {
  if (!source.includes(before)) throw Error('mutation_anchor_missing');
  return source.replace(before, after);
}
function runtime(source) { return replace(source, '  return Object.freeze({\n    listReviewConflicts', '  return Object.freeze({\n    ' + privacy + '\n    listReviewConflicts'); }
export const splitMutations = [
  { name: 'openPrivacy -> runtime.privacyErase -> suppressReceiptsInside', addedExport: 'openPrivacy',
    change: { 'core/runtime.mjs': runtime,
      'core/index.mjs': source => source + '\nexport function openPrivacy(input) { return createMemoryRuntime(input); }\n' } },
  { name: 'harmless facade wrapper -> runtime.privacyErase', addedMethod: 'pruneEvidence',
    change: { 'core/runtime.mjs': runtime,
      'core/contract.mjs': source => replace(source, '    admit, list, get, correct, forget,',
        '    pruneEvidence: input => runtime.privacyErase(input.namespace, input.memoryId),\n    admit, list, get, correct, forget,') } },
  { name: 'renamed re-export through an innocuous wrapper', addedExport: 'pruneEvidence',
    change: { 'core/runtime.mjs': source => source + '\nfunction tidy(...args) { return suppressReceiptsInside(...args); }\nexport { tidy };\n',
      'core/index.mjs': source => source + '\nexport { tidy as pruneEvidence } from "./runtime.mjs";\n' } },
  { name: 'existing get method forwards without changing inventory',
    change: { 'core/runtime.mjs': runtime,
      'core/contract.mjs': source => replace(source, '    admit, list, get, correct, forget,',
        '    admit, list, get: input => runtime.privacyErase(input.namespace, input.memoryId), correct, forget,') } },
  { name: 'direct renamed re-export', addedExport: 'pruneEvidence',
    change: { 'core/runtime.mjs': source => source + '\nexport { suppressReceiptsInside as tidy };\n',
      'core/index.mjs': source => source + '\nexport { tidy as pruneEvidence } from "./runtime.mjs";\n' } },
];
export function mutatedSplitSources(sources, mutation) {
  const changed = new Map(sources);
  for (const [path, edit] of Object.entries(mutation.change)) changed.set(path, edit(changed.get(path)));
  return changed;
}
