import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const [root, path, report] = process.argv.slice(2);
const { openContextReader } = await import(pathToFileURL(root + '/core/index.mjs'));
const grants = new WeakMap(), token = {}, authority = { authorize(request, supplied) {
  if (supplied !== token) return null; const { input, ...binding } = request, grant = {}; grants.set(grant, binding); return grant;
}, isCurrent(grant) { return grants.has(grant) ? { ...grants.get(grant), accessGeneration: 1 } : null; } };
const core = openContextReader({ path, contextRead: { version: 'context-read-v1', authority, sources: ['relations-one-hop-v1', 'moc-v1'] } });
try {
  const result = await core.findCandidates({ readSet: [{ ownerId: 'synthetic-u5a', scope: 'project', projectId: 'test' }],
    query: 'needle', types: ['memory'], intent: 'current', deadlineMs: 5000 }, token);
  if (!result.ok) throw Error(JSON.stringify(result)); writeFileSync(report, JSON.stringify(result));
} finally { core.close(); }
