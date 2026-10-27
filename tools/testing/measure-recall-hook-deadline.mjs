// Opt-in, sequential, synthetic process measurement. Never retries a failure.
import { invocation, scenarios, assertScenario, processViolations }
  from '../../plugins/cairn-memory/test/fixtures/recall-deadline-harness.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--runs' || !/^[1-9]\d*$/.test(args[1]))) {
  console.error('usage: measure-recall-hook-deadline.mjs [--runs N]');
  process.exitCode = 1;
} else {
  const runs = args.length ? Number(args[1]) : 5;
  if (!Number.isSafeInteger(runs)) {
    console.error('invalid_run_count');
    process.exitCode = 1;
  } else {
    const stats = values => {
      if (!values.length) return { max: null, p50: null };
      const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
      const round = value => Math.round(value * 1000) / 1000;
      return { max: round(sorted.at(-1)), p50: round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) };
    };
    for (const [scenario, options] of Object.entries(scenarios)) {
      const exitCodes = [], spawnClose = [], applicationClose = [];
      let hostKills = 0, firstFailure = null;
      for (let run = 1; run <= runs; run++) {
        const violations = [];
        try {
          const result = await invocation(null, options);
          exitCodes.push(result.code); hostKills += Number(result.hostKilled);
          spawnClose.push(result.elapsedMs);
          violations.push(...processViolations(result));
          const entries = result.events.filter(event => event.kind === 'application-entry');
          if (entries.length !== 1 || !Number.isFinite(entries[0].ms) || entries[0].ms < 0 || entries[0].ms > result.elapsedMs)
            violations.push('application_entry_missing_or_invalid');
          else {
            const elapsed = result.elapsedMs - entries[0].ms;
            applicationClose.push(elapsed);
            if (elapsed > 2750) violations.push('application_close_deadline');
          }
          try { assertScenario(scenario, result); }
          catch { violations.push('scenario_assertion'); }
        } catch {
          // Do not print arbitrary exception messages, which might contain state.
          violations.push('harness_failure');
        }
        if (violations.length) {
          firstFailure ??= { run, violations };
          process.exitCode = 1;
        }
      }
      console.log(JSON.stringify({ scenario, node: process.version, runs, exitCodes, hostKills,
        spawnToCloseMs: stats(spawnClose), applicationEntryToCloseMs: stats(applicationClose), firstFailure }));
    }
  }
}
