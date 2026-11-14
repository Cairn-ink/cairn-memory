import assert from 'node:assert/strict';
import test from 'node:test';
import { checkGate } from './core-gate.mjs';

function fixture() {
  const jobs = Array.from({ length: 6 }, (_, index) => ({
    name: `core-shard-24 (${index + 1}) / shard`, conclusion: 'success', run_attempt: 3,
  }));
  const artifacts = Array.from({ length: 6 }, (_, index) => ({ name: `core-pass-24-${index + 1}-3`, expired: false }));
  return { jobs, artifacts };
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

test('gate accepts six successful jobs with non-expired markers pinned to each attempt and prints its checks', async () => {
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

test('gate rejects missing, expired and stale markers even when an earlier attempt passed', async () => {
  const missing = fixture();
  missing.artifacts.pop();
  await assert.rejects(check(missing), /missing non-expired marker core-pass-24-6-3/);
  const expired = fixture();
  expired.artifacts[0].expired = true;
  await assert.rejects(check(expired), /missing non-expired marker core-pass-24-1-3/);
  const stale = fixture();
  stale.artifacts[0].name = 'core-pass-24-1-2';
  await assert.rejects(check(stale), /missing non-expired marker core-pass-24-1-3/);
});

test('attempt-two listing accepts a carried-over attempt-one job with its attempt-one marker', async () => {
  const data = fixture();
  data.jobs.forEach(job => { job.run_attempt = 2; });
  data.artifacts.forEach((artifact, index) => { artifact.name = `core-pass-24-${index + 1}-2`; });
  data.jobs[0].run_attempt = 1;
  data.artifacts[0].name = 'core-pass-24-1-1';
  const { logs } = await check(data, { runAttempt: '2' });
  assert.ok(logs.some(line => line.includes('job attempt 1, marker core-pass-24-1-1')));
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
