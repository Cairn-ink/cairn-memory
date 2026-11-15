import assert from 'node:assert/strict';
import test from 'node:test';
import { checkGate } from './core-gate.mjs';

const at = minute => new Date(Date.UTC(2026, 10, 14, 22, 0) + minute * 60000).toISOString().replace('.000', '');

// Shard K's run in attempt A lasts from minute 30*A+K to 30*A+K+10. A carried
// over row is listed in a later attempt with that attempt's number and a new id
// but the original times, which is what GitHub's attempt listing returns.
function shardRun(shard, attempt, listedAttempt = attempt, conclusion = 'success') {
  const start = 30 * attempt + shard;
  return { name: `core-shard-24 (${shard}) / shard`, conclusion, run_attempt: listedAttempt,
    id: 1000 * listedAttempt + shard, started_at: at(start), completed_at: at(start + 10) };
}
const marker = (shard, attempt) => ({ name: `core-pass-24-${shard}-${attempt}`, expired: false });
const shards = [1, 2, 3, 4, 5, 6];

// One clean attempt: every shard ran and passed in attempt 1.
function fixture() {
  return { attempt: 1, jobs: { 1: shards.map(shard => shardRun(shard, 1)) }, artifacts: shards.map(shard => marker(shard, 1)) };
}

async function check(data, options = {}) {
  const calls = [];
  const logs = [];
  const { paginate = false, status = 200, nonJSON = false, ...overrides } = options;
  await checkGate({ nodeKey: '24', shards: 6, needsResult: 'success', token: 'synthetic-token',
    repository: 'example/fixture', runId: '123', runAttempt: String(data.attempt), log: line => logs.push(line),
    fetchImpl: async (url, request) => {
      calls.push(url);
      assert.equal(request.headers.Authorization, 'Bearer synthetic-token');
      const parsed = new URL(url);
      const jobsPath = parsed.pathname.match(/\/runs\/123\/attempts\/([1-9]\d*)\/jobs$/);
      if (!jobsPath) assert.equal(parsed.pathname, '/repos/example/fixture/actions/runs/123/artifacts');
      const field = jobsPath ? 'jobs' : 'artifacts';
      const items = jobsPath ? data.jobs[jobsPath[1]] ?? [] : data.artifacts;
      assert.equal(parsed.searchParams.get('per_page'), '100');
      const page = Number(parsed.searchParams.get('page'));
      const body = { total_count: items.length, [field]: paginate ? items.slice((page - 1) * 3, page * 3) : items };
      const next = new URL(url);
      next.searchParams.set('page', '2');
      const headers = paginate && page === 1 ? { link: `<${next}>; rel="next"` } : {};
      return new Response(nonJSON ? 'not JSON' : JSON.stringify(body), { status, headers });
    }, ...overrides });
  return { calls, logs };
}

test('gate accepts six successful jobs, each with the marker from the attempt it ran in, and prints its checks', async () => {
  const { calls, logs } = await check(fixture());
  assert.equal(calls.length, 2);
  assert.equal(logs.filter(line => line.includes('/ shard: success, ran in attempt 1')).length, 6);
  assert.match(logs.at(-1), /6 successful jobs/);
});

test('gate rejects failure, cancelled and skipped shard conclusions', async () => {
  for (const conclusion of ['failure', 'cancelled', 'skipped']) {
    const data = fixture();
    data.jobs[1][2].conclusion = conclusion;
    await assert.rejects(check(data), new RegExp(`conclusion ${conclusion}`));
  }
});

test('gate rejects a missing job and a duplicate job', async () => {
  const missing = fixture();
  missing.jobs[1].pop();
  await assert.rejects(check(missing), /expected exactly one job, found 0/);
  const duplicate = fixture();
  duplicate.jobs[1].push({ ...duplicate.jobs[1][0] });
  await assert.rejects(check(duplicate), /expected exactly one job, found 2/);
});

test('gate rejects missing, expired and duplicate markers', async () => {
  const missing = fixture();
  missing.artifacts.pop();
  await assert.rejects(check(missing), /\(6\) \/ shard: missing non-expired marker core-pass-24-6-1/);
  const expired = fixture();
  expired.artifacts[0].expired = true;
  await assert.rejects(check(expired), /\(1\) \/ shard: missing non-expired marker core-pass-24-1-1/);
  const duplicate = fixture();
  duplicate.artifacts.push(marker(1, 1));
  await assert.rejects(check(duplicate), /\(1\) \/ shard: missing non-expired marker core-pass-24-1-1/);
});

test('re-run failed jobs: carried-over rows keep the marker of the attempt they ran in', async () => {
  // Attempt 1: shard 1 failed, the rest passed. Attempt 2 re-ran only shard 1;
  // the other rows are listed again with run_attempt 2 and their attempt-1 times.
  const data = { attempt: 2,
    jobs: { 1: [shardRun(1, 1, 1, 'failure'), ...shards.slice(1).map(shard => shardRun(shard, 1))],
      2: [shardRun(1, 2), ...shards.slice(1).map(shard => shardRun(shard, 1, 2))] },
    artifacts: [marker(1, 2), ...shards.slice(1).map(shard => marker(shard, 1))] };
  const { logs } = await check(data);
  assert.ok(logs.some(line => line.includes('(1) / shard: success, ran in attempt 2, marker core-pass-24-1-2')));
  assert.ok(logs.some(line => line.includes('(2) / shard: success, ran in attempt 1, marker core-pass-24-2-1')));
});

test('re-run all: an earlier run\'s marker cannot satisfy the new run of that shard, whatever the clocks say', async () => {
  // Attempt 2 passed everywhere; attempt 3 re-ran every shard. Shard 1's new run
  // has its own times, so it needs core-pass-24-1-3, which is absent.
  const data = { attempt: 3, jobs: { 1: shards.map(shard => shardRun(shard, 1)),
    2: shards.map(shard => shardRun(shard, 2)), 3: shards.map(shard => shardRun(shard, 3)) },
  artifacts: [...shards.map(shard => marker(shard, 2)), ...shards.slice(1).map(shard => marker(shard, 3))] };
  await assert.rejects(check(data), /\(1\) \/ shard: missing non-expired marker core-pass-24-1-3/);
});

test('a later attempt\'s marker and another Node\'s marker do not satisfy a shard', async () => {
  const later = fixture();
  later.artifacts[0] = marker(1, 2);
  await assert.rejects(check(later), /\(1\) \/ shard: missing non-expired marker core-pass-24-1-1/);
  const otherNode = fixture();
  otherNode.artifacts[0] = { name: 'core-pass-24-22-1-1-1', expired: false };
  await assert.rejects(check(otherNode), /\(1\) \/ shard: missing non-expired marker core-pass-24-1-1/);
});

test('missing or invalid job times, and a run no listing explains, fail closed', async () => {
  for (const change of [job => { delete job.started_at; }, job => { job.completed_at = 'not a time'; },
    job => { job.completed_at = at(0); }]) {
    const data = fixture();
    change(data.jobs[1][0]);
    await assert.rejects(check(data), /invalid job start\/completion time/);
  }
  // The current row claims times that no attempt listing shows for that shard.
  const orphan = { attempt: 2, jobs: { 1: shards.map(shard => shardRun(shard, 1)),
    2: [{ ...shardRun(1, 1, 2), completed_at: at(99) }, ...shards.slice(1).map(shard => shardRun(shard, 1, 2))] },
  artifacts: shards.map(shard => marker(shard, 1)) };
  // Attempt 2's own row matches itself, so it needs core-pass-24-1-2.
  await assert.rejects(check(orphan), /\(1\) \/ shard: missing non-expired marker core-pass-24-1-2/);
  const failedOrigin = { attempt: 2,
    jobs: { 1: [shardRun(1, 1, 1, 'failure'), ...shards.slice(1).map(shard => shardRun(shard, 1))],
      2: [shardRun(1, 1, 2), ...shards.slice(1).map(shard => shardRun(shard, 1, 2))] },
    artifacts: shards.map(shard => marker(shard, 1)) };
  await assert.rejects(check(failedOrigin), /\(1\) \/ shard: attempt 1 conclusion failure/);
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
    ? new Response(JSON.stringify({ jobs: data.jobs[1] })) : new Response('{}', { status: 500 }) }), /artifacts: HTTP 500/);
});

test('a non-success needs result rejects before any API call', async () => {
  for (const needsResult of ['failure', 'cancelled', 'skipped', undefined]) {
    await assert.rejects(check(fixture(), { needsResult, fetchImpl: () => assert.fail('must not fetch') }), /needs result/);
  }
});
