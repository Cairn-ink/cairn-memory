import assert from 'node:assert/strict';
import test from 'node:test';

// Throwaway PR that proves the core shard gates, never merged. It fails only on
// Node 22.16.0, so only `core (22.16.0)` may turn red. Behaviour by workflow
// attempt: 1 fails, 2 passes ("re-run failed jobs"), 3 fails ("re-run all
// jobs"), so that gate must be red, then green from carried-over markers, then
// red again despite the attempt-2 marker.
const attempt = Number(process.env.GITHUB_RUN_ATTEMPT ?? '1');
test(`core shard gate negative check (attempt ${attempt})`, () => {
  if (process.version !== 'v22.16.0' || attempt === 2) return;
  assert.fail(`deliberate failure on attempt ${attempt}: this shard and its Node gate must turn red`);
});
