import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { hash, json, ROOT, loadFixtures } from '../../evaluation/context-read-p2e/fixtures.mjs';
import { inventory, safetyFixtures } from '../../evaluation/context-read-p2e/inventory.mjs';
import { PROTOCOL, sealRegistration, verifyRegistration } from '../../evaluation/context-read-p2e/registration.mjs';

if (process.argv.length === 6 && process.argv[2] === '--seal-draft' && process.argv[4] === '--out') {
  const registration = sealRegistration(JSON.parse(readFileSync(process.argv[3])));
  verifyRegistration(registration);
  writeFileSync(process.argv[5], json(registration), { flag: 'wx' });
  console.log(JSON.stringify({ registrationDigest: registration.seal.digest, registeredFiles: Object.keys(registration.files).length }));
  process.exit(0);
}
if (process.argv.length !== 3 || process.argv[2] !== '--write') throw Error('explicit_write_required');
const { fixture } = loadFixtures();
writeFileSync(new URL('inventory.json', ROOT), json(inventory(fixture)));
writeFileSync(new URL('safety.json', ROOT), json(safetyFixtures()));
const root = new URL('../../', import.meta.url);
const files = [
  ...readdirSync(new URL('evaluation/context-read-p2e/', root)).filter(n => n.endsWith('.mjs')).map(n => `evaluation/context-read-p2e/${n}`),
  ...readdirSync(new URL('tools/testing/', root)).filter(n => n.startsWith('p2e-') && !n.endsWith('.test.mjs')).map(n => `tools/testing/${n}`),
  ...readdirSync(ROOT).filter(n => n.endsWith('.json')).map(n => `evaluation/context-read-p2e/fixtures/${n}`),
].sort();
const registration = sealRegistration({ protocol: PROTOCOL, fixtureRecipe: { authored: true, syntheticOnly: true, seed: fixture.seed },
  engineCommit: null, providerIdentity: null, bindingHash: null, authorization: null, safetyEvidenceHash: null,
  placeholders: { engineCommit: 'bind reviewed engine commit in a NEW sealed run registration', providerIdentity: 'bind exact model/identity before any hosted run',
    bindingHash: 'bind host setup and independent offline inventory adapter after the public P2e API exists', authorization: 'separate owner approval, request counts, window, privacy surface and total cap required' },
  files: Object.fromEntries(files.map(name => [name, hash(readFileSync(new URL(name, root)))])) });
writeFileSync(new URL('evaluation/context-read-p2e/registration.json', root), json(registration));
console.log(JSON.stringify({ registrationDigest: registration.seal.digest, registeredFiles: files.length }));
