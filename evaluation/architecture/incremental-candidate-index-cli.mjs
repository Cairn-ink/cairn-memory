import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const sizes = { '--demo': [100, 1000], '--measure-full': [10000] };
const supported = () => {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 16);
};

export async function main(argv, { stdout = process.stdout, stderr = process.stderr,
  runner = spawnSync } = {}) {
  if (!supported()) { stderr.write('node_sqlite_unavailable\n'); return 1; }
  if (argv.length === 2 && argv[0] === '--internal-size' && [100, 1000, 10000].includes(Number(argv[1]))) {
    try {
      const { runOfflineExperiment } = await import('./incremental-candidate-index.mjs');
      stdout.write(`${JSON.stringify(runOfflineExperiment(Number(argv[1])))}\n`);
      return 0;
    } catch { stderr.write('experiment_failed\n'); return 1; }
  }
  if (argv.length !== 1 || !Object.hasOwn(sizes, argv[0])) {
    stderr.write('invalid_experiment_arguments\n'); return 1;
  }
  const reports = [];
  for (const size of sizes[argv[0]]) {
    const child = runner(process.execPath, [script, '--internal-size', String(size)],
      { encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024 });
    if (child.error?.code === 'ETIMEDOUT') {
      stdout.write(`${JSON.stringify({ schemaVersion: 'incremental-candidate-index-v1',
        status: 'timeout', failedSize: size, completedReports: reports })}\n`);
      stderr.write('size_timeout\n'); return 1;
    }
    if (child.status !== 0) {
      stdout.write(`${JSON.stringify({ schemaVersion: 'incremental-candidate-index-v1',
        status: 'failed', failedSize: size, completedReports: reports })}\n`);
      stderr.write('experiment_failed\n'); return 1;
    }
    try { reports.push(JSON.parse(child.stdout)); }
    catch {
      stdout.write(`${JSON.stringify({ schemaVersion: 'incremental-candidate-index-v1',
        status: 'failed', failedSize: size, completedReports: reports })}\n`);
      stderr.write('experiment_failed\n'); return 1;
    }
  }
  stdout.write(`${JSON.stringify({ schemaVersion: 'incremental-candidate-index-v1', reports })}\n`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}
