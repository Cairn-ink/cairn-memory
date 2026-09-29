import '../../../integrations/client/test/pairing.test.mjs';
import '../../../integrations/client/test/pairing-guards.test.mjs';
import '../../../integrations/client/test/main-golden.test.mjs';
import '../../../integrations/client/test/paired-hooks.test.mjs';
// Keep shared parity in the existing npm test gate without changing root scripts.
import '../../../integrations/client/test/parity.test.mjs';
import '../../../integrations/client/test/fixture-generator.test.mjs';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { bundleClient, GENERATED_BANNER } from '../../../integrations/client/bundle.mjs';

test('checked-in client bundle is reproducible and current', async () => {
  await bundleClient({ check: true });
});

test('bundle check rejects tampered, missing and extra files, then regeneration repairs them', async () => {
  const target = await mkdtemp(join(tmpdir(), 'cairn-bundle-check-test-'));
  try {
    await writeFile(join(target, 'host-owned.mjs'), '// synthetic host-owned module\n');
    await bundleClient({ target });
    await bundleClient({ target, check: true });
    await appendFile(join(target, 'redact.mjs'), '\n// synthetic tamper\n');
    await assert.rejects(bundleClient({ target, check: true }), /client_bundle_stale: redact.mjs/);
    await bundleClient({ target });
    await unlink(join(target, 'identity.mjs'));
    await assert.rejects(bundleClient({ target, check: true }), /client_bundle_stale: identity.mjs/);
    await bundleClient({ target });
    await writeFile(join(target, 'obsolete.mjs'), GENERATED_BANNER + '// synthetic obsolete file\n');
    await assert.rejects(bundleClient({ target, check: true }), /client_bundle_extra/);
    await bundleClient({ target });
    await bundleClient({ target, check: true });
    assert.equal(await readFile(join(target, 'host-owned.mjs'), 'utf8'), '// synthetic host-owned module\n');
  } finally { await rm(target, { recursive: true, force: true }); }
});
