"""Test-only pin for one reported bwrap namespace init during startup cancellation."""

import json
import os
from pathlib import Path
import signal
import sys


pid = int(sys.argv[1])
leader = int(sys.argv[2])
case_root = sys.argv[3]
child_file = sys.argv[4]
fd = os.pidfd_open(pid, 0)


def identity():
    proc = Path(f"/proc/{pid}")
    status = (proc / "status").read_text()
    fields = (proc / "stat").read_text().split()
    command = (proc / "cmdline").read_bytes().split(b"\0")
    nspid = next(line for line in status.splitlines() if line.startswith("NSpid:"))
    ppid = next(line for line in status.splitlines() if line.startswith("PPid:"))
    assert proc.stat().st_uid == os.getuid()
    assert os.readlink(proc / "exe") == "/usr/bin/bwrap"
    assert int(nspid.split()[-1]) == 1
    assert b"--ro-bind" in command
    assert (case_root + "/gateway.sock").encode() in command
    assert child_file.encode() in command
    return {"pid": pid, "ppid": int(ppid.split()[-1]),
            "pgid": int(fields[4]), "starttime": fields[21], "nspid": 1}


def inspect_pinned(original):
    try:
        current = identity()
    except FileNotFoundError:
        return None
    assert current["starttime"] == original["starttime"]
    assert current["pgid"] == original["pgid"]
    return current


def cleanup(original):
    current = inspect_pinned(original)
    if current is None:
        print(json.dumps({"cleanup": "already_gone"}), flush=True)
    else:
        signal.pidfd_send_signal(fd, signal.SIGKILL, None, 0)
        print(json.dumps({"cleanup": "pidfd_kill"}), flush=True)


try:
    original = identity()
    assert original["ppid"] == leader and original["pgid"] == leader
    print(json.dumps({"ready": original}), flush=True)
    cleaned = False
    for command in sys.stdin:
        if command.strip() == "probe":
            print(json.dumps({"probe": inspect_pinned(original)}), flush=True)
        elif command.strip() == "cleanup":
            cleanup(original)
            cleaned = True
            break
        else:
            raise ValueError("unknown_probe_command")
    if not cleaned:
        cleanup(original)
finally:
    os.close(fd)
