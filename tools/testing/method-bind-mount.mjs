// Test infrastructure only. Prerequisite failure and mounted-child failure are
// separate processes and statuses; an importer failure can never become a skip.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {openSync,closeSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

export const METHOD_MOUNT_UNAVAILABLE=77;
function run(workspace,label,command,args){
  const outPath=join(workspace.path,label+'.stdout'),errPath=join(workspace.path,label+'.stderr');
  const out=openSync(outPath,'wx'),err=openSync(errPath,'wx');let result;
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  try{result=spawnSync(command,args,{env,timeout:15000,stdio:['ignore',out,err]});}
  finally{closeSync(out);closeSync(err);}
  const stderr=readFileSync(errPath,'utf8');
  assert.equal(result.error,undefined,String(result.error));assert.equal(result.signal,null,stderr);
  return {...result,stderr};
}
export function methodMountPreflight(workspace,source,target,label='mount-preflight'){
  const marker=join(workspace.path,label+'.namespace');
  // Only namespace entry and bind creation may produce the dedicated 77.
  // Marker/cleanup failures have a different status and must fail acceptance.
  const result=run(workspace,label,'/bin/sh',['-c',`
    /usr/bin/unshare -Urm -- /bin/sh -c '
      printf namespace > "$1" || exit 78
      mount --bind "$2" "$3" || exit 77
      umount "$3" || exit 78
    ' method-mount-prerequisite "$1" "$2" "$3"
    result=$?
    # Only unshare's namespace-entry failure (1) needs marker classification.
    # Preserve explicit mount/infrastructure statuses, including marker failure 78.
    if [ "$result" -eq 1 ] && [ ! -f "$1" ]; then exit 77; fi
    exit "$result"
  `,'method-mount-preflight',marker,source,target]);
  if(result.status!==METHOD_MOUNT_UNAVAILABLE)assert.equal(result.status,0,result.stderr);
  return result;
}
export function mountedMethodProcess(workspace,source,target,command,args,label='mount-child'){
  const result=run(workspace,label,'/usr/bin/unshare',['-Urm','--','/bin/sh','-c',`
    mount --bind "$1" "$2" || exit 78
    mountTarget="$2"
    shift 2
    "$@"
    result=$?
    umount "$mountTarget" || exit 79
    exit "$result"
  `,'method-mounted-child',source,target,command,...args]);
  assert.equal(result.status,0,result.stderr||'mounted child exit '+result.status);
  return result;
}
