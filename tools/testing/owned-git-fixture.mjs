import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// The caller supplies its freshly created test workspace. mkdir refuses to
// adopt an existing checkout; all configuration is local to this owned repo.
export function createOwnedGitFixture(workspace) {
  const path = join(workspace.path, 'runtime');
  mkdirSync(path, { mode: 0o700 });
  const git = args => execFileSync('/usr/bin/git', ['-C', path, ...args], {
    stdio: 'ignore',
    env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Synthetic fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Synthetic fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' },
  });
  git(['init']);
  // Newer Git detaches automatic maintenance itself; older Git can detach
  // auto-GC within foreground maintenance. Keep both native paths joined to
  // the synchronous caller, including before assertions or error cleanup.
  git(['config', '--local', 'maintenance.autoDetach', 'false']);
  git(['config', '--local', 'gc.autoDetach', 'false']);
  return Object.freeze({ path, commit(message) {
    git(['add', '--all']);
    git(['commit', '-m', message]);
  } });
}
