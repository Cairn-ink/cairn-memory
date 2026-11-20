// Deterministic failed election: never imports the daemon or publishes.
process.stderr.write('synthetic_candidate_lost_lock\n');
process.exitCode = 17;
