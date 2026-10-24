import { parentPort,workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { createTopicSession } from '../../../core/topic-members-session.mjs';
import { createTopicMemberReader } from '../../../core/topic-members-reader.mjs';
import { createTopicTokens } from '../../../core/topic-snapshot.mjs';
import { membersInput } from '../../../core/topic-members-input.mjs';
import { safeReaderFailure } from '../../../core/topic-overview-input.mjs';
let reader,work;
parentPort.on('message',async input=>{
  const start=performance.now();work=0;
  try {
    if(!reader){
      const session=createTopicSession(workerData.path),tokens=createTopicTokens();
      reader=createTopicMemberReader({...session,tokens,observe:entry=>{work=entry.used;}});
    }
    const result=await reader.read(membersInput(input,workerData.ownerId),start+input.deadlineMs);
    parentPort.postMessage({result,work,bytes:Buffer.byteLength(JSON.stringify(result)),start,end:performance.now()});
  }catch(e){const result=safeReaderFailure(e);parentPort.postMessage({result,work,bytes:Buffer.byteLength(JSON.stringify(result)),start,end:performance.now()});}
});
