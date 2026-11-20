import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('all three signal sites are adjacent to their final synchronous owner check', () => {
  const source = readFileSync(new URL('../local-daemon-liveness.mjs', import.meta.url), 'utf8');
  // Exact adjacency admits only whitespace and try syntax. An inserted await,
  // yield, call, comment, or other statement anywhere in each gap fails closed.
  // Pin the default adapters too: an async signal callback would otherwise
  // yield after the adjacent call but before process.kill reaches the kernel.
  assert.match(source, /alive = owner => verifiedOwner\(owner\), signal = \(owner, code\) => process\.kill\(owner\.pid, code\),/);
  for (const name of ['processStart', 'localProcessIdentity', 'startAwareAlive', 'verifiedOwner'])
    assert.ok(source.includes('export function ' + name + '('), 'owner check stays synchronous: ' + name);
  const sites = [
    /if \(!alive\(current\.owner\)\) return;\s*try \{ signal\(current\.owner, 'SIGTERM'\);/g,
    /if \(alive\(current\.owner\)\) \{\s*try \{ signal\(current\.owner, 'SIGKILL'\);/g,
    /if \(!verifiedOwner\(descriptor\.owner\)\) continue;\s*try \{ process\.kill\(descriptor\.owner\.pid, 'SIGTERM'\);/g,
  ];
  for (const pattern of sites) assert.equal([...source.matchAll(pattern)].length, 1, 'one pinned check/signal pair: ' + pattern);
  assert.equal([...source.matchAll(/signal\(current\.owner, 'SIG(?:TERM|KILL)'\)/g)].length, 2);
  assert.equal([...source.matchAll(/process\.kill\(descriptor\.owner\.pid,/g)].length, 1);
  assert.match(source, /return current !== null && !current.zombie && current.start === owner.start;/);
  assert.match(source, /if \(owner.boot !== live.boot\) return false;/);
  assert.match(source, /if \(owner.namespace !== live.namespace\) throw refuse\('daemon_namespace'\);/);
  assert.match(source, /statSync\(`\/proc\/\$\{owner.pid\}`\).uid === uid/);
});
