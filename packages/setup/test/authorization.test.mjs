import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { translator } from '../lib/messages.mjs';

const { sharedAuthorization } = await import(process.env.CAIRN_SETUP_TEST_MODULE ?
  new URL('./authorization.mjs', process.env.CAIRN_SETUP_TEST_MODULE) : new URL('../lib/authorization.mjs', import.meta.url));

// Split search needles so this whole-package grep does not match itself.
const forbidden = ['.creden' + 'tials.json', 'find-generic' + '-password',
  'plugin' + 'Secrets', 'SECURE' + 'STORAGE', 'readClaude' + 'Credential'];
test('round 3: whole-package grep forbids Claude host secret-store references', async () => {
  const directory = process.env.CAIRN_SETUP_TEST_PACKAGE || fileURLToPath(new URL('../', import.meta.url));
  const matches = [];
  const scan = async path => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await scan(file);
      else if (entry.isFile()) {
        const text = await readFile(file, 'utf8');
        if (forbidden.some(needle => text.includes(needle))) matches.push(file);
      }
    }
  };
  await scan(directory);
  assert.deepEqual(matches, [], 'installer package must never reference a Claude host secret store');
});
for (const lang of ['zh', 'en']) test(`shared endpoint refusal is localized (${lang}) and cannot start authorization`, async () => {
  const authorization = await sharedAuthorization({ stored: { endpoint: 'https://old.example', token: 'synthetic-token' },
    authOptions: { request: () => { throw new Error('must not request'); } } });
  await assert.rejects(authorization.authorize('https://new.example', {}), error => {
    assert.equal(error.key, 'authorization_endpoint_conflict'); assert.equal(error.code, 2);
    const text = translator(lang)(error.key); assert.match(text, /--reauthorize/);
    assert.match(text, lang === 'zh' ? /既有 endpoint/ : /endpoints conflict/); return true;
  });
});
test('round 3: documentation states approval direction and prohibits importing Claude secrets', async () => {
  const packageRoot = process.env.CAIRN_SETUP_TEST_PACKAGE ? pathToFileURL(process.env.CAIRN_SETUP_TEST_PACKAGE + '/') : new URL('../', import.meta.url);
  const root = new URL('../../', packageRoot);
  for (const [url, pattern] of [
    [new URL('README.md', root), /Claude first[^\n]*one new browser approval/],
    [new URL('plugins/cairn-memory/README.md', root), /Claude first[^\n]*one new browser approval/],
    [new URL('docs/codex-setup.md', root), /Claude 先裝[^\n]*一次新的瀏覽器核准/],
    [new URL('README.md', packageRoot), /Claude first[^\n]*one new browser approval/],
    [new URL('CHANGELOG.md', root), /Never read Claude Code's credential store/],
  ]) assert.match(await readFile(url, 'utf8'), pattern, url.pathname);
});
for (const lang of ['en', 'zh']) test(`round 3: endpoint conflict after delivery never claims credentials were kept (${lang})`, async () => {
  const authorization = await sharedAuthorization({ endpoint: 'https://first.example' });
  await authorization.authorize('https://first.example', {
    authorization: { authorize: async (endpoint, options) => {
      await options.save({ api_endpoint: endpoint, api_token: 'synthetic-token' });
      return { expiresAt: '2027-04-01T00:00:00.000Z' };
    } }, save: async () => {},
  });
  await assert.rejects(authorization.authorize('https://second.example', {}), error => {
    assert.equal(error.key, 'authorization_delivered_endpoint_conflict');
    assert.equal(error.code, 2);
    const text = translator(lang)(error.key);
    assert.match(text, /--reauthorize/);
    assert.match(text, lang === 'en' ? /already delivered/ : /已交付憑證/);
    assert.doesNotMatch(text, /credentials and endpoints were kept|已保留憑證與 endpoint/);
    return true;
  });
});
