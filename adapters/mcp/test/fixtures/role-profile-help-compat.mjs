import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const allowlist = JSON.parse(readFileSync(new URL('./role-profile-help-additions.json', import.meta.url)));
assert.equal(allowlist.base, '4aa9327b');
assert.equal(allowlist.output, 'cli.stdout[0]');

// Only current help is projected back to the pin. No trimming, patterns or
// reordering: the exact added lines and both adjacent pinned lines must match.
// After earlier removals, positions are again those of the pinned help text.
export function removeReviewedRoleHelpAdditions(help) {
  assert.equal(typeof help, 'string');
  const lines = help.split('\n');
  let previous = 0;
  for (const addition of allowlist.additions) {
    const index = addition.insertBeforePinnedLine - 1;
    assert.ok(Number.isSafeInteger(index) && index > previous);
    assert.ok(addition.feature.length && addition.lines.length);
    assert.equal(lines[index - 1], addition.previousPinnedLine, 'reviewed help addition moved: preceding pinned line');
    assert.deepEqual(lines.slice(index, index + addition.lines.length), addition.lines, 'reviewed help addition bytes/order changed');
    assert.equal(lines[index + addition.lines.length], addition.nextPinnedLine, 'reviewed help addition moved: following pinned line');
    lines.splice(index, addition.lines.length);
    previous = index;
  }
  return lines.join('\n');
}
