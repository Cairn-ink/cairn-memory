// Frozen v1 validation and its helpers, so compatibility can be tested in a shallow checkout.
import { isAbsolute, join, relative, sep } from 'node:path';
import { SetupError } from '../../lib/errors.mjs';

export const engineIdPattern = /^\d+\.\d+\.\d+(?:-[\w.]+)?-[0-9a-f]{12}(?:-r(?:[2-9]|[1-9]\d+))?$/u;
const clients = ['claude', 'codex'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, names) => object(value) && Object.keys(value).sort().join(',') === [...names].sort().join(',');
export const validIdentifier = value => typeof value === 'string' && value.length > 0 &&
  value.length <= 200 && value.trim() === value && !/^-/u.test(value) && !/[\x00-\x1f\x7f]/u.test(value);
export const validPath = value => typeof value === 'string' && isAbsolute(value) &&
  !/[\x00-\x1f\x7f]/u.test(value) && !value.split(/[\\/]/u).includes('..');
export const inside = (root, path) => path === root || (!relative(root, path).startsWith('..' + sep) &&
  relative(root, path) !== '..' && !isAbsolute(relative(root, path)));
const recovery = root => new SetupError('local_recovery_required', 2, { path: join(root, 'installation.json') });
const validVector = value => keys(value, ['engineId', 'node', 'databasePath', 'ownerId', 'projectId']) &&
  engineIdPattern.test(value.engineId) && validPath(value.node) && validPath(value.databasePath) &&
  validIdentifier(value.ownerId) && (value.projectId === null || validIdentifier(value.projectId));
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function validateDescriptor(value, root) {
  const fail = () => { throw recovery(root); };
  if (!keys(value, ['version', 'state', 'installerVersion', 'ownerId', 'projectId', 'database', 'engine',
    'node', 'operation', 'clients', 'createdAt', 'updatedAt']) || value.version !== 'cairn-local-installation-v1' ||
      !['pending', 'installed', 'uninstalling', 'uninstalled'].includes(value.state) ||
      !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/u.test(value.installerVersion) || !validIdentifier(value.ownerId) ||
      !(value.projectId === null || validIdentifier(value.projectId)) || !iso(value.createdAt) || !iso(value.updatedAt) ||
      !keys(value.database, ['path', 'external']) || !validPath(value.database.path) ||
      typeof value.database.external !== 'boolean' || !keys(value.clients, clients)) fail();
  if (value.database.external ? inside(root, value.database.path) :
    value.database.path !== join(root, 'data/memory.sqlite')) fail();
  const databaseSafe = path => ![join(root, 'engine'), ...['.setup.lock', 'installation.json', '.npmrc'].map(name => join(root, name))]
    .some(target => inside(target, path));
  if (!databaseSafe(value.database.path)) fail();
  const consistent = vector => vector.ownerId === value.ownerId && vector.projectId === value.projectId && vector.databasePath === value.database.path;
  if (value.engine !== null && (!keys(value.engine, ['id', 'package', 'packageVersion', 'sha256']) ||
      !engineIdPattern.test(value.engine.id) || value.engine.package !== 'cairn-memory-local-preview' ||
      value.engine.packageVersion !== '0.0.0-preview.1' || !/^[a-f0-9]{64}$/u.test(value.engine.sha256))) fail();
  if (value.node !== null && !validPath(value.node)) fail();
  for (const client of clients) {
    const receipt = value.clients[client];
    if (receipt === null) continue;
    if (!keys(receipt, client === 'claude' ? ['server', 'scope', 'home', 'vector'] : ['server', 'configPath', 'vector']) ||
        receipt.server !== 'cairn-local' || (client === 'claude' && receipt.scope !== 'user') ||
        !validPath(client === 'claude' ? receipt.home : receipt.configPath) || !validVector(receipt.vector) || !consistent(receipt.vector) ||
        !databaseSafe(receipt.vector.databasePath)) fail();
  }
  const op = value.operation;
  if (op !== null) {
    if (!keys(op, ['kind', 'clients', 'startedAt', 'checkpoints']) || !['setup', 'uninstall'].includes(op.kind) ||
        !iso(op.startedAt) || !Array.isArray(op.clients) || !op.clients.length ||
        op.clients.some((client, index) => !clients.includes(client) || op.clients.indexOf(client) !== index) ||
        !keys(op.checkpoints, op.clients) || op.clients.join(',') !== clients.filter(client => op.clients.includes(client)).join(',')) fail();
    for (const checkpoint of Object.values(op.checkpoints)) {
      if (!keys(checkpoint, ['state', 'destination', 'previous', 'desired']) || !validPath(checkpoint.destination) ||
          !(op.kind === 'setup' ? ['planned', 'registering', 'done', 'manual'] : ['planned', 'detaching', 'detached']).includes(checkpoint.state) ||
          ![checkpoint.previous, checkpoint.desired].every(vector => vector === null || (validVector(vector) && consistent(vector) && databaseSafe(vector.databasePath))) ||
          (op.kind === 'setup' && checkpoint.desired === null)) fail();
    }
  }
  if (value.state === 'pending' && (!value.node || op?.kind !== 'setup')) fail();
  if (value.state === 'installed' && (!value.engine || !value.node || op !== null || !Object.values(value.clients).some(Boolean))) fail();
  if (value.state === 'uninstalling' && op?.kind !== 'uninstall') fail();
  if (value.state === 'uninstalled' && (value.engine !== null || value.node !== null || op !== null || Object.values(value.clients).some(Boolean))) fail();
  return value;
}
