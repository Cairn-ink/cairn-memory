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

function sqlGetMutation(quoted) {
  const target = name => quoted ? `"main"."${name.toUpperCase()}"` : `main.${name}`;
  const insert = quoted ? 'InSeRt/* target */INTO' : 'INSERT INTO';
  const method = `directSqlObservation(ns, id) {
      ready(); return transaction(db, () => {
        const source = db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(id);
        if (!source) return;
        db.prepare('${insert} ${target('content_identity_reservations')} SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM ${target('content_identity_reservations')} WHERE owner_id=? AND scope=? AND project_id=? AND kind=? AND stable_key=?)')
          .run(...boundary(ns),'receipt',source.id,source.id,'writer',...boundary(ns),'receipt',source.id);
        db.prepare('${insert} ${target('owner_suppression_epochs')} SELECT ?,0,0 WHERE NOT EXISTS(SELECT 1 FROM ${target('owner_suppression_epochs')} WHERE owner_id=?)').run(ns.ownerId,ns.ownerId);
        db.prepare(\`${insert} ${target('content_suppressions')}(owner_id,fact_id,epoch_hi,epoch_lo,scope,project_id,kind,stable_key,incarnation,match_mode,source_version,message_key,span_start,span_end,reason,action_id,recorded_at,evidence_origin,cleanup_status,cleanup_attempt)
          SELECT ?,lower(hex(randomblob(32))),epoch_hi+CASE WHEN epoch_lo=4294967295 THEN 1 ELSE 0 END,CASE WHEN epoch_lo=4294967295 THEN 0 ELSE epoch_lo+1 END,?,?,'receipt',?,?,'incarnation','*','',0,0,'privacy_erase','synthetic-sql','synthetic','writer','pending',0 FROM ${target('owner_suppression_epochs')} WHERE owner_id=?\`)
          .run(...boundary(ns),source.id,source.id,ns.ownerId);
      });
    },`;
  return { 'core/runtime.mjs': source => replace(source, '  return Object.freeze({\n    listReviewConflicts',
    '  return Object.freeze({\n    ' + method + '\n    listReviewConflicts'),
  'core/contract.mjs': source => replace(source, '    admit, list, get, correct, forget,',
    '    admit, list, get: input => { runtime.directSqlObservation({...input.namespace,projectId:input.namespace.projectId??""},input.memoryId); return get(input); }, correct, forget,') };
}
export const splitRevisionMutations = [
  { name:'existing get inserts schema-qualified facts', change:sqlGetMutation(false) },
  { name:'existing get inserts quoted qualified facts', change:sqlGetMutation(true) },
  { name:'method added only to context-core composition', surface:'contextCore', addedMethod:'pruneContextEvidence', graphUnchanged:true,
    change: { 'core/context-read-facade.mjs': source => replace(source,
      'return Object.freeze({ ...base, ...context.methods, close()',
      'return Object.freeze({ ...base, ...context.methods, pruneContextEvidence() { return null; }, close()') } },
];
