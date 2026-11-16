import test from 'node:test';
import { runMatrixCase } from './fixtures/forget-episode-matrix.mjs';

// Paired forget/correct cases retain their original recording names.
const cases = [
  ['X_48_no_episodes', { layout: 48, noEpisodes: true }],
  ['X_48_episodes_other_session_only', { layout: 48, episodeOtherOnly: true }],
  ['X_53time_no_episodes', { layout: 53, noEpisodes: true }],
  ['X_53time_episodes_other_session_only', { layout: 53, episodeOtherOnly: true }],
  ['X_53lineage_no_episodes', { layout: 53, cardLineage: true, noEpisodes: true }],
];
for (const [name, options] of cases) for (const operation of ['forget', 'correct']) {
  const caseName = name === 'X_53time_episodes' && operation === 'correct' ? 'X_53time_correct_episodes' : name + ' ' + operation;
  test(caseName, { concurrency: false, timeout: 120000 }, t => runMatrixCase(t, options, operation));
}
