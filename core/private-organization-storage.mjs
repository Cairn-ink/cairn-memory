import { cardDependencyFence } from './card-current-storage.mjs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { keyed } from './private-card-input.mjs';
import { organizationInput } from './private-organization-input.mjs';
import { fail, MemoryStoreError } from './validation.mjs';

const where = 'owner_id=? AND scope=? AND project_id=?';
const boundary = ns => [ns.ownerId, ns.scope, ns.projectId ?? ''];
const size = value => Buffer.byteLength(JSON.stringify({ ok: true, value }), 'utf8');
const key = title => title.normalize('NFKC').toLocaleLowerCase('und');
const sourceEligible = card => card?.state === 'confirmed' && card.support.status === 'eligible' && (!card.support.currentDependency || card.support.currentDependency.status === 'current');
const sameRef = (card, ref) => card?.revision === ref.revision && card.bodyRevision === ref.bodyRevision;

/** Canonical organization shares the existing authorized transaction and store. */
export function createPrivateOrganizationStorage({ db, identity, cardDetailInside, memoryMapInside, memoryTopicInside }) {
  const bind = value => keyed(identity.cursorSecret, 'evidence-organization-cursor-v1', [identity.storeId, value]);
  const memoryIndex = ns => db.prepare(`SELECT epoch FROM namespace_epochs WHERE ${where}`).get(...boundary(ns))?.epoch ?? 1;
  const cardIndex = ns => db.prepare(`SELECT revision FROM card_moc_epochs WHERE ${where}`).get(...boundary(ns))?.revision ?? 1;
  const routing = ns => db.prepare(`SELECT generation FROM card_epochs WHERE ${where}`).get(...boundary(ns))?.generation ?? 1;
  const generations = ns => [memoryIndex(ns), cardIndex(ns), routing(ns), ...(Object.keys(cardDependencyFence(db, ns)).length ? [cardDependencyFence(db, ns)] : [])];
  const advanceIndex = ns => db.prepare(`INSERT INTO card_moc_epochs VALUES(?,?,?,2)
    ON CONFLICT(owner_id,scope,project_id) DO UPDATE SET revision=revision+1`).run(...boundary(ns));
  const topic = (ns, id) => db.prepare(`SELECT * FROM card_mocs WHERE ${where} AND id=?`).get(...boundary(ns), id);
  const cardRef = (ns, card) => ({ type: 'card', namespace: ns, cardId: card.id, revision: card.revision, bodyRevision: card.bodyRevision });
  function encode(value) {
    const body = Buffer.from(JSON.stringify(value)).toString('base64url');
    const result = `${body}.${bind(body)}`;
    if (result.length > 8192) fail('context_item_too_large');
    return result;
  }
  function decode(token, binding, ns, accessGeneration) {
    if (token === undefined) return 0;
    const [body, signature, extra] = token.split('.');
    const expected = Buffer.from(bind(body)), supplied = Buffer.from(signature ?? '');
    if (extra !== undefined || supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) fail('invalid_cursor');
    let value;
    try { value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { fail('invalid_cursor'); }
    if (value.binding !== binding || !Number.isSafeInteger(value.offset) || value.offset < 0) fail('invalid_cursor');
    if (value.accessGeneration !== accessGeneration || JSON.stringify(value.generations) !== JSON.stringify(generations(ns))) fail('cursor_stale');
    return value.offset;
  }
  function currentCard(ns, ref) {
    const card = cardDetailInside(ns, ref.cardId);
    if (!sourceEligible(card)) fail('evidence_unavailable');
    if (!sameRef(card, ref)) fail('revision_conflict');
    return card;
  }
  function titleInside(ns, row) {
    const sources = db.prepare('SELECT * FROM card_moc_title_sources WHERE moc_id=? ORDER BY card_id LIMIT 6').all(row.id);
    const valid = sources.length > 0 && sources.length <= 5 && sources.every(source => {
      const card = cardDetailInside(ns, source.card_id);
      return sourceEligible(card) && sameRef(card, { revision: source.card_revision, bodyRevision: source.body_revision });
    });
    return { title: valid ? row.title : null, titleSources: sources.slice(0, 5).map(source => ({ type: 'card', namespace: ns,
      cardId: source.card_id, revision: source.card_revision, bodyRevision: source.body_revision })) };
  }
  function cardTopicInside(ns, ref, allowUnavailable = false) {
    const row = topic(ns, ref.mocId);
    if (!row) fail('moc_not_found');
    if (row.revision !== ref.revision) fail('revision_conflict');
    const label = titleInside(ns, row);
    if (!allowUnavailable && label.title === null) fail('evidence_unavailable');
    return { id: row.id, level: `L${row.level}`, revision: row.revision, ...label };
  }
  function checkedTopic(ns, id, level) {
    const row = topic(ns, id);
    if (!row) fail('moc_not_found');
    if (row.level !== level) fail('invalid_ref');
    if (titleInside(ns, row).title === null) fail('evidence_unavailable');
    return row;
  }
  function bump(ids) {
    for (const id of ids) db.prepare('UPDATE card_mocs SET revision=revision+1,updated_at=? WHERE id=?').run(new Date().toISOString(), id);
    for (const id of ids) {
      db.prepare('UPDATE card_moc_refs SET moc_revision=(SELECT revision FROM card_mocs WHERE id=?) WHERE moc_id=?').run(id, id);
      db.prepare(`UPDATE card_moc_edges SET parent_revision=(SELECT revision FROM card_mocs WHERE id=parent_id),
        child_revision=(SELECT revision FROM card_mocs WHERE id=child_id) WHERE parent_id=? OR child_id=?`).run(id, id);
    }
  }
  function placement(ns, input, actionId) {
    if (input.expectedIndexRevision !== cardIndex(ns)) fail('index_revision_conflict');
    const cards = new Map(input.refs.map(ref => [ref.cardId, currentCard(ns, ref)]));
    const l1s = new Map(), l2s = new Map();
    for (const item of input.items) {
      for (const id of item.parentIds) checkedTopic(ns, id, 1);
      if (!item.newL1) continue;
      for (const id of item.newL1.parentL2Ids) checkedTopic(ns, id, 2);
      const canonical = key(item.newL1.title);
      if (db.prepare(`SELECT 1 FROM card_mocs WHERE ${where} AND level=1 AND canonical_title=?`).get(...boundary(ns), canonical)) fail('moc_title_conflict');
      if (!l1s.has(canonical)) l1s.set(canonical, { id: randomUUID(), level: 1, title: item.newL1.title, sources: new Set(), parents: new Set(), newParents: new Set() });
      const group = l1s.get(canonical); group.sources.add(item.cardId);
      item.newL1.parentL2Ids.forEach(id => group.parents.add(id));
      if (item.newL1.newL2Title !== undefined) {
        const parentKey = key(item.newL1.newL2Title);
        if (db.prepare(`SELECT 1 FROM card_mocs WHERE ${where} AND level=2 AND canonical_title=?`).get(...boundary(ns), parentKey)) fail('moc_title_conflict');
        if (!l2s.has(parentKey)) l2s.set(parentKey, { id: randomUUID(), level: 2, title: item.newL1.newL2Title, sources: new Set() });
        l2s.get(parentKey).sources.add(item.cardId); group.newParents.add(parentKey);
      }
    }
    for (const group of l1s.values()) if (group.parents.size + group.newParents.size > 3) fail('invalid_input');
    const affected = new Set(), desired = new Map();
    let changed = l1s.size > 0 || l2s.size > 0;
    for (const item of input.items) {
      const parents = new Set(item.parentIds);
      if (item.newL1) parents.add(l1s.get(key(item.newL1.title)).id);
      desired.set(item.cardId, parents);
      const old = db.prepare('SELECT * FROM card_moc_refs WHERE card_id=? ORDER BY moc_id').all(item.cardId);
      if (old.length !== parents.size || old.some(ref => !parents.has(ref.moc_id) ||
          ref.card_revision !== cards.get(item.cardId).revision || ref.body_revision !== cards.get(item.cardId).bodyRevision)) changed = true;
      old.forEach(ref => affected.add(ref.moc_id)); parents.forEach(id => affected.add(id));
    }
    const created = [...l2s.values(), ...l1s.values()];
    if (changed) {
      const timestamp = new Date().toISOString();
      for (const group of created) {
        db.prepare('INSERT INTO card_mocs VALUES(?,?,?,?,?,?,?,1,?,?)').run(group.id, ...boundary(ns), group.level, group.title, key(group.title), timestamp, timestamp);
        for (const id of group.sources) {
          const card = cards.get(id);
          db.prepare('INSERT INTO card_moc_title_sources VALUES(?,?,?,?)').run(group.id, id, card.revision, card.bodyRevision);
        }
        affected.delete(group.id);
      }
      for (const group of l1s.values()) group.parents.forEach(id => affected.add(id));
      bump(affected);
      for (const [id, parents] of desired) {
        db.prepare('DELETE FROM card_moc_refs WHERE card_id=?').run(id);
        const card = cards.get(id);
        for (const parentId of parents) db.prepare(`INSERT INTO card_moc_refs SELECT id,revision,?,?,? FROM card_mocs WHERE id=?`)
          .run(id, card.revision, card.bodyRevision, parentId);
      }
      for (const group of l1s.values()) for (const parentId of [...group.parents, ...[...group.newParents].map(parent => l2s.get(parent).id)]) {
        db.prepare(`INSERT INTO card_moc_edges SELECT p.id,p.revision,c.id,c.revision FROM card_mocs p,card_mocs c WHERE p.id=? AND c.id=?`).run(parentId, group.id);
      }
      advanceIndex(ns);
    }
    return { id: actionId, revision: cardIndex(ns), state: 'completed', bodyRevision: null, effectCount: 0,
      cardRefs: input.refs, createdMocRefs: created.map(group => ({ mocId: group.id, revision: 1, level: `L${group.level}` })), indexRevision: cardIndex(ns) };
  }
  function refreshTopic(ns, input) {
    if (input.expectedIndexRevision !== cardIndex(ns)) fail('index_revision_conflict');
    // The old title may be stale: only exact topic identity/version is required.
    const row = topic(ns, input.topicRef.mocId);
    if (!row) fail('moc_not_found');
    if (row.revision !== input.topicRef.revision) fail('revision_conflict');
    input.refs.forEach(ref => currentCard(ns, ref));
    const canonical = key(input.title);
    if (db.prepare(`SELECT 1 FROM card_mocs WHERE ${where} AND level=? AND canonical_title=? AND id!=?`)
      .get(...boundary(ns), row.level, canonical, row.id)) fail('moc_title_conflict');
    db.prepare('UPDATE card_mocs SET title=?,canonical_title=? WHERE id=?').run(input.title, canonical, row.id);
    db.prepare('DELETE FROM card_moc_title_sources WHERE moc_id=?').run(row.id);
    for (const ref of input.refs) db.prepare('INSERT INTO card_moc_title_sources VALUES(?,?,?,?)')
      .run(row.id, ref.cardId, ref.revision, ref.bodyRevision);
    // Advance hierarchy endpoint versions, never stale Card membership refs.
    bump(new Set([row.id]));
    advanceIndex(ns);
    return { id: row.id, revision: row.revision + 1, state: 'completed', bodyRevision: null, effectCount: 0,
      topicRef: { mocId: row.id, revision: row.revision + 1 }, level: `L${row.level}`,
      cardRefs: input.refs, indexRevision: cardIndex(ns) };
  }
  function endpointPair(ns, input, unavailable = false) {
    if (memoryIndex(ns) !== input.expectedMemoryIndexRevision || cardIndex(ns) !== input.expectedCardIndexRevision) fail('index_revision_conflict');
    const memory = memoryTopicInside(ns, input.memoryTopic), card = cardTopicInside(ns, input.cardTopic, unavailable);
    if (memory.level !== card.level) fail('invalid_ref');
    if (!unavailable && memory.title === null) fail('evidence_unavailable');
    return { memory, card };
  }
  const mappingRow = (ns, id) => db.prepare(`SELECT * FROM evidence_mappings WHERE ${where} AND id=?`).get(...boundary(ns), id);
  function mappingReceipt(row) { return { id: row.id, revision: row.revision, state: row.state, bodyRevision: null, effectCount: 0 }; }
  function mapping(ns, method, input) {
    const endpoints = endpointPair(ns, input, input.state === 'removed');
    if (method === 'proposeEvidenceMapping') {
      const id = randomUUID();
      db.prepare(`INSERT INTO evidence_mappings VALUES(?,?,?,?,1,'proposed',?,?,?,?,?,?,?)`).run(id, ...boundary(ns),
        Number(endpoints.memory.level.slice(1)), endpoints.memory.id, endpoints.memory.revision,
        endpoints.card.id, endpoints.card.revision, input.expectedMemoryIndexRevision, input.expectedCardIndexRevision);
      return mappingReceipt(mappingRow(ns, id));
    }
    const row = mappingRow(ns, input.mappingId);
    if (!row) fail('mapping_not_found');
    if (row.revision !== input.expectedRevision) fail('revision_conflict');
    if (row.state === 'removed') fail('mapping_state_conflict');
    if (row.memory_moc_id !== endpoints.memory.id || row.card_moc_id !== endpoints.card.id || row.level !== Number(endpoints.memory.level.slice(1))) fail('invalid_ref');
    if (input.state === 'active') {
      for (const [column, id] of [['memory_moc_id', row.memory_moc_id], ['card_moc_id', row.card_moc_id]]) {
        const count = db.prepare(`SELECT count(*) n FROM (SELECT 1 FROM evidence_mappings WHERE ${where}
          AND ${column}=? AND state='active' AND id!=? LIMIT 16)`).get(...boundary(ns), id, row.id).n;
        if (count >= 16) fail('mapping_limit_reached');
      }
    }
    db.prepare(`UPDATE evidence_mappings SET revision=revision+1,state=?,memory_moc_revision=?,card_moc_revision=?,
      memory_index_revision=?,card_index_revision=? WHERE id=?`).run(input.state, endpoints.memory.revision, endpoints.card.revision,
      input.expectedMemoryIndexRevision, input.expectedCardIndexRevision, row.id);
    return mappingReceipt(mappingRow(ns, row.id));
  }
  function mappingDto(ns, row) {
    let navigable = row.state === 'active', reason = navigable ? null : row.state;
    try {
      if (memoryIndex(ns) !== row.memory_index_revision || cardIndex(ns) !== row.card_index_revision) fail('index_revision_conflict');
      endpointPair(ns, { memoryTopic: { mocId: row.memory_moc_id, revision: row.memory_moc_revision },
        cardTopic: { mocId: row.card_moc_id, revision: row.card_moc_revision },
        expectedMemoryIndexRevision: row.memory_index_revision, expectedCardIndexRevision: row.card_index_revision });
    } catch (cause) {
      if (!(cause instanceof MemoryStoreError) || !['index_revision_conflict', 'index_unavailable', 'moc_not_found',
        'revision_conflict', 'evidence_unavailable'].includes(cause.code)) throw cause;
      navigable = false; reason = 'stale';
    }
    return { id: row.id, namespace: ns, revision: row.revision, state: row.state, level: `L${row.level}`,
      memoryTopic: { mocId: row.memory_moc_id, revision: row.memory_moc_revision },
      cardTopic: { mocId: row.card_moc_id, revision: row.card_moc_revision },
      memoryIndexRevision: row.memory_index_revision, cardIndexRevision: row.card_index_revision,
      navigable, reason, meaning: 'navigation-only' };
  }
  function cardMapRows(ns, input, offset) {
    if (input.parentRef) cardTopicInside(ns, input.parentRef, true);
    const parent = input.parentRef && topic(ns, input.parentRef.mocId);
    const marks = boundary(ns);
    // Physical rows are paged before canonical validation, so stale records also
    // consume work. Every candidate kind has a stable key and no copied body.
    const rows = db.prepare(`SELECT * FROM (
      SELECT 'topic' kind,id a,'' b FROM card_mocs WHERE ${where}
      UNION ALL SELECT 'edge',e.parent_id,e.child_id FROM card_moc_edges e JOIN card_mocs t ON t.id=e.parent_id WHERE t.owner_id=? AND t.scope=? AND t.project_id=?
      UNION ALL SELECT 'member',r.moc_id,r.card_id FROM card_moc_refs r JOIN card_mocs t ON t.id=r.moc_id WHERE t.owner_id=? AND t.scope=? AND t.project_id=?
      UNION ALL SELECT 'unfiled',id,'' FROM private_cards WHERE ${where} AND state='confirmed'
    ) ORDER BY CASE kind WHEN 'topic' THEN 0 WHEN 'edge' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,a,b
      LIMIT 257 OFFSET ?`).all(...marks, ...marks, ...marks, ...marks, offset);
    const result = [];
    let scanned = 0;
    for (const row of rows.slice(0, 256)) {
      if (result.filter(value => value.item).length >= input.limit + 1) break;
      scanned++;
      if (row.kind === 'topic') {
        const current = topic(ns, row.a);
        if (parent && (parent.level !== 2 || !db.prepare('SELECT 1 FROM card_moc_edges WHERE parent_id=? AND child_id=? AND child_revision=? AND parent_revision=?').get(parent.id, current.id, current.revision, parent.revision))) continue;
        result.push({ item: { type: 'topic', topic: { type: 'card', id: current.id, level: `L${current.level}`,
          revision: current.revision, ...titleInside(ns, current) } }, consumed: scanned });
      } else if (row.kind === 'edge') {
        if (parent && (parent.level !== 2 || parent.id !== row.a)) continue;
        const edge = db.prepare('SELECT * FROM card_moc_edges WHERE parent_id=? AND child_id=?').get(row.a, row.b);
        const p = topic(ns, row.a), child = topic(ns, row.b);
        if (!p || !child || p.level !== 2 || child.level !== 1 || p.revision !== edge.parent_revision || child.revision !== edge.child_revision) continue;
        result.push({ item: { type: 'ref', ref: { parentId: p.id, parentRevision: p.revision,
          childType: 'topic', childId: child.id, childRevision: child.revision, relation: 'contains' } }, consumed: scanned });
      } else {
        const card = cardDetailInside(ns, row.kind === 'member' ? row.b : row.a);
        if (!sourceEligible(card)) continue;
        if (row.kind === 'unfiled') {
          if (parent || db.prepare('SELECT 1 FROM card_moc_refs WHERE card_id=? AND card_revision=? AND body_revision=? LIMIT 1').get(card.id, card.revision, card.bodyRevision)) continue;
          result.push({ item: { type: 'unfiled', ref: cardRef(ns, card) }, consumed: scanned });
        } else {
          const ref = db.prepare('SELECT * FROM card_moc_refs WHERE moc_id=? AND card_id=?').get(row.a, row.b), p = topic(ns, row.a);
          if (parent && (parent.level !== 1 || parent.id !== row.a)) continue;
          if (!p || p.level !== 1 || p.revision !== ref.moc_revision || !sameRef(card, { revision: ref.card_revision, bodyRevision: ref.body_revision })) continue;
          result.push({ item: { type: 'ref', ref: { parentId: p.id, parentRevision: p.revision,
            childType: 'card', childId: card.id, childRevision: card.revision, bodyRevision: card.bodyRevision, relation: 'contains' } }, consumed: scanned });
        }
      }
    }
    return { rows: result, scanned, hasMore: scanned < rows.length, epoch: cardIndex(ns) };
  }
  function paged(method, ns, original, input, accessGeneration) {
    const binding = bind([ns, method, input]), offset = decode(original.cursor, binding, ns, accessGeneration);
    let rows, epoch, scanned, more;
    if (method === 'mapEvidence' && input.type === 'memory') {
      const page = memoryMapInside(ns, { purpose: input.purpose, parentRef: input.parentRef, limit: input.limit, offset });
      epoch = page.epoch; rows = page.rows; scanned = rows.length; more = rows.length > input.limit;
      rows = rows.map(row => !row.item ? row : { item: row.item.type === 'moc' ?
        { type: 'topic', topic: { type: 'memory', ...row.item.moc } } : row.item.type === 'unfiled' ?
          { type: 'unfiled', ref: { type: 'memory', namespace: ns, ...row.item.ref }, label: row.item.label } :
          { type: 'ref', ref: { ...row.item.ref, childType: row.item.ref.childType === 'moc' ? 'topic' : row.item.ref.childType }, label: row.item.label } });
    } else if (method === 'mapEvidence') {
      const page = cardMapRows(ns, input, offset); ({ rows, epoch, scanned } = page); more = page.hasMore;
    } else {
      const column = input.type === 'memory' ? 'memory_moc_id' : 'card_moc_id';
      rows = db.prepare(`SELECT * FROM evidence_mappings WHERE ${where} AND ${column}=? ORDER BY id LIMIT ? OFFSET ?`)
        .all(...boundary(ns), input.mocId, input.limit + 1, offset).map(row => ({ item: mappingDto(ns, row) }));
      scanned = rows.length; more = rows.length > input.limit;
    }
    let take = Math.min(input.limit, rows.length);
    while (true) {
      const selected = rows.slice(0, take), partial = more || rows.length > take;
      const consumed = selected.at(-1)?.consumed ?? (rows.length > take ? take : scanned);
      const nextOffset = offset + (rows.length > take ? consumed : scanned);
      const value = { ...(method === 'mapEvidence' ? { type: input.type, indexRevision: epoch } : {}),
        items: selected.filter(row => row.item).map(row => row.item), invalidRefs: selected.filter(row => row.invalidRef).map(row => row.invalidRef),
        coverage: { status: partial ? 'budget_exhausted' : 'complete', scanned: rows.length > take ? consumed : scanned,
          included: selected.filter(row => row.item).length, partial },
        nextCursor: partial ? encode({ binding, offset: nextOffset, generations: generations(ns), accessGeneration }) : null };
      if (size(value) <= 65536) return value;
      if (!take || take === 1) fail('context_item_too_large');
      take--;
    }
  }
  return Object.freeze({ call(method, ns, original, accessGeneration) {
    const input = organizationInput(method, original, ns);
    if (method === 'applyCardPlacement') return placement(ns, input, original.actionId);
    if (method === 'refreshCardTopic') return refreshTopic(ns, input);
    if (method === 'proposeEvidenceMapping' || method === 'reviewEvidenceMapping') return mapping(ns, method, input);
    return paged(method, ns, original, input, accessGeneration);
  } });
}
