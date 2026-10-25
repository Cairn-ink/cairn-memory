import { ownData } from './topic-overview-input.mjs';
import { identifier, fail } from './validation.mjs';

export const memberKinds = ['fact', 'preference', 'decision', 'instruction', 'context'];
const id = value => { try { return identifier(value); } catch { fail('invalid_input'); } };
const revision = value => {
  if (!Number.isSafeInteger(value) || value < 1) fail('invalid_input');
  return value;
};
export function membersInput(input, ownerId) {
  const v = ownData(input, ['namespace', 'selection', 'accessRevision', 'kind', 'order',
    'limit', 'workLimit', 'maxBytes', 'deadlineMs', 'expectedSnapshot', 'cursor']);
  const n = ownData(v.namespace, ['ownerId', 'scope', 'projectId']);
  if (id(n.ownerId) !== ownerId || !Object.hasOwn(n, 'projectId')) fail('invalid_input');
  if (n.scope === 'personal' && n.projectId === null) n.projectId = '';
  else if (n.scope === 'project') n.projectId = id(n.projectId);
  else fail('invalid_input');
  const s = ownData(v.selection, ['type', 'mocId', 'revision', 'level']);
  let selection;
  if (s.type === 'unfiled') {
    if (Object.keys(s).length !== 1) fail('invalid_input');
    selection = { type: 'unfiled' };
  } else if (s.type === 'moc' && ['L1', 'L2'].includes(s.level)) {
    selection = { type: 'moc', mocId: id(s.mocId), revision: revision(s.revision), level: s.level };
  } else fail('invalid_input');
  const kind = v.kind === undefined ? null : v.kind, order = v.order === undefined ? 'id_asc' : v.order;
  if ((kind !== null && !memberKinds.includes(kind)) || order !== 'id_asc') fail('invalid_input');
  const bounds = {};
  for (const [key, fallback, min, max] of [['limit', 100, 1, 100], ['workLimit', 5000, 16, 50000],
    ['maxBytes', 65536, 4096, 262144], ['deadlineMs', 1000, 50, 5000]]) {
    const value = v[key] === undefined ? fallback : v[key];
    if (!Number.isSafeInteger(value) || value < min || value > max) fail('invalid_input');
    bounds[key] = value;
  }
  let expectedSnapshot;
  if (v.expectedSnapshot !== undefined) {
    const e = ownData(v.expectedSnapshot, ['indexRevision', 'generation', 'originToken']);
    revision(e.indexRevision);
    if (e.generation !== null && (typeof e.generation !== 'string' || !e.generation ||
        !e.generation.isWellFormed() || e.generation.length > 200)) fail('invalid_input');
    if (typeof e.originToken !== 'string' || !/^[\x20-\x7e]{1,256}$/.test(e.originToken)) fail('cursor_stale');
    expectedSnapshot = { indexRevision: e.indexRevision, generation: e.generation, originToken: e.originToken };
  }
  if (v.cursor !== undefined && (typeof v.cursor !== 'string' || !/^[\x20-\x7e]{1,256}$/.test(v.cursor))) fail('invalid_cursor');
  return { namespace: { ownerId: n.ownerId, scope: n.scope, projectId: n.projectId }, selection,
    accessRevision: id(v.accessRevision), kind, order, ...bounds,
    ...(expectedSnapshot === undefined ? {} : { expectedSnapshot }),
    ...(v.cursor === undefined ? {} : { cursor: v.cursor }) };
}
