"""Cross-check changed paths with independent Git and disk/blob inventories."""
import hashlib
import json
import os
from pathlib import Path
import subprocess


def git(*args, input=None):
    return subprocess.check_output(["git", *args], input=input)


root = Path(git("rev-parse", "--show-toplevel").decode().strip())
os.chdir(root)
first = set(filter(None, git("diff", "--name-only", "HEAD", "-z").decode().split("\0")))
first.update(filter(None, git("ls-files", "--others", "--exclude-standard", "-z").decode().split("\0")))
tree = {}
for entry in git("ls-tree", "-r", "-z", "HEAD").split(b"\0"):
    if not entry:
        continue
    header, name = entry.split(b"\t", 1)
    mode, kind, oid = header.decode().split()
    if kind != "blob":
        raise RuntimeError("unsupported_tree_entry")
    tree[name.decode()] = (mode, oid)
disk = {}
for directory, children, files in os.walk("."):
    children[:] = [child for child in children if child not in {".git", "node_modules", "__pycache__"}]
    for filename in files:
        path = Path(directory) / filename
        name = path.as_posix()
        if name == ".git":
            continue
        data = os.readlink(path).encode() if path.is_symlink() else path.read_bytes()
        mode = "120000" if path.is_symlink() else "100755" if path.stat().st_mode & 0o111 else "100644"
        oid = hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
        disk[name] = (mode, oid)
extras = set(disk) - set(tree)
ignore = subprocess.run(["git", "check-ignore", "-z", "--stdin"], input=b"\0".join(n.encode() for n in extras) + b"\0", stdout=subprocess.PIPE, check=False)
if ignore.returncode not in {0, 1}:
    raise RuntimeError("ignore_check_failed")
ignored = set(filter(None, ignore.stdout.decode().split("\0")))
second = {name for name in set(tree) | (set(disk) - ignored) if tree.get(name) != disk.get(name)}
if first != second:
    print(json.dumps({"gitOnly": sorted(first - second), "diskOnly": sorted(second - first)}))
    raise RuntimeError("changed_file_inventory_mismatch")
print(json.dumps({"crossCheck": "git diff + untracked vs HEAD tree + independent disk blob/mode walk", "count": len(first), "files": sorted(first)}, indent=2))
