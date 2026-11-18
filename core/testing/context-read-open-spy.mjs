// Exact child programs are deliberate expectations, not imported from the
// implementation: changing their open flags or adding an open must fail here.
const headerProbe = `
      import { openSync, readSync, closeSync, fstatSync, constants } from 'node:fs';
      let fd;
      try {
        fd = openSync(process.argv[1], constants.O_RDONLY | constants.O_NOFOLLOW);
        const opened = fstatSync(fd, { bigint: true });
        const header = Buffer.alloc(20), length = readSync(fd, header, 0, 20, 0);
        process.stdout.write(JSON.stringify({ device: String(opened.dev), inode: String(opened.ino),
          mode: length === 20 && header.subarray(0,16).equals(Buffer.from('SQLite format 3\\0')) ?
          header[18] === 1 && header[19] === 1 ? 'delete' :
          header[18] === 2 && header[19] === 2 ? 'wal' : 'other' : 'other' }));
      } finally { if (fd !== undefined) closeSync(fd); }
    `;
const options = maxBuffer => ({ encoding: 'utf8', env: {}, timeout: 5000, maxBuffer });
export const rawHeaderCall = path => ({ kind: 'child', command: process.execPath,
  args: ['--input-type=module', '-e', headerProbe, path], options: options(1024) });
