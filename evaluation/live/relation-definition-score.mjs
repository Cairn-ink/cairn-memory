const tuple = edge => JSON.stringify(Array.isArray(edge) ? edge :
  [edge.from, edge.to, edge.relation, edge.fromReceipt, edge.toReceipt]);

/** Offline tuple audit only; semantic source interpretation still requires human review. */
export function scoreRelationDefinition(report, rubric) {
  if (report?.id !== 'relation-definition-lite-v1' || rubric?.id !== 'relation-definition-lite-v1-rubric'
    || report.slots?.length !== 20 || rubric.cases?.length !== 10) throw new Error('invalid_relation_score_input');
  const byCase = new Map(rubric.cases.map(item => [item.id, item]));
  if (byCase.size !== 10 || report.slots.some(slot => !byCase.has(slot.caseId))
    || new Set(report.slots.map(slot => `${slot.caseId}:${slot.arm}`)).size !== 20
    || rubric.cases.some(item => !['required', 'allowed', 'note', 'id', 'requiredAny']
      .every(key => key in item || key === 'requiredAny'))) throw new Error('invalid_relation_score_input');
  const slots = report.slots.map(slot => {
    const rule = byCase.get(slot.caseId);
    if (!rule || !['baseline', 'guide'].includes(slot.arm)) throw new Error('invalid_relation_score_input');
    if (slot.status !== 'completed' || !Array.isArray(slot.proposal?.edges)) return {
      caseId: slot.caseId, arm: slot.arm, status: slot.status, scored: false,
      required: rule.required.length + (rule.requiredAny?.length ?? 0), proposed: null,
      omitted: null, unsupported: null, complete: false };
    const proposed = new Set(slot.proposal.edges.map(tuple));
    const accepted = new Set([...rule.required, ...rule.allowed,
      ...(rule.requiredAny ?? []).flat()].map(tuple));
    const omitted = rule.required.filter(edge => !proposed.has(tuple(edge))).length
      + (rule.requiredAny ?? []).filter(group => !group.some(edge => proposed.has(tuple(edge)))).length;
    const unsupported = [...proposed].filter(edge => !accepted.has(edge)).length;
    return { caseId: slot.caseId, arm: slot.arm, status: slot.status, scored: true,
      required: rule.required.length + (rule.requiredAny?.length ?? 0), proposed: slot.proposal.edges.length,
      omitted, unsupported,
      complete: omitted === 0 && unsupported === 0 };
  });
  const arms = Object.fromEntries(['baseline', 'guide'].map(arm => {
    const entries = slots.filter(slot => slot.arm === arm);
    return [arm, { slots: entries.length, scored: entries.filter(slot => slot.scored).length,
      failedOrMalformed: entries.filter(slot => !slot.scored).length,
      notRun: entries.filter(slot => slot.status === 'not_run').length,
      failed: entries.filter(slot => slot.status === 'failed').length,
      malformed: entries.filter(slot => slot.status === 'malformed').length,
      required: entries.reduce((sum, slot) => sum + slot.required, 0),
      requiredScored: entries.filter(slot => slot.scored).reduce((sum, slot) => sum + slot.required, 0),
      proposed: entries.reduce((sum, slot) => sum + (slot.proposed ?? 0), 0),
      omitted: entries.reduce((sum, slot) => sum + (slot.omitted ?? 0), 0),
      unsupported: entries.reduce((sum, slot) => sum + (slot.unsupported ?? 0), 0),
      complete: entries.filter(slot => slot.complete).length }];
  }));
  return { version: 1, id: report.id, arms, slots };
}
