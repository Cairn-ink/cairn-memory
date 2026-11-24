import { join } from 'node:path';

export const legacyEngineIdPattern = /^\d+\.\d+\.\d+(?:-[\w.]+)?-[0-9a-f]{12}(?:-r(?:[2-9]|[1-9]\d+))?$/u;
export const coreLocalEngineIdPattern = /^core-local-v1-[0-9a-f]{64}(?:-r(?:[2-9]|[1-9]\d+))?$/u;

export const legacyEngine = Object.freeze({
  packageName: 'cairn-memory-local-preview',
  packageVersion: '0.0.0-preview.1',
  binPath: 'bin/cairn-memory.mjs',
});

export const coreLocalEngine = Object.freeze({
  packageName: 'cairn-memory-core-local-candidate',
  packageVersion: '0.0.0',
  binPath: 'packaging/core-local/cli.mjs',
});

export function engineExecutable(app, { packageName, binPath } = legacyEngine) {
  return join(app, 'node_modules', packageName, binPath);
}
