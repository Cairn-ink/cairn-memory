// CI only: real offline npm installation, never run by local workers.
import test from 'node:test';
import { installedAssertions } from './fixtures/entry-switch-installed.mjs';
test('offline installed engine verifies setup manifest and shares installed sessions', { timeout: 120000 }, async t => {
  await installedAssertions(t, { install: true });
});
