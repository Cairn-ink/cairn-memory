import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, symlinkSync, realpathSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { localNodeExecutable } from '../lib/local-node-path.mjs';

for (const prefix of ['/opt/homebrew', '/usr/local']) for (const formula of ['node', 'node@22']) {
  test(`stable Homebrew executable for ${prefix} ${formula} uses a matching synthetic opt link`, t => {
    const ws = createTestWorkspace(t, { prefix:'local-node-path-' });
    const executable = `${prefix}/Cellar/${formula}/22.16.0/bin/node`, stable = `${prefix}/opt/${formula}/bin/node`;
    // Map every lookup into the synthetic tree; never inspect a real Homebrew.
    const synthetic = path => join(ws.path, path.slice(1));
    const realpath = path => { assert.ok(path.startsWith(prefix + '/')); return realpathSync(synthetic(path)); };
    mkdirSync(dirname(synthetic(executable)), { recursive:true }); writeFileSync(synthetic(executable), 'synthetic node');
    assert.equal(localNodeExecutable(executable, realpath), executable, 'missing opt link');
    mkdirSync(dirname(synthetic(`${prefix}/opt/${formula}`)), { recursive:true });
    symlinkSync(synthetic(`${prefix}/Cellar/${formula}/22.16.0`), synthetic(`${prefix}/opt/${formula}`));
    assert.equal(localNodeExecutable(executable, realpath), stable);
    // A newer opt link must not silently select another installed Node.
    unlinkSync(synthetic(`${prefix}/opt/${formula}`));
    const other = `${prefix}/Cellar/${formula}/24.22.1/bin/node`;
    mkdirSync(dirname(synthetic(other)), { recursive:true }); writeFileSync(synthetic(other), 'different synthetic node');
    symlinkSync(synthetic(`${prefix}/Cellar/${formula}/24.22.1`), synthetic(`${prefix}/opt/${formula}`));
    assert.equal(localNodeExecutable(executable, realpath), executable, 'mismatched target');
    unlinkSync(synthetic(`${prefix}/opt/${formula}`));
    symlinkSync(synthetic(`${prefix}/Cellar/${formula}/missing`), synthetic(`${prefix}/opt/${formula}`));
    assert.equal(localNodeExecutable(executable, realpath), executable, 'dangling opt link');
    assert.equal(localNodeExecutable(executable, () => { throw Object.assign(Error('synthetic denied'), { code:'EACCES' }); }), executable);
  });
}
test('non-Homebrew and non-Node paths remain unchanged without filesystem lookups', () => {
  for (const path of ['/usr/bin/node', '/synthetic/nvm/bin/node', '/another/Cellar/node/22/bin/node',
    '/opt/homebrew/bin/node', '/opt/homebrew/Cellar/node/22/bin/npm', '/usr/local/Cellar/node/22/lib/node']) {
    assert.equal(localNodeExecutable(path, () => { assert.fail('unrelated path must not be resolved'); }), path);
  }
});
