import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The needs aggregate alone cannot prove that all matrix legs succeeded.
// Resolve the shard jobs listed for this attempt, then require each job's own
// pass marker. GitHub lists a job carried over by "re-run failed jobs" with the
// current attempt number and a new id, but copies its original start and
// completion times. A job therefore ran in the EARLIEST attempt whose listing
// shows the same shard with identical times, and its marker carries that
// attempt number. Only job-listing timestamps are compared with each other;
// artifact and job clocks are never compared.
export async function checkGate({ nodeKey, shards, needsResult, token, repository, runId, runAttempt,
  fetchImpl = globalThis.fetch, log = console.log }) {
  if (needsResult !== 'success') throw new Error(`needs result is ${needsResult ?? 'missing'}; expected success`);
  if (!/^[\w-]+$/.test(nodeKey ?? '') || !Number.isSafeInteger(shards) || shards < 1 ||
      !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^[1-9]\d*$/.test(String(runId)) ||
      !/^[1-9]\d*$/.test(String(runAttempt)) || !token) throw new Error('missing or invalid gate configuration');
  log(`Checking core ${nodeKey}: needs=success, run ${runId}, attempt ${runAttempt}, ${shards} shards`);
  const base = `https://api.github.com/repos/${repository}/actions/runs/${runId}`;
  async function pages(path, field) {
    const endpoint = `${base}${path}`;
    let url = `${endpoint}?per_page=100&page=1`;
    const seen = new Set();
    const items = [];
    while (url) {
      if (seen.has(url)) throw new Error(`repeated pagination URL for ${field}`);
      seen.add(url);
      let response;
      try {
        response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
      } catch { throw new Error(`API request failed for ${field}`); }
      if (!response.ok) throw new Error(`API ${field}: HTTP ${response.status}`);
      let body;
      try { body = await response.json(); } catch { throw new Error(`API ${field}: non-JSON response`); }
      if (!body || !Array.isArray(body[field])) throw new Error(`API ${field}: invalid JSON payload`);
      items.push(...body[field]);
      const next = response.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/);
      url = next?.[1];
      if (url) {
        const target = new URL(url);
        if (target.origin + target.pathname !== endpoint) throw new Error(`invalid pagination URL for ${field}`);
      }
    }
    log(`Checked ${field}: ${items.length} entries across ${seen.size} page(s)`);
    return items;
  }
  const listings = new Map();
  const listing = async attempt => {
    if (!listings.has(attempt)) listings.set(attempt, await pages(`/attempts/${attempt}/jobs`, 'jobs'));
    return listings.get(attempt);
  };
  const shardJob = (jobs, name) => {
    const matches = jobs.filter(job => job?.name === name);
    if (matches.length > 1) throw new Error(`${name}: expected exactly one job, found ${matches.length}`);
    return matches[0];
  };
  const current = Number(runAttempt);
  const jobs = await listing(current);
  const selected = [];
  for (let shard = 1; shard <= shards; shard++) {
    const name = `core-shard-${nodeKey} (${shard}) / shard`;
    const job = shardJob(jobs, name);
    if (!job) throw new Error(`${name}: expected exactly one job, found 0`);
    if (job.conclusion !== 'success') throw new Error(`${name}: conclusion ${job.conclusion ?? 'missing'}`);
    const started = Date.parse(job.started_at), completed = Date.parse(job.completed_at);
    if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) {
      throw new Error(`${name}: missing or invalid job start/completion time`);
    }
    let ranIn;
    for (let attempt = 1; attempt <= current && ranIn === undefined; attempt++) {
      const row = shardJob(await listing(attempt), name);
      if (row && row.started_at === job.started_at && row.completed_at === job.completed_at) {
        if (row.conclusion !== 'success') throw new Error(`${name}: attempt ${attempt} conclusion ${row.conclusion ?? 'missing'}`);
        ranIn = attempt;
      }
    }
    if (ranIn === undefined) throw new Error(`${name}: no attempt listing matches this job's run`);
    selected.push({ shard, job, ranIn });
  }
  const artifacts = await pages('/artifacts', 'artifacts');
  for (const { shard, job, ranIn } of selected) {
    const marker = `core-pass-${nodeKey}-${shard}-${ranIn}`;
    const found = artifacts.filter(artifact => artifact?.name === marker);
    if (found.length !== 1 || found[0].expired !== false) {
      throw new Error(`${job.name}: missing non-expired marker ${marker}`);
    }
    log(`Checked ${job.name}: success, ran in attempt ${ranIn}, marker ${marker}`);
  }
  log(`Core ${nodeKey} gate passed: ${shards} successful jobs, each with the marker from the attempt it ran in`);
}

export async function main(args = process.argv.slice(2), env = process.env) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const arg = args[index];
    if (!['--node-key', '--shards'].includes(arg) || options[arg] !== undefined || !args[index + 1]) {
      throw new Error('usage: core-gate.mjs --node-key KEY --shards N');
    }
    options[arg] = args[index + 1];
  }
  await checkGate({ nodeKey: options['--node-key'], shards: Number(options['--shards']),
    needsResult: env.CORE_SHARD_NEEDS_RESULT, token: env.GITHUB_TOKEN, repository: env.GITHUB_REPOSITORY,
    runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT });
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(`Core gate failed: ${error.message}`); process.exitCode = 1; }
}
