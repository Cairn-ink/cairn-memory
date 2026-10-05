"""Synthetic test-only starvation of the exact owned pinned interpreter."""
import json
import os
from pathlib import Path
import select
import signal
import sys

leader = int(sys.argv[1])
interpreter = sys.argv[2]
venv_interpreter = sys.argv[3]
case_root = sys.argv[4]
child_file = sys.argv[5]


def descendants(pid, depth=0):
    assert depth < 8
    children = Path(f"/proc/{pid}/task/{pid}/children").read_text().split()
    assert len(children) < 16
    result = []
    for value in children:
        child = int(value)
        result.append(child)
        result.extend(descendants(child, depth + 1))
    return result


leader_proc = Path(f"/proc/{leader}")
leader_cmd = (leader_proc / "cmdline").read_bytes().split(b"\0")
assert leader_proc.stat().st_uid == os.getuid()
assert os.readlink(leader_proc / "exe") == "/usr/bin/bwrap"
assert (case_root + "/gateway.sock").encode() in leader_cmd
assert child_file.encode() in leader_cmd
assert int((leader_proc / "stat").read_text().split()[4]) == leader
matching = []
for pid in descendants(leader):
    proc = Path(f"/proc/{pid}")
    try:
        if os.readlink(proc / "exe") != interpreter:
            continue
        command = (proc / "cmdline").read_bytes().split(b"\0")
        if command != [venv_interpreter.encode(), b"-I", b"-B", b"/app/child.py", b""]:
            continue
        assert proc.stat().st_uid == os.getuid()
        matching.append(pid)
    except FileNotFoundError:
        continue
assert len(matching) == 1
pid = matching[0]
original_starttime = Path(f"/proc/{pid}/stat").read_text().split()[21]
fd = os.pidfd_open(pid, 0)
try:
    # Revalidate ancestry after acquiring the non-recycled descriptor.
    assert pid in descendants(leader)
    proc = Path(f"/proc/{pid}")
    assert proc.stat().st_uid == os.getuid()
    assert (proc / "stat").read_text().split()[21] == original_starttime
    assert (proc / "cmdline").read_bytes().split(b"\0") == [
        venv_interpreter.encode(), b"-I", b"-B", b"/app/child.py", b""]
    assert os.readlink(f"/proc/{pid}/exe") == interpreter
    signal.pidfd_send_signal(fd, signal.SIGSTOP, None, 0)
    print(json.dumps({"stopped": True}), flush=True)
    cleaned = False
    for command in sys.stdin:
        if command.strip() == "resume":
            signal.pidfd_send_signal(fd, signal.SIGCONT, None, 0)
            print(json.dumps({"resumed": True}), flush=True)
            continue
        assert command.strip() == "cleanup"
        gone = bool(select.select([fd], [], [], 0)[0])
        if not gone:
            signal.pidfd_send_signal(fd, signal.SIGKILL, None, 0)
        print(json.dumps({"cleanup": "already_gone" if gone else "pidfd_kill"}), flush=True)
        cleaned = True
        break
    if not cleaned and not select.select([fd], [], [], 0)[0]:
        signal.pidfd_send_signal(fd, signal.SIGKILL, None, 0)
finally:
    os.close(fd)
