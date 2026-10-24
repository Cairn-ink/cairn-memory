import { open, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../../tools/testing/workspace.mjs';
import { FORMAT } from '../../../codex/parser.mjs';
export const sessionId = '11111111-1111-4111-8111-111111111111';
export const key = Buffer.alloc(32,0x31);
export const pluginRoot = '/synthetic/cairn-memory/0.3.2';
export const claude = text => ({ type:'user',uuid:'synthetic-message',timestamp:null,promptSource:'typed',message:{ content:[{ type:'text',text }] } });
export const codex = text => ({ type:'event_msg',timestamp:null,payload:{ type:'item_completed',thread_id:sessionId,turn_id:'synthetic-turn',
  item:{ type:'UserMessage',id:'native-message',content:[{ type:'text',text }] } } });
export async function recordFixture(t,client,row) {
  const workspace = createTestWorkspace(t,{ prefix:'raw-producer-' }), path = join(workspace.path,'source.jsonl');
  const header = client==='codex' ? JSON.stringify({ type:'session_meta',payload:{ id:sessionId,cli_version:'0.162.0',history_mode:'paginated',source:'cli',originator:'codex-tui' } })+'\n':'';
  const text = typeof row==='string' ? row:JSON.stringify(row)+'\n';
  await writeFile(path,header+text,{ mode:0o600 });
  const file = await open(path,'r'); workspace.defer(() => file.close()); let maxRead = 0;
  const source = { read(buffer,offset,length,position) { maxRead = Math.max(maxRead,length); return file.read(buffer,offset,length,position); } };
  return { workspace,path,source,get maxRead() { return maxRead; },input:{ source,range:{ start:Buffer.byteLength(header),end:Buffer.byteLength(header+text) },
    client,sessionId,wireSessionId:'synthetic-wire-session',generation:'initial',epoch:0,messageOrdinal:1,
    selectionState:client==='codex' ? {}:{ ownSkillTurn:false,pluginRoot },
    formatAuthority:client==='codex' ? { format:FORMAT,sessionId,creatorVersion:'0.162.0',qualifiedCreatorVersion:null }:null } };
}
