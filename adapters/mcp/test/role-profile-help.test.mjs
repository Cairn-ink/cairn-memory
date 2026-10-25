import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { removeReviewedRoleHelpAdditions } from './fixtures/role-profile-help-compat.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/role-profile-pre-u5c1.json', import.meta.url)));
const allowlist = JSON.parse(readFileSync(new URL('./fixtures/role-profile-help-additions.json', import.meta.url)));
const pinned = fixture.value.cli.stdout[0];
function reviewedHelp() {
  const lines = pinned.split('\n');
  for (const addition of [...allowlist.additions].reverse()) lines.splice(addition.insertBeforePinnedLine - 1, 0, ...addition.lines);
  return lines.join('\n');
}
const compareHelp = actual => assert.equal(removeReviewedRoleHelpAdditions(actual), pinned);

test('C05 reviewed help additions remove only exact §20 lines at the approved pinned position', () => {
  assert.equal(allowlist.base, fixture.base); assert.equal(allowlist.output, 'cli.stdout[0]');
  assert.equal(allowlist.additions.length, 1); assert.equal(allowlist.additions[0].insertBeforePinnedLine, 9);
  assert.equal(allowlist.additions[0].lines.length, 4); assert.ok(allowlist.additions[0].feature.includes('bge-m3 §20'));
  compareHelp(reviewedHelp());
});

test('C05 an unlisted help change still fails the pinned byte comparison', () => {
  const actual = reviewedHelp(), block = allowlist.additions[0].lines.join('\n') + '\n';
  const episode = '--session-episodes-access episode-v1 adds keyless episode reads and management,\n';
  assert.ok(actual.includes(episode));
  const changes = [
    actual + 'Unreviewed help addition\n',
    actual.replace('Normal startup waits', 'Changed startup waits'),
    actual.replace('Cairn Memory —', 'Cairn Memory -'),
    actual.replace('model install|verify bge-m3', 'model install|verify bge-m4'),
    actual.replace(block, block + block),
    block + actual.replace(block, ''),
    actual.replace(episode, '') + episode,
    actual.slice(0, -1),
    actual.replaceAll('\n', '\r\n'),
  ];
  for (const changed of changes) { assert.notEqual(changed, actual); assert.throws(() => compareHelp(changed)); }
});

test('C05 help allowance never exempts tools, DTOs, errors, CLI checks or schemas', () => {
  const mutations = [
    value => { value.plain.tools += ' '; },
    value => { value.plain.populatedDTOs[0] += ' '; },
    value => { value.plain.invalid += ' '; },
    value => { value.plain.core += ' '; },
    value => { value.plain.schema += ' '; },
    value => { value.cli.stdout[1] += ' '; },
    value => { value.cli.parse += ' '; },
  ];
  for (const mutate of mutations) {
    const actual = structuredClone(fixture.value); actual.cli.stdout[0] = reviewedHelp(); mutate(actual);
    actual.cli.stdout[0] = removeReviewedRoleHelpAdditions(actual.cli.stdout[0]);
    assert.throws(() => assert.deepEqual(actual, fixture.value));
  }
});
