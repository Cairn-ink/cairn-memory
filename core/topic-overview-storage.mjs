import { fail } from './validation.mjs';

export const OVERVIEW_STATE_BYTES = 8 * 1024 * 1024;
const kinds = ['fact', 'preference', 'decision', 'instruction', 'context'];
const counts = () => ({ total: 0, byKind: Object.fromEntries(kinds.map(kind => [kind, 0])) });
const increment = (value, kind) => { value.total++; value.byKind[kind]++; };
const same = (row, ns) => row && row.owner_id === ns.ownerId && row.scope === ns.scope && row.project_id === ns.projectId;
const visible = (row, ns, revision) => same(row, ns) && !row.deleted && row.currentness === 'current' &&
  row.review_state !== 'awaiting' && (revision === undefined || row.revision === revision);
const boundary = ns => [ns.ownerId, ns.scope, ns.projectId];
const where = 'owner_id=? AND scope=? AND project_id=?';
const binary = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));

/** One generator step is a physical row/EOF visit plus <=3 indexed validations,
 * or one in-memory ancestor/count update. No body/receipt column is selected. */
export function createTopicOverviewStorage(db) {
  const prepare = sql => db.prepare(sql);
  const stateRow = prepare(`SELECT active_generation FROM namespace_index_state WHERE ${where}`);
  const epoch = prepare(`SELECT epoch FROM namespace_epochs WHERE ${where}`);
  const identity = prepare('SELECT store_id FROM store_metadata WHERE singleton=1');
  const generation = prepare('SELECT owner_id,scope,project_id,published FROM index_generations WHERE id=?');
  const nextMoc = prepare(`SELECT id,revision,level,substr(title,1,241) title FROM mocs INDEXED BY index_moc_keyset
    WHERE ${where} AND id>? ORDER BY id LIMIT 1`);
  const source = prepare('SELECT memory_id,memory_revision FROM moc_title_sources WHERE moc_id=? AND memory_id>? ORDER BY memory_id LIMIT 1');
  const memory = prepare('SELECT id,owner_id,scope,project_id,revision,deleted,currentness,review_state FROM memories WHERE id=?');
  const edge = prepare('SELECT child_id,parent_revision,child_revision FROM moc_edges WHERE parent_id=? AND child_id>? ORDER BY child_id LIMIT 1');
  const nextMemory = prepare(`SELECT id,revision,kind,created_at,deleted,currentness,review_state FROM memories INDEXED BY index_memory_keyset
    WHERE ${where} AND id>? ORDER BY id LIMIT 1`);
  const ref = prepare(`SELECT moc_id,moc_revision,memory_revision FROM moc_memory_refs INDEXED BY memory_moc_refs
    WHERE memory_id=? AND moc_id>? ORDER BY moc_id LIMIT 1`);
  const projections = {
    moc: prepare('SELECT revision FROM index_mocs WHERE generation=? AND id=?'),
    memory: prepare('SELECT revision FROM index_memories WHERE generation=? AND id=?'),
    source: prepare('SELECT memory_revision FROM index_title_sources WHERE generation=? AND moc_id=? AND memory_id=?'),
    edge: prepare('SELECT parent_revision,child_revision FROM index_edges WHERE generation=? AND parent_id=? AND child_id=?'),
    ref: prepare('SELECT moc_revision,memory_revision FROM index_memory_refs WHERE generation=? AND moc_id=? AND memory_id=?'),
  };
  function snapshot(namespace) {
    const row = stateRow.get(...boundary(namespace));
    if (row && row.active_generation === null) fail('index_unavailable');
    const active = row ? generation.get(row.active_generation) : null;
    if (row && (!same(active, namespace) || active.published !== 1)) fail('index_unavailable');
    const store = identity.get();
    if (!store || typeof store.store_id !== 'string') fail('unsupported_database');
    return { storeId: store.store_id, indexRevision: epoch.get(...boundary(namespace))?.epoch ?? 1,
      generation: row?.active_generation ?? null };
  }
  function create(namespace, bounds, captured) {
    const nodes = new Map(), totals = { unique: counts(), unfiled: counts() };
    let bytes = 2048;
    const account = size => { bytes += size; if (bytes > OVERVIEW_STATE_BYTES) fail('state_limit'); };
    const projected = (type, row, ...keys) => {
      if (captured.generation === null) return true;
      const item = projections[type].get(captured.generation, ...keys);
      if (!item) return false;
      if (type === 'moc' || type === 'memory') return item.revision === row.revision;
      if (type === 'source') return item.memory_revision === row.memory_revision;
      if (type === 'edge') return item.parent_revision === row.parent_revision && item.child_revision === row.child_revision;
      return item.moc_revision === row.moc_revision && item.memory_revision === row.memory_revision;
    };
    function member(node, row) {
      increment(node.descendantCounts, row.kind);
      if (node.latestMemberCreatedAt === null || row.created_at > node.latestMemberCreatedAt) node.latestMemberCreatedAt = row.created_at;
      if (bounds.memberLimit && node.memberRefs.length < bounds.memberLimit) {
        account(96 + row.id.length * 2);
        node.memberRefs.push({ memoryId: row.id, revision: row.revision });
      }
    }
    function* scan() {
      let last = '';
      while (true) {
        const row = nextMoc.get(...boundary(namespace), last);
        if (!row) { yield; break; }
        last = row.id;
        if ([1, 2].includes(row.level) && projected('moc', row, row.id)) {
          account(1024 + 2 * (row.id.length + row.title.length));
          nodes.set(row.id, { id: row.id, revision: row.revision, level: `L${row.level}`,
            title: row.title, titleValid: true, sourceCount: 0, parentIds: [],
            directCounts: counts(), descendantCounts: counts(), latestMemberCreatedAt: null,
            ...(bounds.memberLimit ? { memberRefs: [] } : {}) });
        }
        yield;
      }
      for (const node of nodes.values()) {
        last = '';
        while (true) {
          const binding = source.get(node.id, last);
          if (!binding) { yield; break; }
          last = binding.memory_id; node.sourceCount++;
          const row = memory.get(binding.memory_id);
          if (!visible(row, namespace, binding.memory_revision) ||
              !projected('memory', row, binding.memory_id) ||
              !projected('source', binding, node.id, binding.memory_id)) node.titleValid = false;
          yield;
        }
      }
      for (const parent of nodes.values()) {
        if (parent.level !== 'L2') continue;
        last = '';
        while (true) {
          const row = edge.get(parent.id, last);
          if (!row) { yield; break; }
          last = row.child_id;
          const child = nodes.get(row.child_id);
          if (child?.level === 'L1' && parent.revision === row.parent_revision &&
              child.revision === row.child_revision && projected('edge', row, parent.id, child.id)) {
            account(48 + parent.id.length * 2);
            child.parentIds.push(parent.id);
          }
          yield;
        }
      }
      last = '';
      while (true) {
        const row = nextMemory.get(...boundary(namespace), last);
        if (!row) { yield; break; }
        last = row.id;
        const eligible = !row.deleted && row.currentness === 'current' && row.review_state !== 'awaiting' &&
          projected('memory', row, row.id);
        if (eligible && !kinds.includes(row.kind)) fail('unsupported_database');
        yield;
        if (!eligible) continue;
        increment(totals.unique, row.kind);
        let after = '', filed = false;
        const ancestors = new Set();
        while (true) {
          const placement = ref.get(row.id, after);
          if (!placement) { yield; break; }
          after = placement.moc_id;
          const node = nodes.get(placement.moc_id);
          const valid = node?.level === 'L1' && node.revision === placement.moc_revision &&
            row.revision === placement.memory_revision && projected('ref', placement, node.id, row.id);
          if (valid) { filed = true; increment(node.directCounts, row.kind); member(node, row); }
          yield;
          if (!valid) continue;
          for (const parentId of node.parentIds) {
            if (!ancestors.has(parentId)) {
              account(32); ancestors.add(parentId); member(nodes.get(parentId), row);
            }
            yield;
          }
        }
        bytes -= ancestors.size * 32;
        if (!filed) increment(totals.unfiled, row.kind);
        yield;
      }
    }
    return { scan: scan(), totals,
      finish() {
        return [...nodes.values()].sort((a, b) => (a.level === b.level ? binary(a.id, b.id) : a.level === 'L2' ? -1 : 1))
          .map(node => ({ id: node.id, revision: node.revision, level: node.level,
            title: node.titleValid && node.sourceCount ? node.title : null,
            parentIds: node.parentIds.sort(binary), directCounts: node.directCounts,
            descendantCounts: node.descendantCounts, latestMemberCreatedAt: node.latestMemberCreatedAt,
            lastMemberAddedAt: null, addedAtCoverage: 'not_recorded',
            ...(bounds.memberLimit ? { memberRefs: node.memberRefs } : {}) }));
      } };
  }
  return { snapshot, create };
}
