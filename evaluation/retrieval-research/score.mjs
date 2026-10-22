import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { loadFixture, readJson, writeJson, cliMain, requiredOption } from './lib/fixture.mjs';
import { scoreRuns } from './lib/metrics.mjs';

await cliMain(import.meta.url, async options => {
  const dir = requiredOption(options, 'fixture'), fixture = await loadFixture(dir);
  if (options['diagnostic-labels'] && !options.labels) throw new Error('diagnostic_labels_requires_labels_file');
  if (options.labels) {
    const frozen = await readFile(join(dir, 'hr1-labels.json')), alternate = await readFile(options.labels);
    if (!frozen.equals(alternate)) {
      if (!options['diagnostic-labels']) throw new Error('alternate_labels_differ_from_frozen');
      const actualHash = createHash('sha256').update(alternate).digest('hex');
      fixture.labelProvenance = { mode: 'diagnostic', frozenHash: fixture.hashes['hr1-labels.json'], actualHash };
      fixture.hashes['hr1-labels.json'] = actualHash;
    }
    fixture.labels = JSON.parse(alternate.toString('utf8'));
  }
  if (!options._.length) throw new Error('rankings_files_required');
  // Optional manifest: a JSON array of rankings-file paths without the foreign
  // namespace, in the same order as the positional rankings inputs.
  const withoutForeign = options['without-foreign'] ? await Promise.all((await readJson(options['without-foreign'])).map(readJson)) : undefined;
  const scores = scoreRuns(fixture, await Promise.all(options._.map(readJson)), { withoutForeign });
  await writeJson(requiredOption(options, 'out'), scores);
  console.log(JSON.stringify({ ok: scores.ok, runs: scores.runs.length, failures: scores.runs.flatMap(run => run.failures), a0: scores.a0 }));
  if (!scores.ok) process.exitCode = 1;
});
