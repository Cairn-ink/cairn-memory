"""Synthetic operator keystrokes only; never evidence of a real user's approval."""
import errno
import json
import os
import pty
import select
import signal
import sys
import time

child, terminal = pty.fork()
if child == 0:
    os.execv(sys.argv[1], sys.argv[1:])

output = bytearray()
prompted = False
reaped = False

def terminate(signum, frame):
    raise RuntimeError('pty supervisor terminated')

signal.signal(signal.SIGTERM, terminate)
signal.signal(signal.SIGINT, terminate)
try:
    deadline = time.monotonic() + 25
    while True:
        if time.monotonic() > deadline:
            raise RuntimeError('pty review deadline')
        pid, status = os.waitpid(child, os.WNOHANG)
        if pid:
            reaped = True
        ready, _, _ = select.select([terminal, sys.stdin], [], [], 0.05)
        if terminal in ready:
            try:
                data = os.read(terminal, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                data = b''
            output.extend(data)
            if len(output) > 700000:
                raise RuntimeError('pty output exceeded bound')
            # Quoted untrusted JSON may contain this text. The real prompt is
            # a complete line-start frame at the current terminal output end.
            if not prompted and (output == b'Approval> ' or output.endswith(b'\nApproval> ')):
                prompted = True
                print(json.dumps({'event': 'prompt', 'output': output.decode('utf-8')}), flush=True)
        if sys.stdin in ready:
            line = sys.stdin.readline()
            if not line:
                os.write(terminal, b'\x04')
            else:
                action = json.loads(line)
                os.write(terminal, b'\x04' if action.get('eof') else (action['answer'] + '\n').encode('utf-8'))
        if reaped:
            # Drain final result after waitpid; a PTY returns EIO at its EOF.
            while True:
                try:
                    data = os.read(terminal, 65536)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    break
                if not data:
                    break
                output.extend(data)
            print(json.dumps({'event': 'done', 'code': os.waitstatus_to_exitcode(status),
                              'output': output.decode('utf-8')}), flush=True)
            break
finally:
    if not reaped:
        try:
            os.kill(child, signal.SIGKILL)
        except ProcessLookupError:
            pass
        os.waitpid(child, 0)
    os.close(terminal)
