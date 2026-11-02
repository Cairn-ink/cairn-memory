// Pure metadata predicates shared by the number-stat and bigint-stat guards.
// Callers supply lstat snapshots; this module performs no filesystem access.
export const sameJournal = (actual, expected) =>
  ['dev','ino','mode','uid','nlink'].every(key => actual[key] === expected[key]);
const sameProof = (actual, expected) => actual && expected &&
  ['dev','ino','mode','uid','gid','nlink'].every(key => actual[key] === expected[key]);
export function protectedDeleteJournal({ main, directory, journal, wal, shm }, proof = { main, directory, journal }) {
  const uid = process.getuid?.();
  const file = entry => entry?.isFile() && !entry.isSymbolicLink() &&
    (process.platform === 'win32' || (Number(entry.mode) & 0o777) === 0o600);
  return file(main) && file(journal) && Number(main.nlink) === 1 && Number(journal.nlink) === 1 &&
    directory?.isDirectory() && !directory.isSymbolicLink() &&
    (process.platform === 'win32' || (Number(directory.mode) & 0o777) === 0o700 &&
      uid !== undefined && [main, journal, directory].every(entry => Number(entry.uid) === uid)) &&
    sameProof(main, proof.main) && sameProof(directory, proof.directory) &&
    ['mode','uid','nlink'].every(key => journal[key] === proof.journal[key]) && !wal && !shm;
}
