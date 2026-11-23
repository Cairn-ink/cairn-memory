import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

test('candidate inventory mismatch reports missing and extra paths and how to update them', async t => {
  const { path } = createTestWorkspace(t);
  const builder = 'packaging/build-core-local.mjs';
  const missing = 'packaging/core-local/host.mjs';
  const extra = 'packaging/core-local/unused.mjs';
  for (const file of [builder, 'packaging/build.mjs', 'packaging/core-local',
    'tools/testing/vendor/acorn/acorn.mjs']) {
    cpSync(new URL('../../' + file, import.meta.url), join(path, file), { recursive: true });
  }
  const files = {
    'packages/core/package.json': JSON.stringify({ exports: { '.': { default: './src/index.mjs' } } }),
    'packages/core/src/index.mjs': 'export const value = 1;',
    'packaging/artifact-files.json': '[]',
    'packaging/core-local-files.json': JSON.stringify([
      'LICENSE', 'packages/core/package.json', 'packaging/core-local/adapter-slot.mjs',
      'packaging/core-local/cli.mjs', extra,
    ]),
    [missing]: `export async function openLocalService() {
      return import('./adapter-slot.mjs');
    }
    export function serveStdio() {}`,
  };
  for (const [file, source] of Object.entries(files)) {
    const target = join(path, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
  const { buildCoreLocalCandidate } = await import(pathToFileURL(join(path, builder)).href);
  const output = join(path, 'out');
  assert.throws(() => buildCoreLocalCandidate(output), {
    code: 'core_local_inventory_graph_mismatch',
    message: [
      'core_local_inventory_graph_mismatch',
      `Missing from inventory: ["${missing}"]`,
      `Extra in inventory: ["${extra}"]`,
      'Update packaging/core-local-files.json to match the sorted candidate-owned file list.',
    ].join('\n'),
  });
  assert.equal(existsSync(output), false);
});
