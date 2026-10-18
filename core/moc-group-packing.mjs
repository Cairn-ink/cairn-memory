import { requestFits } from './model-packing.mjs';
import { emitDiagnostic } from './model-diagnostics.mjs';
import { fail } from './validation.mjs';

const identity = group => JSON.stringify([group.namespaceIndex, group.mocId, group.revision]);
const reference = ({ namespaceIndex, mocId, revision }) => ({ namespaceIndex, mocId, revision });

/** Whole-group packing. Lanes are private; the strict selectGroups wire is unchanged. */
export function packMocGroups(model, system, input, lanes, validateFresh = () => {}) {
  const observed = new Set();
  const ordered = lanes.map(lane => ({ ...lane, groups: lane.groups.filter(group => {
    const key = identity(group);
    if (observed.has(key)) return false;
    observed.add(key);
    return true;
  }) })).filter(lane => lane.groups.length);
  if (observed.size > 400) fail('invalid_input');
  let fitChecks = 0;
  const fitsRequest = requestFits(model, 'selectGroups');
  const view = groups => ({ ...input, maps: input.maps.map(map => ({ namespaceIndex: map.namespaceIndex,
    groups: groups.filter(group => group.namespaceIndex === map.namespaceIndex) })) });
  const fits = groups => {
    validateFresh();
    fitChecks++;
    const result = fitsRequest(system, view(groups));
    validateFresh();
    return result;
  };
  const reject = () => {
    emitDiagnostic(model, 'selectGroups', 'core_call', 'context_budget_exceeded');
    fail('context_budget_exceeded');
  };
  if (!fits([])) reject();
  const kept = ordered.map(lane => lane.groups[0]);
  if (kept.length && !fits(kept)) reject();
  const omitted = [];
  const longest = Math.max(0, ...ordered.map(lane => lane.groups.length));
  for (let position = 1; position < longest; position++) for (const lane of ordered) {
    const group = lane.groups[position];
    if (!group) continue;
    if (fits([...kept, group])) kept.push(group);
    else omitted.push(group);
  }
  return { input: view(kept), packedRefs: kept.map(reference), omittedRefs: omitted.map(reference),
    observedGroups: observed.size, fitChecks,
    lanes: ordered.map(lane => ({ namespaceIndex: lane.namespaceIndex, origin: lane.origin,
      observedRefs: lane.groups.map(reference), packedRefs: lane.groups.filter(group => kept.includes(group)).map(reference),
      omittedRefs: lane.groups.filter(group => omitted.includes(group)).map(reference) })) };
}
