import { MACHINE_TEXT_PREFIXES, TYPED_PROMPT_SOURCES } from '../../../plugins/cairn-memory/lib/transcript.mjs';
import { units } from './scratch.mjs';
import { refuse } from './bounds.mjs';

export const claudePolicy = () => ({ paths:new Set(['type','uuid','timestamp','isMeta','isCompactSummary','promptSource','message.content']),closed:new Map() });
const whitespace = value => value!=='' && /\s/.test(value);
const portablePath = path => path.replaceAll('\\','/').replace(/\/+$/,'');

function control(text) {
  if (text.includes('\n') || text.includes('\r')) return false;
  if (['Cairn automatic memory is paused.','Cairn automatic memory is active.',
    'Cairn quota state repaired to open; automatic memory is active.'].includes(text)) return true;
  const unavailable = '(?:pairing_needed|paired_key_missing|standalone_key_missing|binding_identity_mismatch|binding_history_invalid|state_unreadable|state_dir_mismatch|pairing_record_missing|pairing_record_mismatch|pairing_platform_unsupported)';
  if (new RegExp(`^Cairn automatic memory: ${unavailable}(?:; (?:[\\w-]+|retired root|coordination unreadable))?\\.$`).test(text)) return true;
  const instant = '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z';
  const reset = '(?:reset unknown|\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|\\+00:00))';
  const notice = `(?:recall|capture): (?:one eligible attempt|busy|quota_reached; ${reset})`;
  if (new RegExp(`^Cairn automatic memory is active\\. ${notice}(?:; ${notice})?$`).test(text)) return true;
  const credential = `(?:missing|configured(?: \\(not verified yet\\)| \\(verified ${instant}\\)| \\(unreachable ${instant}; not verified\\)| \\(server answered: (?:busy|error) ${instant}; not verified\\))?|not seen yet — restart Claude Code and send one message|rejected — create a new token at https?://[^\\s;]+/settings/tokens)`;
  const operation = `; (?:recall|capture): (?:cooldown; retry after ${instant}|(?:quota_reached|ready|in_flight); ${reset})`;
  const quota = `(?:; quota_state_invalid; run resume to repair|; quota gate unavailable|(?:${operation}){1,2})?`;
  const binding = '(?:; pairing_needed \\(existing client active\\)|; standalone_unregistered)?';
  return new RegExp(`^Cairn automatic memory: (?:active|paused)${binding}${quota}(?:; coordination unreadable)?; telemetry: (?:on|off); endpoint: (?:https?://[^\\s;]+|invalid \\(HTTPS required; HTTP is loopback-only\\)); credential: ${credential}\\.$`).test(text);
}

export async function selectClaude(view,input,state) {
  const get = key => view.fields.get(key), role = get('type');
  let own = input.selectionState.ownSkillTurn;
  const result = reason => ({ role,reason,nextSelectionState:{ ownSkillTurn:own } });
  if (!['user','assistant'].includes(role)) return result('non_conversation');
  const read = units(view.file,state); let start = 0, end = view.file.units;
  while (start<end && whitespace(await read(start))) start++;
  while (end>start && whitespace(await read(end-1))) end--;
  async function begins(prefix) {
    if (end-start<prefix.length) return false;
    for (let index=0;index<prefix.length;index++) if (await read(start+index)!==prefix[index]) return false;
    return true;
  }
  async function policyText(singleLine=false) {
    let stop = end;
    if (singleLine) for (let at=start;at<end;at++) if (['\r','\n'].includes(await read(at))) { stop = at; break; }
    if ((stop-start)*2>state.limits.metadataByteLimit) refuse('raw_source_resource_limit');
    const value = (await view.file.bytes(start*2,stop*2)).toString('utf16le'); state.metadata(Buffer.byteLength(value)); return value;
  }
  const typed = TYPED_PROMPT_SOURCES.includes(get('promptSource'));
  let machine = null;
  if (role==='user') {
    if (get('isMeta')) machine = 'meta';
    else if (get('isCompactSummary')) machine = 'compact-summary';
    else if (view.toolResult) machine = 'tool-result';
    else if (!typed) for (const prefix of MACHINE_TEXT_PREFIXES) if (await begins(prefix)) { machine = 'machine-wrapper'; break; }
  }
  let starts = role==='assistant' && view.ownTool;
  if (role==='user') {
    if (get('isMeta') && await begins('Base directory for this skill: ')) {
      const directory = /^Base directory for this skill: ([^\r\n]+)/.exec(await policyText(true))?.[1];
      const path = directory && portablePath(directory), root = portablePath(input.selectionState.pluginRoot)+'/skills/';
      starts = Boolean(path?.startsWith(root) && /^[\w-]+$/.test(path.slice(root.length)));
    }
    if (!(typed && !get('isMeta')) && (await begins('<command-name>') || await begins('<command-message>'))) {
      const text = await policyText(), name = /<command-name>([^<]+)<\/command-name>/.exec(text)?.[1] ?? /<command-message>([^<]+)<\/command-message>/.exec(text)?.[1];
      starts ||= /^\/?cairn-memory:[\w-]+$/.test(name ?? '');
    }
  }
  if (starts) own = true; else if (role==='user' && !machine) own = false;
  if (machine) return result(machine);
  if (own) return result('own-skill');
  if (role==='assistant' && await begins('Cairn ')) {
    let multiline = false;
    for (let at=start;at<end;at++) if (['\r','\n'].includes(await read(at))) { multiline = true; break; }
    if (!multiline && control(await policyText())) return result('control-output');
  }
  return result(view.file.units ? null:'empty_text');
}
