import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { SAFETY_SCHEMA_VERSIONS, resolveContentLayout } from '../content-safety-layout.mjs';
import { openMemoryCore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { costFamilyFixture } from '../testing/content-safety-cost-families.mjs';
import { batch, draft, ns, ok, register } from '../testing/episode-helpers.mjs';

const layouts = [34, 38, 48, 51, 52, 53];
const range = { since: '2026-01-01T00:00:00.000Z', until: '2026-12-31T00:00:00.000Z' };

function publish(runtime, db, name, at) {
  const input = {
    ...batch(name, `Synthetic source for ${name}`, name), client: 'codex',
    eventStart: at, eventEnd: at, eventTimeCoverage: 'complete'
  };
  for (const index of [2, 3]) {
    const message = { id: `message-${name}-${index}`, role: 'assistant', content: `Synthetic evidence ${name} ${index}` };
    input.messages.push({ ...message, occurredAt: at });
    input.view.messages.push(message);
  }
  const registered = register({ runtime }, input);
  const { commit, writer } = draft({ runtime }, registered, input, {
    sources: input.messages.map(({ id }) => ({ eventId: input.eventId, messageId: id }))
  });
  commit.result.nextStep.anchors = input.messages.map(({ content }, sourceIndex) => ({
    sourceIndex, start: 0, end: content.length
  }));
  runtime.commitEpisodeDraft(ns, commit);
  runtime.releaseEpisodeWriter(ns, { episodeId: registered.episodeId, token: writer.token });
  db.prepare('UPDATE session_episodes SET first_received_at=? WHERE id=?').run(at, registered.episodeId);
  return { ...registered, message: input.messages[0], client: input.client };
}

function addRawIdentity(db, { sessionKey, client, message }, at) {
  const conversation = 'synthetic-raw-conversation';
  db.prepare(`INSERT INTO raw_conversations(id,owner_id,scope,project_id,client,session_key,revision,first_received_at,last_received_at)
    VALUES(?,?,?,?,?,?,1,?,?)`).run(conversation, ns.ownerId, ns.scope, ns.projectId, client, sessionKey, at, at);
  db.prepare(`INSERT INTO raw_messages(conversation_id,message_id,ordinal,role,total_units,total_bytes,assembly_state,first_event_id)
    VALUES(?,?,1,?,?,?,'complete','synthetic-raw-event')`)
    .run(conversation, message.id, message.role, message.content.length, Buffer.byteLength(message.content));
}

function proofSourcesPrefix(sql) {
  const opening = /\bproof_sources\s+AS\s+MATERIALIZED\s*\(/i.exec(sql);
  assert.ok(opening, 'proof_sources CTE exists');
  const tokens = /'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?\*\/|[()]/g;
  tokens.lastIndex = opening.index + opening[0].length;
  let depth = 1;
  for (let match; (match = tokens.exec(sql));) {
    if (match[0] === '(') depth++;
    if (match[0] === ')' && --depth === 0) return sql.slice(0, tokens.lastIndex);
  }
  assert.fail('proof_sources CTE has no closing parenthesis');
}

function captureProofs(call) {
  const prepare = DatabaseSync.prototype.prepare;
  const proofs = [], wrapped = [];
  DatabaseSync.prototype.prepare = function (sql) {
    const statement = prepare.call(this, sql);
    if (!sql.startsWith('WITH candidates AS MATERIALIZED (') || sql.includes('headers AS MATERIALIZED (')) return statement;
    wrapped.push(statement);
    for (const method of ['get', 'all']) {
      const execute = statement[method];
      statement[method] = (...params) => {
        const proof = { sql, params, inTransaction: this.isTransaction };
        proofs.push(proof);
        try {
          // Keep the full named bindings valid when the later CTEs are cut off.
          proof.count = prepare.call(this, `${proofSourcesPrefix(proof.sql)}
            SELECT count(*) AS rows, $proof_sources, $proof_budget FROM proof_sources`).get(...proof.params).rows;
        } catch (error) {
          proof.error = error;
        }
        const result = execute.apply(statement, params);
        const row = method === 'get' ? result : result[0];
        proof.roots = row?.episode_read_stats && JSON.parse(row.episode_read_stats).roots;
        return result;
      };
    }
    return statement;
  };
  try { return { proofs, result: call() }; }
  finally {
    DatabaseSync.prototype.prepare = prepare;
    // Drop the per-statement wrappers so a retained statement never records into this capture again.
    for (const statement of wrapped) { delete statement.get; delete statement.all; }
  }
}

test('Episode proof allowance fixtures cover the suppression layouts', () => {
  assert.deepEqual(layouts, SAFETY_SCHEMA_VERSIONS.filter(physical => resolveContentLayout(physical).suppressionRevision));
});

for (const physical of layouts) {
  test(`Episode proof allowance invariant on layout ${physical}`, async t => {
    const layout = resolveContentLayout(physical);
    const fixture = costFamilyFixture(t, layout.base, layout.attestedFeatures ? 'event-time' : 'safety');
    assert.equal((await fixture.migrate()).physical, physical);
    const db = fixture.connect();
    fixture.workspace.defer(() => db.close());
    const runtime = createMemoryRuntime({ path: fixture.path, sessionEpisodes: { mode: 'episode-v1' } });
    fixture.workspace.defer(() => runtime.close());
    const at = '2026-06-02T00:00:00.000Z';
    publish(runtime, db, 'older', '2026-06-01T00:00:00.000Z');
    const { episodeId, ...source } = publish(runtime, db, 'newest', at);
    if (layout.rawLineage) addRawIdentity(db, source, at);
    const core = openMemoryCore({ path: fixture.path, model: { contextWindow: 8192, countTokens: () => 1 } });
    fixture.workspace.defer(() => core.close());

    const calls = {
      getEpisode: () => core.getEpisode({ namespace: ns, episodeId }),
      'listEpisodes (event)': () => core.listEpisodes({ namespace: ns, ...range, timeBasis: 'event' }),
      'listEpisodes (receipt)': () => core.listEpisodes({ namespace: ns, ...range, timeBasis: 'receipt' }),
      nextSteps: () => core.sessionStartContext({ namespace: ns, groups: { nextSteps: true, procedural: false } })
    };
    for (const [name, call] of Object.entries(calls)) {
      await t.test(name, subtest => {
        const { proofs, result } = captureProofs(call);
        assert.equal(proofs.length, name === 'nextSteps' ? 2 : 1, 'executed proof count');
        for (const { params, inTransaction, count, roots, error } of proofs) {
          const allowance = params[0].$proof_sources;
          subtest.diagnostic(JSON.stringify({ physical, caller: name, allowance, count, roots }));
          assert.ifError(error);
          assert.equal(inTransaction, true, 'count shares the engine read snapshot');
          assert.equal(count, allowance, 'proof_sources row count equals the bound $proof_sources');
          assert.ok(allowance >= 3, 'the fixture exercises several sources');
          if (layout.rawLineage) assert.ok(roots > 0, 'the proof includes a Raw source root');
        }
        ok(result);
      });
    }
  });
}
