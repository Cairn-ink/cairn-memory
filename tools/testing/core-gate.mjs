import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The needs aggregate alone cannot prove that all matrix legs succeeded.
// Resolve the shard jobs listed for this attempt, then require each job's own
// pass marker. GitHub lists a job carried over by "re-run failed jobs" with the
// current attempt number and a new id, but keeps its original start and
// completion times, so the marker is the one uploaded inside that time window.
// A marker from an earlier run of the same shard predates the job's start.
const MARKER_SLACK_MS = 5000;

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
  const jobs = await pages(`/attempts/${runAttempt}/jobs`, 'jobs');
  const selected = [];
  for (let shard = 1; shard <= shards; shard++) {
    const name = `core-shard-${nodeKey} (${shard}) / shard`;
    const matches = jobs.filter(job => job?.name === name);
    if (matches.length !== 1) throw new Error(`${name}: expected exactly one job, found ${matches.length}`);
    const job = matches[0];
    if (job.conclusion !== 'success') throw new Error(`${name}: conclusion ${job.conclusion ?? 'missing'}`);
    const started = Date.parse(job.started_at), completed = Date.parse(job.completed_at);
    if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) {
      throw new Error(`${name}: missing or invalid job start/completion time`);
    }
    selected.push({ shard, job, started, completed });
  }
  const artifacts = await pages('/artifacts', 'artifacts');
  for (const { shard, job, started, completed } of selected) {
    const pattern = new RegExp(`^core-pass-${nodeKey}-${shard}-([1-9]\\d*)$`);
    const markers = artifacts.filter(artifact => {
      const match = pattern.exec(artifact?.name ?? '');
      const created = Date.parse(artifact?.created_at);
      return match && Number(match[1]) <= Number(runAttempt) && artifact.expired === false &&
        Number.isFinite(created) && created >= started && created <= completed + MARKER_SLACK_MS;
    });
    if (markers.length !== 1) {
      throw new Error(`${job.name}: expected one non-expired marker uploaded during the job, found ${markers.length}`);
    }
    log(`Checked ${job.name}: success, ran ${job.started_at}..${job.completed_at}, marker ${markers[0].name}`);
  }
  log(`Core ${nodeKey} gate passed: ${shards} successful jobs, each with its own pass marker`);
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
