import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { cliMain, requiredOption } from '../lib/fixture.mjs';
import { hr2bConfiguration } from '../lib/hr2b-configuration.mjs';
import { authenticateHR2bFixture } from '../assembly/hr2b-profile.mjs';

await cliMain(import.meta.url, async options => {
  const fixture = await authenticateHR2bFixture(requiredOption(options, 'fixture'));
  if (fixture.profile.placement.ok !== true) throw new Error('hr2b_fixture_quota_failure');
  const path = requiredOption(options, 'out');
  await mkdir(dirname(path), { recursive: true });
  // Record before calibration/ranking; refuse overwriting an existing file.
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, `${JSON.stringify(hr2bConfiguration(fixture.hashes), null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ ok: true, version: fixture.profile.version }));
});
