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

// PR 2 adds this optional knob only to the two context-enabled tools lists.
// Preserve the historical oracle: remove exactly its approved schema, then
// let the caller compare every remaining serialized byte with the frozen pin.
export function removeReviewedDatedContextOption(probe) {
  for (const mode of ['context', 'combined']) {
    const original = probe[mode].tools, listed = JSON.parse(original);
    assert.equal(JSON.stringify(listed), original, 'tools serialization changed');
    const matches = listed.tools.filter(tool => tool.name === 'read_memory_context');
    assert.equal(matches.length, 1, 'one context assembly tool per reviewed mode');
    const schema = matches[0].inputSchema;
    assert.equal(JSON.stringify(schema.properties.representation),
      '{"type":"string","enum":["representation-v2","representation-v2-dated"]}',
      'reviewed dated representation option changed');
    assert.ok(!schema.required.includes('representation'), 'representation stays optional');
    delete schema.properties.representation;
    probe[mode].tools = JSON.stringify(listed);
  }
  return probe;
}
