import { mkdtemp, open, lstat, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constants } from 'node:fs';
import { refuse, integer } from './bounds.mjs';

export const SCRATCH_BUFFER_BYTES = 16384;

// UTF-16LE scratch permits bounded positional reads by original JS code unit.
// These files are private plaintext scratch, never retained Raw or a cursor.
export async function scratch(state) {
  const directory = await mkdtemp(join(tmpdir(),'cairn-raw-prepare-'));
  let identity, directoryHandle;
  try {
    identity = await lstat(directory);
    directoryHandle = await open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    const opened = await directoryHandle.stat();
    if (!identity.isDirectory() || identity.isSymbolicLink() || opened.dev!==identity.dev || opened.ino!==identity.ino) refuse('raw_source_unavailable');
  } catch (error) {
    try {
      // A one-shot lstat failure may use the no-follow descriptor as the
      // independent identity route. If neither route proves ownership, retain
      // the path and refuse; never remove an unverified replacement.
      if (!identity) {
        directoryHandle ??= await open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
        identity = await directoryHandle.stat();
      }
      const current = await lstat(directory);
      if (current.isDirectory() && !current.isSymbolicLink() && current.dev===identity.dev && current.ino===identity.ino) await rmdir(directory);
    } finally { await directoryHandle?.close(); }
    throw error;
  }
  const files = new Set(); let total = 0, serial = 0, closing;
  async function checkDirectory() {
    const current = await lstat(directory);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev!==identity.dev || current.ino!==identity.ino) refuse('raw_source_unavailable');
  }
  const owner = {
    async create() {
      state.check(); await checkDirectory();
      if (files.size>=2) refuse('raw_source_resource_limit');
      const path = join(directory,'stage-'+serial++), handle = await open(path,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
      let stat, size = 0, removed = false, handleClosed = false;
      const file = { get units() { return size/2; },
        async append(bytes) {
          for (let offset=0;offset<bytes.length;) {
            state.check(); const length = Math.min(SCRATCH_BUFFER_BYTES,bytes.length-offset);
            if (total+length>state.limits.scratchByteLimit) refuse('raw_source_resource_limit');
            const result = await handle.write(bytes,offset,length,size); state.check();
            if (!integer(result.bytesWritten,1,length)) refuse('raw_source_unavailable');
            size += result.bytesWritten; total += result.bytesWritten; offset += result.bytesWritten;
          }
        },
        text: text => file.append(Buffer.from(text,'utf16le')),
        async bytes(start,end) {
          if (!integer(start) || !integer(end,start,size)) refuse();
          const output = Buffer.alloc(end-start);
          for (let offset=0;offset<output.length;) {
            state.check(); const length = Math.min(SCRATCH_BUFFER_BYTES,output.length-offset);
            const result = await handle.read(output,offset,length,start+offset); state.check();
            if (!integer(result.bytesRead,1,length)) refuse('raw_source_unavailable');
            offset += result.bytesRead;
          }
          return output;
        },
        async copyTo(output,start=0,end=size/2) {
          let position = start*2;
          while (position<end*2) {
            const next = Math.min(end*2,position+SCRATCH_BUFFER_BYTES);
            await output.append(await file.bytes(position,next)); position = next;
          }
        },
        async remove() {
          if (removed) return;
          try {
            stat ??= await handle.stat(); await checkDirectory();
            const current = await lstat(path);
            if (!current.isFile() || current.isSymbolicLink() || current.dev!==stat.dev || current.ino!==stat.ino) refuse('raw_source_unavailable');
          } finally { if (!handleClosed) { await handle.close(); handleClosed = true; } }
          await unlink(path); total -= size; removed = true; files.delete(file);
        },
      };
      files.add(file); stat = await handle.stat(); return file;
    },
    close() {
      return closing ??= (async () => {
        const errors = [];
        for (const file of [...files]) try { await file.remove(); } catch (error) { errors.push(error); }
        try { await checkDirectory(); await rmdir(directory); } catch (error) { errors.push(error); }
        finally { await directoryHandle.close(); }
        if (errors.length) refuse('raw_source_unavailable');
      })();
    },
  };
  return owner;
}

export function units(file,state) {
  let from = -1, bytes = Buffer.alloc(0), operations = 0;
  return async position => {
    if ((++operations & 1023)===0) state.check();
    if (position<0 || position>=file.units) return '';
    if (position<from || (position-from)*2>=bytes.length) {
      from = position;
      bytes = await file.bytes(position*2,Math.min(file.units*2,position*2+SCRATCH_BUFFER_BYTES));
    }
    return String.fromCharCode(bytes.readUInt16LE((position-from)*2));
  };
}
