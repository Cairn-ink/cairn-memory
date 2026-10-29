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

test('C05 reviewed help additions remove only exact §20 and safety lines at the approved pinned positions', () => {
  assert.equal(allowlist.base, fixture.base); assert.equal(allowlist.output, 'cli.stdout[0]');
  assert.equal(allowlist.additions.length, 2); assert.equal(allowlist.additions[0].insertBeforePinnedLine, 9);
  assert.equal(allowlist.additions[0].lines.length, 4); assert.ok(allowlist.additions[0].feature.includes('bge-m3 §20'));
  assert.deepEqual(allowlist.additions[0].lines, [
    '  cairn-memory model install|verify bge-m3 --dir ABS [--check-config]',
    '  cairn-memory --db ABS --owner ID --context-read context-read-v1',
    '    --context-embedder local --context-embed-model bge-m3 --context-embed-dimensions 1024',
    '    --context-embed-pack ABS --context-embed-max-requests N [--context-embed-threads T]',
  ]);
  assert.equal(allowlist.additions[1].feature, 'S3 read-only content-safety preflight count');
  assert.equal(allowlist.additions[1].insertBeforePinnedLine, 13);
  assert.deepEqual(allowlist.additions[1].lines, ['  cairn-memory safety preflight --db ABS']);
  for (const addition of allowlist.additions) {
    const index = addition.insertBeforePinnedLine - 1, lines = pinned.split('\n');
    assert.equal(addition.previousPinnedLine, lines[index - 1]);
    assert.equal(addition.nextPinnedLine, lines[index]);
  }
  compareHelp(reviewedHelp());
});

test('C05 an unlisted help change still fails the pinned byte comparison', () => {
  const actual = reviewedHelp(), block = allowlist.additions[0].lines.join('\n') + '\n';
  const safety = allowlist.additions[1].lines.join('\n') + '\n';
  const episode = '--session-episodes-access episode-v1 adds keyless episode reads and management,\n';
  assert.ok(actual.includes(episode));
  const changes = [
    actual + 'Unreviewed help addition\n',
    actual.replace('Normal startup waits', 'Changed startup waits'),
    actual.replace('Cairn Memory —', 'Cairn Memory -'),
    actual.replace('model install|verify bge-m3', 'model install|verify bge-m4'),
    actual.replace(block, block + block),
    block + actual.replace(block, ''),
    actual.replace('safety preflight --db ABS', 'safety preflight --db PATH'),
    actual.replace(safety, safety + safety),
    safety + actual.replace(safety, ''),
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
