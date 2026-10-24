"""Synthetic terminal review acceptance; never represents a real user's approval."""
import errno
import json
import os
import pty
import re
import select
import signal
import sys
import time

phrase = sys.argv[1]
child, terminal = pty.fork()
if child == 0:
    os.execv(sys.argv[2], sys.argv[2:])
output = bytearray()
reaped = False
answered = False
try:
    deadline = time.monotonic() + 25
    while True:
        if time.monotonic() > deadline:
            raise RuntimeError('terminal test deadline')
        ready, _, _ = select.select([terminal], [], [], .05)
        if ready:
            try:
                data = os.read(terminal, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                data = b''
            output.extend(data)
            if len(output) > 700000:
                raise RuntimeError('terminal output limit')
            if not answered and output.endswith(b'\nApproval> '):
                answered = True
                selected = json.loads(re.findall(rb'type ("[^"]+") and press Enter', output)[-1]) if phrase == '__DISPLAYED__' else phrase
                os.write(terminal, (selected + '\n').encode())
        pid, status = os.waitpid(child, os.WNOHANG)
        if pid:
            reaped = True
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
            print(json.dumps({'code': os.waitstatus_to_exitcode(status), 'answered': answered, 'output': output.decode()}))
            break
finally:
    if not reaped:
        os.kill(child, signal.SIGKILL)
        os.waitpid(child, 0)
    os.close(terminal)
