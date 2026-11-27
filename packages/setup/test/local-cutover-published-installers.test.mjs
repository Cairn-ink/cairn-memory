import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isLegacyCutoverInstaller } from '../lib/local-cutover-eligibility.mjs';
import { readDescriptor, withLocalLock, writeDescriptor } from '../lib/local-descriptor.mjs';
import { legacyFixture, linux, operator, setup } from './local-cutover-fix-support.mjs';

for (const version of ['0.6.11', '0.6.12']) {
  test(`setup --local prepares the cutover for an installed ${version} descriptor`, linux, async t => {
    const fixture = await legacyFixture(t);
    await withLocalLock(fixture.root, async () => {
      const descriptor = await readDescriptor(fixture.root);
      descriptor.installerVersion = version;
      await writeDescriptor(fixture.root, descriptor);
    });
    assert.match(operator(fixture, setup), /Local cutover verified/u);
    const prepared = await readDescriptor(fixture.root, { allowV2: true });
    assert.equal(prepared.migration.state, 'verified');
  });
}

test('earlier, current and prerelease installer versions are outside the cutover list', () => {
  const current = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  for (const version of ['0.6.10', current, '0.6.12-preview.1']) {
    assert.equal(isLegacyCutoverInstaller(version), false, version);
  }
});
