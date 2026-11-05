import assert from 'node:assert/strict';
import { SAFETY_SCHEMA_VERSIONS, resolveContentLayout } from '../content-safety-layout.mjs';
import { safetyFixture } from './content-safety-s2h-fixture.mjs';
import { eventTimeSafetyFixture } from './receipt-event-time-fixture.mjs';

// Keep the family and physical cell together; the base alone is ambiguous.
export const costGateFamilies = () => process.env.CAIRN_S2H_UNMIGRATED_ONLY === '1'
  ? ['safety'] : ['safety', 'event-time'];
export function costFamilyPhysical(base, family = 'safety') {
  assert.ok(['safety', 'event-time'].includes(family), 'known cost family');
  const cells = SAFETY_SCHEMA_VERSIONS.filter(physical => {
    const layout = resolveContentLayout(physical);
    return layout.base === base && layout.attestedFeatures === (family === 'event-time');
  });
  assert.equal(cells.length, 1, 'one physical cell per family/base pair');
  return cells[0];
}
export const costFamilyLabel = (family, base) => family === 'safety' ? '' : ` [${family} v${costFamilyPhysical(base, family)}]`;
export const costFamilyFixture = (t, base, family = 'safety') =>
  (family === 'event-time' ? eventTimeSafetyFixture : safetyFixture)(t, base);
