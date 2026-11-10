import { contentSuppressionReasonInside } from '../../core/content-suppression-storage.mjs';
import { isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { identifier } from '../../core/validation.mjs';

const help = `Cairn Memory — local Raw conversation commands

Usage:
  cairn-memory raw list --db ABS --owner ID [--project ID]
  cairn-memory raw delete --db ABS --owner ID [--project ID] --conversation ID [--yes]

List and delete print metadata only. Delete is a dry run unless --yes is supplied.
See docs/raw-local-journal.md for deletion and retention details.`;

// Explicit local operator surface. No model, source decoding or MCP tool.
export async function rawCommand(args, write = line => console.log(line), {testDeleteCapMs} = {}) {
  if (args.length === 1 && args[0] === '--help') { write(help); return 0; }
  // Only synthetic tests can shorten the overall monotonic deadline.
  const capMs=process.env.NODE_TEST_CONTEXT && Number.isFinite(testDeleteCapMs) && testDeleteCapMs>=0
    ? Math.min(testDeleteCapMs,600000):600000;
  const deadline=performance.now()+capMs;
  let core, db;
  const emit = value => write(JSON.stringify(value));
  try {
    const [operation,...flags] = args, values = new Map();
    const invalid = () => { throw Object.assign(Error(),{code:'invalid_raw_arguments'}); };
    if (!['list','delete'].includes(operation)) invalid();
    for (let i=0;i<flags.length;i++) {
      const flag=flags[i];
      if (values.has(flag)) invalid();
      if (flag==='--yes' && operation==='delete') { values.set(flag,true); continue; }
      if (!['--db','--owner','--project',...(operation==='delete'?['--conversation']:[])].includes(flag) ||
          !flags[i+1] || flags[i+1].startsWith('--')) invalid();
      values.set(flag,flags[++i]);
    }
    const path=values.get('--db'), ownerId=values.get('--owner'), projectId=values.get('--project')??null;
    if (!path || !isAbsolute(path) || path.includes('\0') || !ownerId) invalid();
    try { identifier(ownerId); if(projectId!==null)identifier(projectId); } catch { invalid(); }
    const id=values.get('--conversation');
    if(operation==='delete') {
      try { identifier(id); } catch { invalid(); }
      if(/[*?%\[\]]/.test(id))invalid();
    }
    const namespace={ownerId,scope:projectId===null?'personal':'project',projectId};
    // A typo must not create a store, and inspection must not install a package.
    const {DatabaseSync}=await import('node:sqlite');
    db=new DatabaseSync(path,{readOnly:true,timeout:5000});
    if(!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='local_raw_uuid_delete_guard' AND type='trigger'").get())
      throw Object.assign(Error(),{code:'unsupported_database'});
    const {openMemoryCore}=await import('../../core/index.mjs');
    core=openMemoryCore({path,raw:true,rawSearch:false});
    if(typeof core.deleteConversation!=='function')throw Object.assign(Error(),{code:'unsupported_database'});
    const boundary=[ownerId,namespace.scope,projectId??''];
    // Metadata only, including hidden rows so owners can reach the remedy.
    // Do not select session keys into output, payloads, excerpts or sealed parts.
    const select=db.prepare(`SELECT c.id,c.client,c.revision,
      min(m.occurred_at) AS firstEventAt,max(m.occurred_at) AS lastEventAt,
      count(m.message_id) AS messageCount,coalesce(sum(m.total_bytes),0) AS byteCount,
      EXISTS(SELECT 1 FROM raw_session_fences f WHERE
        (f.owner_id,f.scope,f.project_id,f.client,f.session_key)=(c.owner_id,c.scope,c.project_id,c.client,c.session_key)) AS fenced
      FROM raw_conversations c LEFT JOIN raw_messages m ON m.conversation_id=c.id
      WHERE c.owner_id=? AND c.scope=? AND c.project_id=? ${id?'AND c.id=?':'AND c.id>?'}
      GROUP BY c.id ORDER BY c.id LIMIT 100`);
    // Count messages, not ordinals: imported conversations can have gaps.
    // The core's bounded preflight also drains older jobs, so pending is global.
    const progress=db.prepare(`SELECT EXISTS(SELECT 1 FROM raw_session_fences f WHERE
      (f.owner_id,f.scope,f.project_id,f.client,f.session_key)=(c.owner_id,c.scope,c.project_id,c.client,c.session_key)) AS fenced,
      count(m.message_id) AS total,
      coalesce(sum(m.ordinal<=coalesce(j.last_ordinal,0)),0) AS prepared,
      (EXISTS(SELECT 1 FROM local_raw_uuid_jobs WHERE complete=0) OR
        NOT EXISTS(SELECT 1 FROM local_raw_uuid_backfill WHERE singleton=1 AND complete=1)) AS pending
      FROM raw_conversations c LEFT JOIN raw_messages m ON m.conversation_id=c.id
      LEFT JOIN local_raw_uuid_jobs j ON
        (j.owner_id,j.scope,j.project_id,j.client,j.session_key)=(c.owner_id,c.scope,c.project_id,c.client,c.session_key)
      WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND c.id=?`);
    let after='';
    do {
      db.exec('BEGIN');
      let rows;
      try {
        rows=select.all(...boundary,id??after).map(({revision,fenced,...row})=>({
          ...row,revision,fenced:Boolean(fenced),hidden:Boolean(fenced || contentSuppressionReasonInside(db,namespace,{kind:'raw',key:row.id}))}));
        db.exec('COMMIT');
      } catch(error) {db.exec('ROLLBACK');throw error;}
      if(operation==='list') {for(const {revision,...row}of rows)emit(row);after=rows.at(-1)?.id??after;if(rows.length<100)break;continue;}
      const row=rows[0];
      if(!row)throw Object.assign(Error(),{code:'conversation_not_found'});
      const input={namespace,conversationId:id,expectedRevision:row.revision,retainMemories:true};
      const result=values.has('--yes')?core.deleteConversation({...input,actionId:randomUUID()}):core.previewDeleteConversation(input);
      if(!result.ok){
        if(values.has('--yes') && result.error.retryable===true) {
          let retry=false;
          if(result.error.code==='storage_busy') {
            // Contention can occur in either probe or the destructive pass,
            // independently of UUID hashing. Do not label it hash progress.
            process.stderr.write('storage busy; waiting to retry\n');
            retry=true;
          } else if(result.error.code==='local_raw_privacy_write_failed') {
            const counts=progress.get(...boundary,id);
            // Another writer can finish after our bounded pass returns. An
            // empty aggregate also describes an existing empty conversation,
            // so confirm absence before reporting the requested deletion done.
            if(!counts.pending && !select.get(...boundary,id)) {
              const {revision,...metadata}=row;
              emit({ok:true,dryRun:false,...metadata,conversationId:id});return 0;
            }
            if(counts.pending || counts.fenced && counts.prepared===counts.total) {
              process.stderr.write(`${counts.prepared.toLocaleString('en-US')}/${counts.total.toLocaleString('en-US')} prepared\n`);
              retry=true;
            }
          }
          if(retry) {
            // No transaction or writer is held between normal deletion calls.
            // Yield for signals and other sessions, then re-read the revision.
            await new Promise(resolve=>setTimeout(resolve,250));
            if(performance.now()<deadline)continue;
            process.stderr.write('rerun the same command to continue\n');
          }
        }
        emit(result);return result.error.retryable?3:1;
      }
      const {revision,...metadata}=row;
      emit({ok:true,dryRun:!values.has('--yes'),...metadata,...result.value});
      break;
    } while(true);
    return 0;
  } catch(error) {
    const code=['invalid_raw_arguments','conversation_not_found','unsupported_database','unsafe_database_file'].includes(error.code)?error.code:'raw_command_failed';
    emit({ok:false,error:{code,retryable:false}});return code==='invalid_raw_arguments'?2:1;
  } finally {db?.close();await core?.close();}
}
