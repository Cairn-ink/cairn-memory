import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";

// Byte/mode/type snapshots deliberately exclude timestamps: a read changes atime.
export async function snapshotHome(root) {
  const entries = [];
  async function visit(path, relative) {
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
      entry.bytes = (await readFile(path)).toString("base64");
    }
    entries.push(entry);
    if (info.isDirectory())
      for (const name of (await readdir(path)).sort())
        await visit(join(path, name), relative ? `${relative}/${name}` : name);
  }
  await visit(root, "");
  return entries;
}
