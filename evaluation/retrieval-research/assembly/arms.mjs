// Evaluator metadata never crosses this boundary. Units contain only IDs,
// text and token costs; items and the ranking retain their original order.
import { scalarCost } from './cost.mjs';
export const ARMS = Object.freeze(['P-top', 'P-top-s1', 'P-cover', 'P-cover-s1', 'P-top+tail']);

export function assemble(items, ranking, { arm, budget, overhead, cost }) {
  if (!ARMS.includes(arm)) throw new Error('invalid_assembly_arm');
  if (!Number.isSafeInteger(budget) || budget < 0) throw new Error('invalid_assembly_budget');
  cost ??= scalarCost(overhead);
  if (!cost || !Number.isSafeInteger(cost.initial) || cost.initial < 0 || typeof cost.unit !== 'function') throw new Error('invalid_cost_model');
  if (budget < cost.initial) throw new Error('context_item_too_large');
  const byId = new Map(items.map(item => [item.id, item]));
  if (byId.size !== items.length || new Set(ranking).size !== ranking.length) throw new Error('duplicate_assembly_item');
  const ids = new Set();
  const ordered = ranking.map(id => {
    const item = byId.get(id);
    if (!item || !item.body || !Array.isArray(item.spans)) throw new Error(`assembly_item_missing:${id}`);
    for (const unit of [item.body, ...item.spans]) {
      if (typeof unit.id !== 'string' || ids.has(unit.id) || !Number.isSafeInteger(unit.tokens) || unit.tokens < 0) throw new Error('invalid_assembly_unit');
      if (cost.id === 'host-v2' && typeof unit.text !== 'string') throw new Error('invalid_assembly_unit');
      ids.add(unit.id);
    }
    return item;
  });
  const admitted = [], have = new Set();
  let used = cost.initial, bodies = 0, budgetRejected = false, bodyEqualSpanCount = 0;
  const charge = (unit, item, count = bodies) => {
    const value = cost.unit(unit, item, unit === item.body, count);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_unit_cost');
    return value;
  };
  const commit = (unit, item, value) => {
    admitted.push({ id: unit.id, tokens: unit.tokens, cost: value });
    have.add(unit.id); used += value;
    if (unit === item.body) bodies++;
    else if (unit.text === item.body.text) bodyEqualSpanCount++;
  };
  const admit = (unit, item) => {
    const value = charge(unit, item);
    if (value > budget - used) { budgetRejected = true; return false; }
    commit(unit, item, value);
    return true;
  };
  if (arm === 'P-top+tail') {
    let index = 0;
    for (; index < ordered.length; index++) {
      const item = ordered[index], units = [item.body, ...item.spans];
      const values = units.map((unit, i) => cost.unit(unit, item, i === 0, bodies + (i > 0 ? 1 : 0)));
      const total = values.reduce((sum, value) => sum + value, 0);
      if (total > budget - used) { budgetRejected = true; break; }
      if (values.some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('invalid_unit_cost');
      units.forEach((unit, i) => commit(unit, item, values[i]));
    }
    for (; index < ordered.length; index++) admit(ordered[index].body, ordered[index]);
  } else {
    const spans = item => arm.endsWith('-s1') ? item.spans.slice(0, 1) : item.spans;
    const deepen = item => { if (have.has(item.body.id)) for (const unit of spans(item)) admit(unit, item); };
    if (arm.startsWith('P-cover')) {
      for (const item of ordered) admit(item.body, item);
      for (const item of ordered) deepen(item);
    } else for (const item of ordered) { admit(item.body, item); deepen(item); }
  }
  return { admitted, used, ...(cost.id === 'host-v2' ? { budgetRejected, bodyEqualSpanCount } : {}) };
}
