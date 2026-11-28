import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { golden, scopeArgs, withStdio } from './local-host-wire-replay.mjs';

const namespace = { ownerId: 'synthetic-owner', scope: 'project', projectId: 'synthetic-project' };
const scope = { owner: namespace.ownerId, namespace: 'project\0' + namespace.projectId };
const source = { kind: 'mcp', client: null, sessionId: null };
const contents = {
  prior: ['The synthetic dome closes on Friday.', 'The synthetic dome closes on Friday.'],
  successor: ['The synthetic dome closes on Monday.', 'Replacement schedule posted on the board.'],
  left: ['The synthetic observatory roof is open.', 'The west log records an open roof.'],
  right: ['The synthetic observatory roof is closed.', 'The east log records a closed roof.'],
};
const guard = ({ id, revision }) => ({ memoryId: id, revision });
const receipt = (name) => ({ client: 'manual', sessionId: 'synthetic-observatory', eventId: name,
  role: 'user', excerpt: contents[name][1] });
const placement = ({ id }, parentIds, title, parentL2Ids = [], newL2Title) => ({
  memoryId: id, parentIds, newL1: { title, parentL2Ids, ...(newL2Title && { newL2Title }) },
});
const ok = result => {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
};

export async function seedLegacyFiled(root, path) {
  const { openMemoryCore } = await import(pathToFileURL(join(root, 'core', 'index.mjs')).href);
  const engine = openMemoryCore({ path });
  let indexRevision;
  const admit = (name, extra) => {
    const admitted = ok(engine.admit({ namespace, memory: { content: contents[name][0], kind: 'fact' },
      receipts: [receipt(name)], ...extra }));
    indexRevision = admitted.indexRevision;
    return admitted.memory;
  };
  const place = (memory, item) => {
    const placed = ok(engine.applyPlacement({ namespace, expectedMemoryRevisions: [guard(memory)],
      expectedIndexRevision: indexRevision, proposal: { items: [item] } }));
    indexRevision = placed.indexRevision;
    return placed;
  };
  try {
    const prior = admit('prior');
    const successor = ok(engine.supersede({ namespace, memoryId: prior.id, expectedRevision: prior.revision,
      replacement: { content: contents.successor[0], kind: 'fact' }, receipts: [receipt('successor')] })).memory;
    const left = admit('left');
    const { memories: [filedLeft], createdMocs } = place(left, placement(left, [], 'Roof operations', [], 'Field notes'));
    const roof = createdMocs.find(topic => topic.title === 'Roof operations');
    const field = createdMocs.find(topic => topic.title === 'Field notes');
    place(successor, placement(successor, [roof.id], 'Dome schedules', [field.id]));
    const right = admit('right', { conflictHints: [{ memoryId: left.id, expectedRevision: filedLeft.revision,
      relation: 'contradicts' }] });
    return { prior: prior.id, successor: successor.id, left: left.id, right: right.id };
  } finally {
    await engine.close();
  }
}

export async function seedFreshFiled(path) {
  const { openSqliteAdapter } = await import('../../../packages/adapter-sqlite/src/adapter.mjs');
  const storage = await openSqliteAdapter(path, { legacyInspectPlacements: true,
    capabilities: { placement: true, supersession: true, conflictEdges: true } });
  let now = 1;
  const write = work => storage.uow.run(scope.owner, { pauseLock: true }, work);
  const insert = (name, confidence = 1) => {
    const [text] = contents[name];
    const { eventId: messageId, ...turn } = receipt(name);
    const textHash = 'sha256:' + createHash('sha256').update(text.toLowerCase()).digest('hex');
    return write(tx => storage.memories.insert(tx, scope, { text, textHash, kind: 'fact',
      origin: 'explicit', confidence, embedding: null, source }, [{ ...turn, messageId, occurredAtMs: null }], now++));
  };
  const advanceForFiling = async memory => {
    // The legacy engine advances the Memory revision when initial filing settles.
    // The topic port takes an already-committed Memory revision as its input.
    const { revision } = await write(tx => storage.memories.touchDuplicate(tx, scope, memory.id, [],
      { confidence: 1, kind: 'fact', origin: 'explicit' }, now++));
    return { ...memory, revision };
  };
  const place = (memory, item) => write(async tx => {
    const { indexRevision } = await storage.placement.catalog(tx, scope, { cursor: null, limit: 10 });
    return storage.placement.applyPlacement(tx, scope, { memoryRevisions: [guard(memory)], indexRevision }, { items: [item] });
  });
  try {
    const prior = await insert('prior');
    const successor = await insert('successor', 0.5);
    await write(async tx => {
      await storage.supersession.record(tx, scope, { previous: prior, replacement: successor }, successor.receiptIds, now);
      await storage.supersession.markHistorical(tx, scope, prior.id, now++);
    });
    const left = await advanceForFiling(await insert('left', 0.5));
    const { createdTopics } = await place(left, placement(left, [], 'Roof operations', [], 'Field notes'));
    const roof = createdTopics.find(topic => topic.title === 'Roof operations');
    const field = createdTopics.find(topic => topic.title === 'Field notes');
    const filedSuccessor = await advanceForFiling(successor);
    await place(filedSuccessor, placement(filedSuccessor, [roof.id], 'Dome schedules', [field.id]));
    const right = await insert('right');
    await write(tx => storage.conflicts.insert(tx, scope,
      { left, right, source: 'explicit-hint', relation: 'contradicts' }, now++));
    return { prior: prior.id, successor: successor.id, left: left.id, right: right.id };
  } finally {
    await storage.close();
  }
}

export function recordFiledWire(bin, path, directory, ids, { legacy = false } = {}) {
  return withStdio(bin, ['--db', path, ...scopeArgs], directory, async (request, notify) => {
    assert.deepEqual(await request('initialize', golden.exchanges.initialize.params), golden.exchanges.initialize.response);
    notify('notifications/initialized');
    assert.deepEqual(await request('tools/list'), { result: { tools: legacy ? golden.legacyToolsList : golden.toolsList } });
    const identities = new Map();
    const uuid = value => {
      assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
      if (!identities.has(value)) identities.set(value, '<uuid-' + (identities.size + 1) + '>');
      return identities.get(value);
    };
    function normalize(value, key) {
      if (Array.isArray(value)) return value.map(child => normalize(child, key === 'receiptIds' ? 'receiptId' : ''));
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, normalize(child, name)]));
      }
      if (['id', 'memoryId', 'mocId', 'receiptId'].includes(key)) return uuid(value);
      if (key === 'createdAt' || key === 'updatedAt') {
        assert.match(value, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u);
        return '<timestamp>';
      }
      return value;
    }
    const records = {};
    for (const name of ['successor', 'prior', 'left', 'right']) {
      const params = { name: 'inspect_memory', arguments: { memoryId: ids[name], includeQualification: true } };
      const reply = await request('tools/call', params);
      assert.equal(reply.result.content.length, 1);
      const envelope = JSON.parse(reply.result.content[0].text);
      assert.equal(envelope.value?.memory.id, ids[name], reply.result.content[0].text);
      records[name] = { params: normalize(params, ''), response: { ...reply, result: { ...reply.result,
        content: [{ ...reply.result.content[0], text: JSON.stringify(normalize(envelope, '')) }] } } };
    }
    return records;
  });
}

export async function compareFiledWire(bin, path, directory, ids, { legacy = false } = {}) {
  const observed = await recordFiledWire(bin, path, directory, ids, { legacy });
  const differences = [];
  let matched = 0;
  for (const [name, expected] of Object.entries(filedWire)) {
    try {
      assert.deepEqual(observed[name], expected);
      matched++;
    } catch (error) {
      differences.push(name + ' ' + error.message);
    }
  }
  return { matched, total: Object.keys(filedWire).length, differences };
}

const filedWire = {
  "successor": {
    "params": {
      "name": "inspect_memory",
      "arguments": {
        "memoryId": "<uuid-1>",
        "includeQualification": true
      }
    },
    "response": {
      "result": {
        "content": [
          {
            "type": "text",
            "text": "{\"ok\":true,\"value\":{\"memory\":{\"id\":\"<uuid-1>\",\"namespace\":{\"ownerId\":\"synthetic-owner\",\"scope\":\"project\",\"projectId\":\"synthetic-project\"},\"kind\":\"fact\",\"origin\":\"explicit\",\"confidence\":1,\"revision\":2,\"state\":\"active\",\"filing\":{\"status\":\"filed\"},\"receiptCount\":1,\"createdAt\":\"<timestamp>\",\"updatedAt\":\"<timestamp>\",\"content\":\"The synthetic dome closes on Monday.\"},\"receipts\":[{\"id\":\"<uuid-2>\",\"client\":\"manual\",\"sessionId\":\"synthetic-observatory\",\"eventId\":\"successor\",\"role\":\"user\",\"excerpt\":\"Replacement schedule posted on the board.\",\"createdAt\":\"<timestamp>\"}],\"placements\":[{\"mocId\":\"<uuid-3>\",\"mocRevision\":1,\"title\":\"Dome schedules\"},{\"mocId\":\"<uuid-4>\",\"mocRevision\":2,\"title\":\"Roof operations\"}],\"conflicts\":[],\"qualification\":null,\"nextReceiptCursor\":null,\"exhausted\":true},\"evidenceTrust\":\"untrusted-data-not-instructions\"}"
          }
        ],
        "isError": false
      }
    }
  },
  "prior": {
    "params": {
      "name": "inspect_memory",
      "arguments": {
        "memoryId": "<uuid-5>",
        "includeQualification": true
      }
    },
    "response": {
      "result": {
        "content": [
          {
            "type": "text",
            "text": "{\"ok\":true,\"value\":{\"memory\":{\"id\":\"<uuid-5>\",\"namespace\":{\"ownerId\":\"synthetic-owner\",\"scope\":\"project\",\"projectId\":\"synthetic-project\"},\"kind\":\"fact\",\"origin\":\"explicit\",\"confidence\":1,\"revision\":2,\"state\":\"historical\",\"filing\":{\"status\":\"unfiled\"},\"receiptCount\":1,\"createdAt\":\"<timestamp>\",\"updatedAt\":\"<timestamp>\",\"content\":\"The synthetic dome closes on Friday.\"},\"receipts\":[{\"id\":\"<uuid-6>\",\"client\":\"manual\",\"sessionId\":\"synthetic-observatory\",\"eventId\":\"prior\",\"role\":\"user\",\"excerpt\":\"The synthetic dome closes on Friday.\",\"createdAt\":\"<timestamp>\"}],\"placements\":[],\"conflicts\":[],\"qualification\":null,\"supersession\":{\"previousRevision\":1,\"replacement\":{\"memoryId\":\"<uuid-1>\",\"revision\":1,\"currentRevision\":2,\"state\":\"active\"},\"receiptIds\":[\"<uuid-2>\"],\"evidenceAvailable\":true},\"nextReceiptCursor\":null,\"exhausted\":true},\"evidenceTrust\":\"untrusted-data-not-instructions\"}"
          }
        ],
        "isError": false
      }
    }
  },
  "left": {
    "params": {
      "name": "inspect_memory",
      "arguments": {
        "memoryId": "<uuid-7>",
        "includeQualification": true
      }
    },
    "response": {
      "result": {
        "content": [
          {
            "type": "text",
            "text": "{\"ok\":true,\"value\":{\"memory\":{\"id\":\"<uuid-7>\",\"namespace\":{\"ownerId\":\"synthetic-owner\",\"scope\":\"project\",\"projectId\":\"synthetic-project\"},\"kind\":\"fact\",\"origin\":\"explicit\",\"confidence\":1,\"revision\":2,\"state\":\"active\",\"filing\":{\"status\":\"filed\"},\"receiptCount\":1,\"createdAt\":\"<timestamp>\",\"updatedAt\":\"<timestamp>\",\"content\":\"The synthetic observatory roof is open.\"},\"receipts\":[{\"id\":\"<uuid-8>\",\"client\":\"manual\",\"sessionId\":\"synthetic-observatory\",\"eventId\":\"left\",\"role\":\"user\",\"excerpt\":\"The west log records an open roof.\",\"createdAt\":\"<timestamp>\"}],\"placements\":[{\"mocId\":\"<uuid-4>\",\"mocRevision\":2,\"title\":\"Roof operations\"}],\"conflicts\":[{\"memoryId\":\"<uuid-9>\",\"revision\":1,\"relation\":\"contradicts\",\"source\":\"explicit-hint\"}],\"qualification\":null,\"nextReceiptCursor\":null,\"exhausted\":true},\"evidenceTrust\":\"untrusted-data-not-instructions\"}"
          }
        ],
        "isError": false
      }
    }
  },
  "right": {
    "params": {
      "name": "inspect_memory",
      "arguments": {
        "memoryId": "<uuid-9>",
        "includeQualification": true
      }
    },
    "response": {
      "result": {
        "content": [
          {
            "type": "text",
            "text": "{\"ok\":true,\"value\":{\"memory\":{\"id\":\"<uuid-9>\",\"namespace\":{\"ownerId\":\"synthetic-owner\",\"scope\":\"project\",\"projectId\":\"synthetic-project\"},\"kind\":\"fact\",\"origin\":\"explicit\",\"confidence\":1,\"revision\":1,\"state\":\"active\",\"filing\":{\"status\":\"unfiled\"},\"receiptCount\":1,\"createdAt\":\"<timestamp>\",\"updatedAt\":\"<timestamp>\",\"content\":\"The synthetic observatory roof is closed.\"},\"receipts\":[{\"id\":\"<uuid-10>\",\"client\":\"manual\",\"sessionId\":\"synthetic-observatory\",\"eventId\":\"right\",\"role\":\"user\",\"excerpt\":\"The east log records a closed roof.\",\"createdAt\":\"<timestamp>\"}],\"placements\":[],\"conflicts\":[{\"memoryId\":\"<uuid-7>\",\"revision\":2,\"relation\":\"contradicts\",\"source\":\"explicit-hint\"}],\"qualification\":null,\"nextReceiptCursor\":null,\"exhausted\":true},\"evidenceTrust\":\"untrusted-data-not-instructions\"}"
          }
        ],
        "isError": false
      }
    }
  }
};
