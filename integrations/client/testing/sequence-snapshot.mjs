import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";

// Byte/mode/type snapshots deliberately exclude timestamps: a read changes atime.
export async function snapshotHome(root) {
  const entries = [];
  async function visit(path, relative) {
    if (/^\.cairn-memory-clients\/setup\.lock(?:$|\.owner-|\.reap-)/.test(relative)) return;
    let info;
    try {
      info = await lstat(path);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    const entry = { path: relative, mode: info.mode & 0o777, type: "directory" };
    if (info.isSymbolicLink()) {
      entry.type = "symlink";
      entry.bytes = await readlink(path);
    } else if (info.isFile()) {
      entry.type = "file";
      try {
        entry.bytes = (await readFile(path)).toString("base64");
      } catch (error) {
        if (error.code !== "EACCES") throw error;
        entry.unreadable = true;
      }
    }
    entries.push(entry);
    if (info.isDirectory()) {
      let names;
      try {
        names = await readdir(path);
      } catch (error) {
        if (error.code !== "EACCES") throw error;
        entry.unreadable = true;
        return;
      }
      for (const name of names.sort())
        await visit(join(path, name), relative ? `${relative}/${name}` : name);
    }
  }
  await visit(root, "");
  return entries;
}
