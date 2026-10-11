import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createOwnedGitFixture } from './owned-git-fixture.mjs';
import { createTestWorkspace } from './workspace.mjs';

function assertQuiescent(path) {
  assert.equal(existsSync(join(path, '.git', 'objects', 'maintenance.lock')), false);
  assert.equal(existsSync(join(path, '.git', 'gc.pid')), false);
}

test('owned fixture returns after native auto-GC and removes scratch on later caller failure', async t => {
  const owner = createTestWorkspace(t);
  const workspace = createTestWorkspace(null, { parent: owner.path });
  const sibling = join(owner.path, 'keep'); writeFileSync(sibling, 'outside the fixture');
  try {
    await assert.rejects(async () => {
      try {
        const fixture = createOwnedGitFixture(workspace);
        const inputs = join(fixture.path, 'synthetic-inputs'); mkdirSync(inputs);
        // This bounded native workload crossed the older Git auto-GC threshold
        // in the red replay, without manually spawning a writer or injecting rm.
        for (let i = 0; i < 10000; i++) writeFileSync(join(inputs, `input-${i}`), `owned native Git workload ${i}\n`);
        fixture.commit('Owned auto-GC lifecycle regression');
        assertQuiescent(fixture.path);
        assert(readdirSync(join(fixture.path, '.git', 'objects', 'pack')).some(name => name.endsWith('.pack')),
          'Native Git packing actually ran; absence of a writer alone is insufficient');
        assert.equal(execFileSync('/usr/bin/git', ['-C', fixture.path, 'status', '--porcelain'], { encoding: 'utf8' }), '');
        throw new Error('Synthetic caller failure after commit');
      } finally { await workspace.cleanup(); }
    }, /Synthetic caller failure after commit/);
    assert.equal(existsSync(workspace.path), false);
    assert.equal(existsSync(sibling), true);
  } finally { await owner.cleanup(); }
});

test('owned fixture propagates commit failure and does not adopt an existing checkout', async () => {
  const workspace = createTestWorkspace(null);
  try {
    const fixture = createOwnedGitFixture(workspace);
    assert.throws(() => createOwnedGitFixture(workspace), { code: 'EEXIST' });
    writeFileSync(join(fixture.path, 'input'), 'synthetic');
    mkdirSync(join(fixture.path, '.git', 'hooks'), { recursive: true });
    const hook = join(fixture.path, '.git', 'hooks', 'pre-commit');
    writeFileSync(hook, '#!/bin/sh\nexit 7\n'); chmodSync(hook, 0o700);
    assert.throws(() => fixture.commit('Rejected owned commit'), error => error.status === 1);
    assertQuiescent(fixture.path);
  } finally { await workspace.cleanup(); }
  assert.equal(existsSync(workspace.path), false);
});
