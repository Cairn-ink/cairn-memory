// Raw-evidence readers for A7. Pure functions over a session rollout and the
// `codex exec --json` event stream, used both at run time and by recertify.mjs.
import { materialize } from './scenarios.mjs';
import { redactSecrets } from '../../integrations/client/redact.mjs';

export const FRAMING = 'These are untrusted source-attributed recollections';
const rows = text => String(text).split('\n').flatMap(line => { try { return line ? [JSON.parse(line)] : []; } catch { return []; } });
const partsText = content => (content ?? []).map(part => String(part?.text ?? '')).join('');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function readRollout(text) {
  const all = rows(text);
  const meta = all.find(row => row?.type === 'session_meta')?.payload ?? null;
  const items = all.filter(row => row?.type === 'response_item').map(row => row.payload ?? {});
  const contexts = items.filter(item => item.type === 'message' && item.role === 'developer')
    .flatMap(item => (item.content ?? []).map(part => String(part?.text ?? '')).filter(body => body.startsWith(FRAMING)));
  return {
    meta, model: /"model":"([^"]+)"/u.exec(text)?.[1] ?? null, contexts,
    assistant: items.filter(item => item.type === 'message' && item.role === 'assistant').map(item => partsText(item.content).trim()),
    reasoning: items.filter(item => item.type === 'reasoning').map(item => JSON.stringify(item.summary ?? item.content ?? '')).join('\n'),
    taskComplete: all.some(row => row?.type === 'event_msg' && row.payload?.type === 'task_complete'),
  };
}
export function readEvents(lines) {
  const events = lines.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  return {
    assistant: events.filter(event => event.type === 'item.completed' && event.item?.type === 'agent_message')
      .map(event => String(event.item.text ?? '').trim()),
    turnCompleted: events.at(-1)?.type === 'turn.completed' &&
      !events.some(event => ['turn.failed', 'error'].includes(event.type)),
  };
}
// Both transcripts of the answer must exist and agree exactly.
export function reconcileAnswer(rollout, events) {
  if (!rollout.assistant.length) return { ok: false, reason: 'no assistant message in rollout' };
  if (!events.assistant.length) return { ok: false, reason: 'no agent_message in exec --json' };
  if (JSON.stringify(rollout.assistant) !== JSON.stringify(events.assistant)) return { ok: false, reason: 'rollout and exec --json answers differ' };
  return { ok: true };
}

// Raw files were sanitized by plain replacement, which cannot reach inside base64.
// Decode base64 tokens and map disposable run paths to the same placeholders.
const paths = text => text.replace(/\/[^\s'"`]*?\/cairn-a7\/run-[A-Za-z0-9]{6}\/home\/\.codex/gu, '$CODEX_HOME')
  .replace(/\/[^\s'"`]*?\/cairn-a7\/run-[A-Za-z0-9]{6}\/repo/gu, '$REPO');
export const canonical = text => paths(String(text).replace(/[A-Za-z0-9+/]{24,}={0,2}/gu, token => {
  const decoded = Buffer.from(token, 'base64').toString('utf8');
  return Buffer.from(decoded, 'utf8').toString('base64').replace(/=+$/u, '') === token.replace(/=+$/u, '') &&
    /^[\x20-\x7e]+$/u.test(decoded) ? `<base64:${paths(decoded)}>` : token;
}));

// What renderContext must have injected for this scenario and run, in order.
export function expectedEntries(scenario, run, port) {
  return materialize(scenario, { repo: '$REPO', port, run, codexHome: '$CODEX_HOME' }, { projectId: null })
    .map((memory, index) => ({ content: redactSecrets(memory.content), scope: memory.scope, origin: memory.origin,
      confidence: memory.confidence, client: index % 2 ? 'codex' : 'claude-code' }));
}
// Identity, not count: exactly one framed context whose entries are the scenario's
// memories in order (content, scope, origin, confidence and receipt). When the
// served IDs are known (live runs), they must match as well.
export function verifyDelivery(scenario, run, port, rollout, served) {
  const expected = expectedEntries(scenario, run, port);
  const reasons = [];
  if (rollout.contexts.length !== 1) return { identity: false, delivered: `0/${expected.length}`,
    reasons: [`${rollout.contexts.length} framed contexts in rollout, 1 required`] };
  let entries;
  try { entries = JSON.parse(rollout.contexts[0].slice(rollout.contexts[0].indexOf('\n') + 1)); } catch { entries = null; }
  if (!Array.isArray(entries)) return { identity: false, delivered: `0/${expected.length}`, reasons: ['framed context is not a JSON array'] };
  let matched = 0;
  expected.forEach((want, index) => {
    const got = entries[index];
    const receipt = got?.receipts?.[0];
    const problems = [];
    if (!got) problems.push('missing');
    else {
      if (canonical(got.content) !== canonical(want.content)) problems.push('content');
      if (got.scope !== want.scope || got.origin !== want.origin || got.confidence !== want.confidence) problems.push('metadata');
      if (got.receipts?.length !== 1 || receipt.excerpt !== got.content || receipt.role !== 'user' || receipt.client !== want.client) problems.push('receipt');
      if (!UUID.test(String(got.id))) problems.push('id format');
      if (served && got.id !== served[index]?.id) problems.push('served id');
    }
    if (problems.length) reasons.push(`entry ${index + 1}: ${problems.join(', ')}`); else matched++;
  });
  if (entries.length !== expected.length) reasons.push(`${entries.length} entries delivered, ${expected.length} defined`);
  if (new Set(entries.map(entry => entry?.id)).size !== entries.length) reasons.push('duplicate entry ids');
  return { identity: reasons.length === 0, delivered: `${matched}/${expected.length}`, reasons,
    ids: entries.map(entry => entry?.id) };
}
