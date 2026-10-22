import { loadFixture, readJson, writeJson, cliMain, requiredOption } from './lib/fixture.mjs';
import { scoreRuns } from './lib/metrics.mjs';

await cliMain(import.meta.url, async options => {
  const fixture = await loadFixture(requiredOption(options, 'fixture'));
  if (options.labels) fixture.labels = await readJson(options.labels);
  if (!options._.length) throw new Error('rankings_files_required');
  // Optional manifest: a JSON array of rankings-file paths without the foreign
  // namespace, in the same order as the positional rankings inputs.
  const withoutForeign = options['without-foreign'] ? await Promise.all((await readJson(options['without-foreign'])).map(readJson)) : undefined;
  const scores = scoreRuns(fixture, await Promise.all(options._.map(readJson)), { withoutForeign });
  await writeJson(requiredOption(options, 'out'), scores);
  console.log(JSON.stringify({ ok: scores.ok, runs: scores.runs.length, failures: scores.runs.flatMap(run => run.failures), a0: scores.a0 }));
  if (!scores.ok) process.exitCode = 1;
});
