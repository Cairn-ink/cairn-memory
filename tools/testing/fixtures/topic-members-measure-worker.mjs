import { parentPort,workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { lstatSync } from 'node:fs';
import { openReadDatabase } from '../../../core/read-database.mjs';
import { createTopicOverviewStorage } from '../../../core/topic-overview-storage.mjs';
import { createTopicMembersStorage } from '../../../core/topic-members-storage.mjs';
import { createTopicMemberReader } from '../../../core/topic-members-reader.mjs';
import { createTopicTokens } from '../../../core/topic-snapshot.mjs';
import { membersInput } from '../../../core/topic-members-input.mjs';
import { safeReaderFailure } from '../../../core/topic-overview-input.mjs';
let connection,reader,work;
parentPort.on('message',async input=>{
  const start=performance.now();work=0;
  try {
    if(!connection){
      connection=openReadDatabase(workerData.path,{topicMembers:true});
      const overview=createTopicOverviewStorage(connection.db),tokens=createTopicTokens();
      const transaction=fn=>{connection.db.exec('BEGIN');try{const result=fn();connection.db.exec('COMMIT');return result;}catch(e){connection.db.exec('ROLLBACK');throw e;}};
      reader=createTopicMemberReader({storage:createTopicMembersStorage(connection.db),tokens,transaction,
        snapshot:ns=>{connection.assertFile();return overview.snapshot(ns);},
        originBinding:(namespace,captured)=>{const s=lstatSync(workerData.path);return {namespace,captured,file:[s.dev,s.ino],schema:connection.db.prepare('PRAGMA user_version').get().user_version};},
        observe:entry=>{work=entry.used;}});
    }
    const result=await reader.read(membersInput(input,workerData.ownerId),start+input.deadlineMs);
    parentPort.postMessage({result,work,bytes:Buffer.byteLength(JSON.stringify(result)),start,end:performance.now()});
  }catch(e){const result=safeReaderFailure(e);parentPort.postMessage({result,work,bytes:Buffer.byteLength(JSON.stringify(result)),start,end:performance.now()});}
});
