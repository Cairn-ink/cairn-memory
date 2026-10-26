import { lstat, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { types } from 'node:util';
import { ownData } from '../../../core/local-authority-input.mjs';
import { readLocalInstallation } from './local-setup.mjs';
import { createLocalRawHost } from './local-host.mjs';
import { directory, events } from './local-setup-files.mjs';
import { absolute, exact, locations, runtime, checkSignal, fail, failure } from './local-setup-input.mjs';

const hookResult = (status,reason = null) => Object.freeze({ version:'local-raw-hook-v1',status,reason });
function nativeRows(value,fields) {
  if (types.isProxy(value) || !Array.isArray(value)) fail('event_refused');
  const descriptors=Object.getOwnPropertyDescriptors(value),length=descriptors.length.value;
  if (length>256 || Reflect.ownKeys(descriptors).length!==length+1) fail('event_refused');
  for(let index=0;index<length;index++){
    const entry=descriptors[index];if(!entry || !Object.hasOwn(entry,'value'))fail('event_refused');
    const row=ownData(entry.value,fields);
    if(Object.values(row).some(item=>!(typeof item==='string'&&item.length<=16000||typeof item==='boolean')))fail('event_refused');
  }
}
function payload(value,event,client) {
  let input;
  try { input = ownData(value,['hook_event_name','session_id','transcript_path','cwd','permission_mode','model',
    'stop_hook_active','last_assistant_message','trigger','custom_instructions','source','prompt','turn_id','agent_id','agent_type',
    'session_title','background_tasks','session_crons']); }
  catch { fail('event_refused'); }
  if (!events(client).includes(event) || input.hook_event_name !== event || typeof input.session_id !== 'string' ||
      !input.session_id || input.session_id.length > 200 || input.session_id.trim() !== input.session_id ||
      !input.session_id.isWellFormed() || /[\x00-\x1f\x7f]/.test(input.session_id) || !absolute(input.transcript_path)) fail('event_refused');
  // Extra native data is never interpreted as configuration or execution input.
  for (const [key,item] of Object.entries(input)) {
    if(key==='background_tasks')nativeRows(item,['id','type','status','description','command','agent_type','server','tool','name']);
    else if(key==='session_crons')nativeRows(item,['id','schedule','recurring','prompt']);
    else if (!['hook_event_name','session_id','transcript_path'].includes(key) &&
      !(item === null || typeof item === 'string' && item.length<=65536 || typeof item === 'boolean')) fail('event_refused');
  }
  return { sessionId:input.session_id,sourcePath:input.transcript_path };
}
async function source(record,path) {
  const root = record.request.sourceRoot;
  if (!path.startsWith(root+'/')) fail('source_refused');
  const identity = await directory(root);
  if (identity.device !== record.sourceIdentity.device || identity.inode !== record.sourceIdentity.inode) fail('source_refused');
  // Check every component, not just the final realpath: aliases, intermediate
  // symlinks and unsafe/foreign ancestors cannot select an unrelated transcript.
  let current = root;
  const components = relative(root,path).split('/');
  for (let index = 0; index < components.length; index++) {
    current = join(current,components[index]); const info = await lstat(current);
    if (info.isSymbolicLink() || info.uid !== process.getuid() || info.mode & 0o022 ||
        (index === components.length-1 ? !info.isFile():!info.isDirectory())) fail('source_refused');
  }
  if (await realpath(path) !== path) fail('source_refused');
}
export async function runLocalRawHook(value,options = {}) {
  try {
    const input = exact(value,['installationDirectory','event','payload']);
    const call = ownData(options,['signal']); checkSignal(call.signal); runtime();
    const paths = locations(input.installationDirectory),record = await readLocalInstallation(paths.root);
    if (record.phase !== 'active') fail(record.phase === 'rearm_required' ? 'rearm_required':'authority_changed');
    const selection = payload(input.payload,input.event,record.request.client);
    const host = createLocalRawHost({ profilePath:paths.profile });
    // No source contents or transcript metadata are inspected before the real
    // host has verified the exact preparation, profile and fresh SQL permission.
    if ((await host.status({ signal:call.signal })).status !== 'ready') fail('authority_changed');
    checkSignal(call.signal); await source(record,selection.sourcePath); checkSignal(call.signal);
    const outcome = await (input.event === 'SessionStart' || input.event === 'UserPromptSubmit'
      ? host.initialize({ ...selection,start:'eof' },{ signal:call.signal }) : host.run(selection,{ signal:call.signal }));
    return hookResult(outcome.status,['ready','progress'].includes(outcome.status) ? null:'capture_refused');
  } catch (error) {
    const outcome = failure(error); return hookResult(outcome.status,outcome.reason);
  }
}
