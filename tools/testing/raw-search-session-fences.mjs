import assert from 'node:assert/strict';
import {openRawCaptureCore} from '../../core/raw-capture.mjs';
import {localPlainPort} from '../../core/testing/raw-fixtures.mjs';
import {rationaleModel} from '../../core/testing/rationale-model.mjs';

// Fixtures use codex sessions. This production client has no fixture messages.
export function seedSessionFences(path,namespace,count){
  assert.ok(Number.isSafeInteger(count)&&count>=0&&count<=50000,'invalid session fence count');
  if(!count)return;
  const core=openRawCaptureCore({path,model:rationaleModel()},{mode:'raw-v1',port:localPlainPort(),readPolicy:()=>({generation:'synthetic',reason:null})});
  try{for(let i=0;i<count;i++){
    const result=core.fenceSession({namespace,client:'claude-code',sessionId:'synthetic-window-fence-'+i});
    assert.equal(result.ok,true,JSON.stringify(result));
  }}finally{core.close();}
}
export function sessionFenceCount(args=process.argv.slice(2)){
  const index=args.findIndex(value=>value==='--session-fences'||value.startsWith('--session-fences='));
  const value=index<0?0:Number(args[index]==='--session-fences'?args[index+1]:args[index].slice(17));
  assert.ok(Number.isSafeInteger(value)&&value>=0&&value<=50000,'invalid --session-fences');return value;
}
