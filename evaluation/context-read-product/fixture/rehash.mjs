import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parameters } from './content.mjs';
import { sha256, json } from './freeze.mjs';
const directory = new URL('.', import.meta.url);
const files = Object.fromEntries(readdirSync(directory).filter(name => name !== 'manifest.json').sort().map(name => {
  const bytes = readFileSync(new URL(name, directory)); return [name, { bytes: bytes.length, sha256: sha256(bytes) }];
}));
const manifest = { version: 'p2-fixture-sha256-v1', fixture: parameters.version, contract: parameters.contract,
  hashAlgorithm: 'SHA-256', encoding: 'Exact file bytes; UTF-8 JSON uses two spaces and terminal LF.',
  inventorySha256: sha256(json(files)), fileCount: Object.keys(files).length, files };
writeFileSync(new URL('manifest.json', directory), json(manifest));
console.log(JSON.stringify({ fileCount: manifest.fileCount, inventorySha256: manifest.inventorySha256,
  manifestSha256: sha256(readFileSync(new URL('manifest.json', directory))) }));
