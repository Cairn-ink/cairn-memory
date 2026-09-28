import { rationaleModel } from './rationale-model.mjs';
const ns = { ownerId: 'parity', scope: 'personal', projectId: null };

export function bytes(value) {
  return JSON.stringify(value, (key, value) => key === 'signal' ? undefined : typeof value === 'string' ? value
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID')
    .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, 'TIME') : value);
}
export async function readOutputs(open, path) {
  const calls = [], core = open({ path, model: rationaleModel((method, request) => calls.push({ method, request })) });
  try {
    const result = {}, list = core.list({ namespace: ns }); result.list = list;
    const { id, revision } = list.value.memories[0];
    result.get = core.get({ namespace: ns, memoryId: id });
    result.map = core.map({ namespace: ns });
    result.snapshot = core.sourceSnapshot({ readSet: [ns] });
    result.fetch = core.fetch({ namespace: ns, refs: [{ memoryId: id, revision }] });
    result.recall = await core.recall({ readSet: [ns], query: 'offline tools' });
    result.context = core.sessionStartContext({ namespace: ns });
    const now = Date.now(), range = { namespace: ns, since: new Date(now - 86400000).toISOString(), until: new Date(now + 86400000).toISOString() };
    result.range = core.listMemoriesByTime(range); result.episodes = core.listEpisodes(range);
    result.inspect = core.inspectAdmission({ namespace: ns, client: 'scripted', eventId: 'event', includeInitialClassification: true });
    result.calls = calls;
    return bytes(result);
  } finally { core.close(); }
}
