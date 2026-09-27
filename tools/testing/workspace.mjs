import { lstatSync, mkdtempSync, realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Test-only ownership: never adopt an existing directory or search by prefix.
export function createTestWorkspace(t, { prefix = 'cairn-test-', parent = tmpdir() } = {}) {
  if (typeof prefix !== 'string' || !/^[\w.-]+$/.test(prefix) || prefix === '.' || prefix === '..') {
    throw new TypeError('invalid_test_workspace_prefix');
  }
  if (t != null && typeof t.after !== 'function') throw new TypeError('invalid_test_context');
  const ownerParent = realpathSync(parent);
  const path = mkdtempSync(join(ownerParent, prefix));
  const identity = lstatSync(path);
  const deferred = [];
  let completion;
  const cleanup = () => {
    if (completion) return completion;
    completion = (async () => {
      const errors = [];
      while (deferred.length) {
        try { await deferred.pop()(); } catch (error) { errors.push(error); }
      }
      try {
        const current = lstatSync(path);
        if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev ||
            current.ino !== identity.ino || realpathSync(ownerParent) !== ownerParent) {
          throw new Error('test_workspace_identity_changed');
        }
        await rm(path, { recursive: true, force: false });
      } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'test_workspace_cleanup_failed');
    })();
    return completion;
  };
  const workspace = { path, cleanup, defer(fn) {
    if (completion) throw new Error('test_workspace_cleanup_started');
    if (typeof fn !== 'function') throw new TypeError('invalid_test_workspace_cleanup');
    deferred.push(fn);
  } };
  if (t != null) t.after(cleanup);
  return workspace;
}
