"""Real stdio byte relay. File-backed Node output also works in pipe-restricted
POSIX sandboxes. No protocol parsing, replies, tool mocks or approval occurs."""
import os
import select
import signal
import subprocess
import sys
import tempfile
import time

child = None

def stop(signum, frame):
    raise RuntimeError('stdio relay stopped')

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    with tempfile.TemporaryDirectory(prefix='method-stdio-', dir=sys.argv[1]) as root:
        with open(root + '/stdout', 'w+b', buffering=0) as out, open(root + '/stderr', 'w+b', buffering=0) as err:
            child = subprocess.Popen(sys.argv[2:], stdin=subprocess.PIPE, stdout=out, stderr=err)
            output = open(root + '/stdout', 'rb', buffering=0)
            errors = open(root + '/stderr', 'rb', buffering=0)
            try:
                incoming = True
                deadline = time.monotonic() + 150
                while True:
                    if time.monotonic() > deadline:
                        raise RuntimeError('stdio relay deadline')
                    if incoming and select.select([sys.stdin], [], [], 0.01)[0]:
                        data = os.read(sys.stdin.fileno(), 65536)
                        if data:
                            child.stdin.write(data)
                            child.stdin.flush()
                        else:
                            incoming = False
                            child.stdin.close()
                    elif not incoming:
                        time.sleep(0.01)
                    for source, target in [(output, sys.stdout), (errors, sys.stderr)]:
                        data = source.read(65536)
                        if data:
                            target.buffer.write(data)
                            target.buffer.flush()
                    if child.poll() is not None:
                        for source, target in [(output, sys.stdout), (errors, sys.stderr)]:
                            target.buffer.write(source.read())
                            target.buffer.flush()
                        sys.exit(child.returncode)
            finally:
                output.close()
                errors.close()
finally:
    if child is not None and child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=2)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
