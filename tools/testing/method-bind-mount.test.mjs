import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createTestWorkspace} from './workspace.mjs';
import {methodMountPreflight,METHOD_MOUNT_UNAVAILABLE} from './method-bind-mount.mjs';

test('H02 real preflight marker-write failure preserves status 78 and cannot become a skip',t=>{
  const workspace=createTestWorkspace(t),source=join(workspace.path,'source'),target=join(workspace.path,'target');
  mkdirSync(source);mkdirSync(target);
  const prerequisite=methodMountPreflight(workspace,source,target,'available');
  if(prerequisite.status===METHOD_MOUNT_UNAVAILABLE){t.skip('UNVERIFIED namespace/mount prerequisite: '+prerequisite.stderr.trim());return;}
  // Namespace/mount support is proven above. The second real subprocess enters
  // the namespace, fails its marker redirection, and explicitly exits 78.
  mkdirSync(join(workspace.path,'blocked-marker.namespace'));
  assert.throws(()=>methodMountPreflight(workspace,source,target,'blocked-marker'),{code:'ERR_ASSERTION',actual:78});
});
