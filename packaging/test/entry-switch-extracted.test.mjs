import test from 'node:test';
import { installedAssertions } from './fixtures/entry-switch-installed.mjs';
test('extracted packed engine attaches installed sessions with no dependency installation', { timeout: 120000 }, async t => {
  await installedAssertions(t);
});
