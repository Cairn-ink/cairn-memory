import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { removeReviewedRoleHelpAdditions, removeReviewedDatedContextOption } from './fixtures/role-profile-help-compat.mjs';

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
  assert.equal(allowlist.additions.length, 5); assert.equal(allowlist.additions[0].insertBeforePinnedLine, 9);
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
  assert.deepEqual(allowlist.additions.slice(2).map(({feature,insertBeforePinnedLine,lines})=>({feature,insertBeforePinnedLine,lines})),[
    {feature:'S2h explicit safety maintenance entry',insertBeforePinnedLine:30,lines:['  cairn-memory safety migrate --db ABS --backup ABS --store-id ID --base 18|23|33 --quiescent']},
    {feature:'S2h verified quiescence and offline backup preconditions',insertBeforePinnedLine:31,lines:[
      'For safety migration, --quiescent confirms closed admissions, stopped writers,',
      'drained readers and closed old handles. Supply a verified offline backup.',
      'A failed migration keeps admissions closed; backups are not serving restores.','']},
    {feature:'S2h retained Raw exact safety pin',insertBeforePinnedLine:36,lines:['Attested safety v48 stores use an exact safety capability pin.']},
  ]);
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
  for(const addition of allowlist.additions){
    const bytes=addition.lines.join('\n')+'\n';assert.ok(actual.includes(bytes));
    for(const changed of [actual.replace(bytes,bytes+bytes),bytes+actual.replace(bytes,''),actual.replace(bytes,'Unreviewed replacement\n')])
      assert.throws(()=>compareHelp(changed),addition.feature);
  }
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

function reviewedDatedProbe() {
  const value = structuredClone(fixture.value);
  for (const mode of ['context', 'combined']) {
    const listed = JSON.parse(value[mode].tools);
    listed.tools.find(tool => tool.name === 'read_memory_context').inputSchema.properties.representation =
      { type: 'string', enum: ['representation-v2', 'representation-v2-dated'] };
    value[mode].tools = JSON.stringify(listed);
  }
  return value;
}

test('C05 dated allowance removes only the exact optional representation knob in both context modes', () => {
  assert.deepEqual(removeReviewedDatedContextOption(reviewedDatedProbe()), fixture.value);
});

test('C05 dated allowance rejects changed schemas and preserves every unrelated pinned byte', () => {
  const schemaChange = mutate => value => {
    const listed = JSON.parse(value.context.tools);
    mutate(listed.tools.find(tool => tool.name === 'read_memory_context').inputSchema);
    value.context.tools = JSON.stringify(listed);
  };
  const mutations = [
    schemaChange(schema => { delete schema.properties.representation; }),
    schemaChange(schema => { schema.properties.representation.enum.reverse(); }),
    schemaChange(schema => { schema.properties.representation.enum.push('future'); }),
    schemaChange(schema => { schema.required.push('representation'); }),
    schemaChange(schema => { schema.properties.representation.default = 'representation-v2'; }),
    schemaChange(schema => { schema.properties.query.maxLength++; }),
    value => { value.context.tools += ' '; },
    value => { value.plain.tools += ' '; },
    value => { value.context.populatedDTOs[0] += ' '; },
    value => { value.context.invalid += ' '; },
    value => { value.context.core += ' '; },
    value => { value.context.schema += ' '; },
    value => { value.cli.stdout[1] += ' '; },
    value => { value.cli.parse += ' '; },
  ];
  for (const mutate of mutations) {
    const actual = reviewedDatedProbe(); mutate(actual);
    assert.throws(() => assert.deepEqual(removeReviewedDatedContextOption(actual), fixture.value));
  }
});
