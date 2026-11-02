import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('R5 cost inventory comparator matches the operational unmigrated gate', () => {
  const load = name => JSON.parse(readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8'));
  const summary = load('content-safety-s2h-cost-inventory.json').unmigratedGate;
  const operational = load(summary.fixture);
  assert.equal(summary.main, operational.mainSha.slice(0, 8), 'summary names the measured comparator');
  assert.equal(summary.measured, operational.measuredDate, 'summary names the measurement date');
});
