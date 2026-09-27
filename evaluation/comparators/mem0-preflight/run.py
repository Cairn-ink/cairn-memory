"""Run the pinned Mem0 engine preflight without keys or external model calls.

Prerequisite: run with a separate Python environment installed from the sibling
requirements.lock. This wrapper never installs packages or imports Mem0.
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path


def main() -> int:
    if sys.version_info[:2] != (3, 11):
        raise SystemExit("This lock was resolved for Python 3.11")

    child = Path(__file__).with_name("child.py")
    with tempfile.TemporaryDirectory(prefix="cairn-mem0-engine-") as root:
        root_path = Path(root)
        # Explicit allowlist: no inherited credentials, proxy, endpoint, or user
        # configuration. The token is deliberately unusable outside fake HTTP.
        child_env = {
            "MEM0_DIR": str(root_path / "mem0-config"),
            "MEM0_TELEMETRY": "False",
            "OPENAI_API_KEY": "synthetic-no-key",
            "PYTHONNOUSERSITE": "1",
            "XDG_CACHE_HOME": str(root_path / "cache"),
            "TMPDIR": str(root_path),
            "LC_ALL": "C.UTF-8",
        }
        completed = subprocess.run(
            [sys.executable, "-I", str(child), str(root_path)],
            env=child_env,
            text=True,
            capture_output=True,
            timeout=90,
            check=False,
        )
        if completed.returncode:
            if completed.stdout:
                print(completed.stdout, end="", file=sys.stderr)
            if completed.stderr:
                print(completed.stderr, end="", file=sys.stderr)
            return completed.returncode
        result = json.loads(completed.stdout)
        print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
