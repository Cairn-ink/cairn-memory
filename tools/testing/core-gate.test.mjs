import assert from 'node:assert/strict';
import test from 'node:test';
import { checkGate } from './core-gate.mjs';

const at = minute => new Date(Date.UTC(2026, 10, 14, 22, 0) + minute * 60000).toISOString().replace('.000', '');

// Shard K of the given attempt ran from minute 30*attempt+K to 30*attempt+K+10
// and uploaded its marker one second before completing.
function shardJob(shard, attempt, listedAttempt = attempt) {
  const start = 30 * attempt + shard;
  return { name: `core-shard-24 (${shard}) / shard`, conclusion: 'success', run_attempt: listedAttempt,
    started_at: at(start), completed_at: at(start + 10) };
}
function marker(shard, attempt) {
  const start = 30 * attempt + shard;
  return { name: `core-pass-24-${shard}-${attempt}`, expired: false,
    created_at: new Date(Date.parse(at(start + 10)) - 1000).toISOString().replace('.000', '') };
}
function fixture() {
  const shards = [1, 2, 3, 4, 5, 6];
  return { jobs: shards.map(shard => shardJob(shard, 3)), artifacts: shards.map(shard => marker(shard, 3)) };
}

async function check(data, options = {}) {
  const calls = [];
  const logs = [];
  const { paginate = false, status = 200, nonJSON = false, ...overrides } = options;
  const result = checkGate({ nodeKey: '24', shards: 6, needsResult: 'success', token: 'synthetic-token',
    repository: 'example/fixture', runId: '123', runAttempt: '3', log: line => logs.push(line),
    fetchImpl: async (url, request) => {
      calls.push(url);
      assert.equal(request.headers.Authorization, 'Bearer synthetic-token');
      const parsed = new URL(url);
      const field = parsed.pathname.endsWith('/jobs') ? 'jobs' : 'artifacts';
      if (field === 'jobs') assert.match(parsed.pathname, /\/runs\/123\/attempts\/[23]\/jobs$/);
      else assert.equal(parsed.pathname, '/repos/example/fixture/actions/runs/123/artifacts');
      assert.equal(parsed.searchParams.get('per_page'), '100');
      const page = Number(parsed.searchParams.get('page'));
      const body = { total_count: data[field].length, [field]: paginate ? data[field].slice((page - 1) * 3, page * 3) : data[field] };
      const next = new URL(url);
      next.searchParams.set('page', '2');
      const headers = paginate && page === 1 ? { link: `<${next}>; rel="next"` } : {};
      return new Response(nonJSON ? 'not JSON' : JSON.stringify(body), { status, headers });
    }, ...overrides });
  await result;
  return { calls, logs };
}

test('gate accepts six successful jobs, each with a marker uploaded during the job, and prints its checks', async () => {
  const { calls, logs } = await check(fixture());
  assert.equal(calls.length, 2);
  assert.equal(logs.filter(line => line.includes('/ shard: success')).length, 6);
  assert.match(logs.at(-1), /6 successful jobs/);
});

test('gate rejects failure, cancelled and skipped shard conclusions', async () => {
  for (const conclusion of ['failure', 'cancelled', 'skipped']) {
    const data = fixture();
    data.jobs[2].conclusion = conclusion;
    await assert.rejects(check(data), new RegExp(`conclusion ${conclusion}`));
  }
});

test('gate rejects a missing job and a duplicate job', async () => {
  const missing = fixture();
  missing.jobs.pop();
  await assert.rejects(check(missing), /expected exactly one job, found 0/);
  const duplicate = fixture();
  duplicate.jobs.push({ ...duplicate.jobs[0] });
  await assert.rejects(check(duplicate), /expected exactly one job, found 2/);
});

test('gate rejects missing and expired markers', async () => {
  const missing = fixture();
  missing.artifacts.pop();
  await assert.rejects(check(missing), /core-shard-24 \(6\) \/ shard: expected one non-expired marker uploaded during the job, found 0/);
  const expired = fixture();
  expired.artifacts[0].expired = true;
  await assert.rejects(check(expired), /\(1\) \/ shard: expected one non-expired marker uploaded during the job, found 0/);
});

test('re-run all: a marker from an earlier run of the shard cannot satisfy the new job', async () => {
  // Attempt 3 re-ran every job; shard 1's only marker is from its attempt-2 run.
  const stale = fixture();
  stale.artifacts[0] = marker(1, 2);
  await assert.rejects(check(stale), /\(1\) \/ shard: expected one non-expired marker uploaded during the job, found 0/);
});

test('re-run failed jobs: carried-over jobs listed with the new attempt number keep their earlier markers', async () => {
  // GitHub lists carried-over jobs with the current run_attempt and a new id,
  // but with their original start and completion times.
  const data = { jobs: [shardJob(1, 2), ...[2, 3, 4, 5, 6].map(shard => shardJob(shard, 1, 2))],
    artifacts: [marker(1, 1), marker(1, 2), ...[2, 3, 4, 5, 6].map(shard => marker(shard, 1))] };
  // Shard 1 failed in attempt 1 (no marker would exist); a stray attempt-1 marker
  // outside its attempt-2 window must not count twice.
  const { logs } = await check(data, { runAttempt: '2' });
  assert.ok(logs.some(line => line.includes('(1) / shard') && line.includes('marker core-pass-24-1-2')));
  assert.ok(logs.some(line => line.includes('(2) / shard') && line.includes('marker core-pass-24-2-1')));
});

test('marker timing: created before the job started or after its completion plus slack is rejected', async () => {
  const early = fixture();
  early.artifacts[0].created_at = new Date(Date.parse(early.jobs[0].started_at) - 1000).toISOString();
  await assert.rejects(check(early), /\(1\) \/ shard: expected one non-expired marker/);
  const late = fixture();
  late.artifacts[0].created_at = new Date(Date.parse(late.jobs[0].completed_at) + 6000).toISOString();
  await assert.rejects(check(late), /\(1\) \/ shard: expected one non-expired marker/);
  const withinSlack = fixture();
  withinSlack.artifacts[0].created_at = new Date(Date.parse(withinSlack.jobs[0].completed_at) + 4000).toISOString();
  await check(withinSlack);
});

test('two markers inside one job window, another Node\'s marker, or a later attempt number are rejected', async () => {
  const twice = fixture();
  twice.artifacts.push({ ...twice.artifacts[0], name: 'core-pass-24-1-2' });
  await assert.rejects(check(twice), /\(1\) \/ shard: expected one non-expired marker uploaded during the job, found 2/);
  const otherNode = fixture();
  otherNode.artifacts[0] = { ...otherNode.artifacts[0], name: 'core-pass-24-22-1-1-3' };
  await assert.rejects(check(otherNode), /\(1\) \/ shard: expected one non-expired marker/);
  const future = fixture();
  future.artifacts[0] = { ...future.artifacts[0], name: 'core-pass-24-1-4' };
  await assert.rejects(check(future), /\(1\) \/ shard: expected one non-expired marker/);
});

test('missing or invalid job times fail closed', async () => {
  for (const change of [job => { delete job.started_at; }, job => { job.completed_at = 'not a time'; },
    job => { job.completed_at = at(0); }]) {
    const data = fixture();
    change(data.jobs[0]);
    await assert.rejects(check(data), /invalid job start\/completion time/);
  }
});

test('gate traverses two pages of both jobs and artifacts', async () => {
  const { calls, logs } = await check(fixture(), { paginate: true });
  assert.equal(calls.length, 4);
  assert.equal(logs.filter(line => line.includes('across 2 page(s)')).length, 2);
});

test('API 403/500, transport errors, non-JSON and invalid payloads fail closed', async () => {
  for (const status of [403, 500]) await assert.rejects(check(fixture(), { status }), new RegExp(`HTTP ${status}`));
  await assert.rejects(check(fixture(), { nonJSON: true }), /non-JSON response/);
  await assert.rejects(check(fixture(), { fetchImpl: async () => { throw new Error('synthetic'); } }), /API request failed/);
  await assert.rejects(check(fixture(), { fetchImpl: async () => new Response('{}') }), /invalid JSON payload/);
  // Artifact failures after a valid job listing also close the gate.
  const data = fixture();
  await assert.rejects(check(data, { fetchImpl: async url => url.includes('/jobs?')
    ? new Response(JSON.stringify({ jobs: data.jobs })) : new Response('{}', { status: 500 }) }), /artifacts: HTTP 500/);
});

test('a non-success needs result rejects before any API call', async () => {
  for (const needsResult of ['failure', 'cancelled', 'skipped', undefined]) {
    await assert.rejects(check(fixture(), { needsResult, fetchImpl: () => assert.fail('must not fetch') }), /needs result/);
  }
});
