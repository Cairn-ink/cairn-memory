// Evaluator metadata never crosses this boundary. Units contain only IDs,
// text and token costs; items and the ranking retain their original order.
export const ARMS = Object.freeze(['P-top', 'P-top-s1', 'P-cover', 'P-cover-s1', 'P-top+tail']);

export function assemble(items, ranking, { arm, budget, overhead }) {
  if (!ARMS.includes(arm)) throw new Error('invalid_assembly_arm');
  if (!Number.isSafeInteger(budget) || budget < 0 || !Number.isSafeInteger(overhead) || overhead < 0) throw new Error('invalid_assembly_budget');
  const byId = new Map(items.map(item => [item.id, item]));
  if (byId.size !== items.length || new Set(ranking).size !== ranking.length) throw new Error('duplicate_assembly_item');
  const ids = new Set();
  const ordered = ranking.map(id => {
    const item = byId.get(id);
    if (!item || !item.body || !Array.isArray(item.spans)) throw new Error(`assembly_item_missing:${id}`);
    for (const unit of [item.body, ...item.spans]) {
      if (typeof unit.id !== 'string' || ids.has(unit.id) || !Number.isSafeInteger(unit.tokens) || unit.tokens < 0) throw new Error('invalid_assembly_unit');
      ids.add(unit.id);
    }
    return item;
  });
  const admitted = [], have = new Set();
  let used = 0;
  const admit = unit => {
    const cost = unit.tokens + overhead;
    if (!Number.isSafeInteger(cost)) throw new Error('invalid_unit_cost');
    if (cost > budget - used) return false;
    admitted.push({ id: unit.id, tokens: unit.tokens, cost });
    have.add(unit.id); used += cost;
    return true;
  };
  if (arm === 'P-top+tail') {
    let index = 0;
    for (; index < ordered.length; index++) {
      const units = [ordered[index].body, ...ordered[index].spans];
      const cost = units.reduce((sum, unit) => sum + unit.tokens + overhead, 0);
      if (cost > budget - used) break;
      for (const unit of units) admit(unit);
    }
    for (; index < ordered.length; index++) admit(ordered[index].body);
  } else {
    const spans = item => arm.endsWith('-s1') ? item.spans.slice(0, 1) : item.spans;
    const deepen = item => { if (have.has(item.body.id)) for (const unit of spans(item)) admit(unit); };
    if (arm.startsWith('P-cover')) {
      for (const item of ordered) admit(item.body);
      for (const item of ordered) deepen(item);
    } else for (const item of ordered) { admit(item.body); deepen(item); }
  }
  return { admitted, used };
}
