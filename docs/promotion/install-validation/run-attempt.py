#!/usr/bin/env python3
"""Record one isolated, model-free run of the README installation commands.

Only the evidence directory and a new OS temporary directory are written.
No environment credentials are forwarded. A per-attempt npm shim chooses the
requested Node/npm runtime and gives even nested npm commands a private cache.
"""

import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import time


def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


parser = argparse.ArgumentParser()
parser.add_argument("--attempt", required=True)
parser.add_argument("--node", type=Path, required=True)
args = parser.parse_args()
evidence = Path(__file__).resolve().parent
repository = evidence.parents[2]
node = args.node.resolve(strict=True)
npm_cli = node.parent.parent / "lib/node_modules/npm/bin/npm-cli.js"
if not npm_cli.is_file():
    raise SystemExit("npm CLI not found beside selected Node")
out = evidence / args.attempt
out.mkdir(mode=0o700)
work = Path(tempfile.mkdtemp(prefix=f"cairn-promotion-{args.attempt}-"))
for name in ["source", "tmp", "cache", "bin", "raw"]:
    (work / name).mkdir(mode=0o700)
(work / "empty.npmrc").write_text("")
shim = work / "bin/npm"
shim.write_text("#!/bin/sh\nexec " + shlex.join([
    str(node), str(npm_cli), "--cache", str(work / "cache")
]) + ' "$@"\n')
shim.chmod(0o700)
env = {
    "PATH": f"{work / 'bin'}:{node.parent}:/usr/bin:/bin",
    "TMPDIR": str(work / "tmp"),
    "LANG": "C.UTF-8",
    "npm_config_cache": str(work / "cache"),
    "npm_config_userconfig": str(work / "empty.npmrc"),
    "npm_config_update_notifier": "false",
}
source = work / "source"
target = work / "installed"
replacements = [
    (str(work), "<attempt-root>"),
    (str(node.parent.parent), "<node-install>"),
    (str(repository), "<repository>"),
]


def sanitize(text):
    for original, placeholder in replacements:
        text = text.replace(original, placeholder)
    return text


report = {
    "schemaVersion": 1,
    "attempt": args.attempt,
    "operator": {
        "type": "AI agent",
        "role": "independent editorial reviewer, then installation verifier",
        "priorRuntimeImplementationContribution": False,
        "humanOperator": False,
        "readCodeDuringPreparation": True,
    },
    "startedAt": stamp(),
    "status": "running",
    "platform": {"os": os.uname().sysname, "architecture": os.uname().machine},
    "modelCalls": {"paidPathEnabled": False, "credentialEnvironmentForwarded": False,
                   "withRecall": False, "expectedRecallCode": "model_not_configured"},
    "isolation": {
        "separateSourceArchive": True, "targetExistedBeforeInstall": target.exists(),
        "npmCacheInitiallyEmpty": not any((work / "cache").iterdir()),
        "npmShimPurpose": "Pin Node/npm and pass --cache for nested installer npm commands only.",
        "temporaryArtifactsRetained": True,
    },
    "steps": [],
}
(work / "private-location.json").write_text(json.dumps({"work": str(work), "evidence": str(out)}))


def save():
    (out / "result.json").write_text(json.dumps(report, indent=2) + "\n")


def run(label, command, *, cwd=source, timeout=240):
    started = stamp()
    before = time.monotonic()
    try:
        result = subprocess.run(command, cwd=cwd, env=env, capture_output=True,
                                text=True, timeout=timeout, check=False)
        stdout, stderr, code = result.stdout, result.stderr, result.returncode
    except subprocess.TimeoutExpired as error:
        stdout = error.stdout or ""
        stderr = error.stderr or ""
        stdout = stdout.decode() if isinstance(stdout, bytes) else stdout
        stderr = stderr.decode() if isinstance(stderr, bytes) else stderr
        stderr += "\nVerification runner timeout; this attempt is retained as failed.\n"
        code = 124
    elapsed = round(time.monotonic() - before, 3)
    for stream, content in [("stdout", stdout), ("stderr", stderr)]:
        raw = work / "raw" / f"{label}.{stream}.txt"
        raw.write_text(content)
        raw.chmod(0o600)
        (out / f"{label}.{stream}.txt").write_text(sanitize(content))
    report["steps"].append({
        "name": label, "command": sanitize(shlex.join(command)),
        "startedAt": started, "durationSeconds": elapsed, "exitCode": code,
        "status": "passed" if code == 0 else "failed",
        "stdout": f"{label}.stdout.txt", "stderr": f"{label}.stderr.txt",
    })
    save()
    print(f"{args.attempt}: {label}: exit {code}, {elapsed}s", flush=True)
    if code:
        raise RuntimeError(f"step failed: {label}")
    return stdout


save()
try:
    report["sourceCommit"] = run("source-commit", ["git", "rev-parse", "HEAD"], cwd=repository).strip()
    report["nodeVersion"] = run("node-version", [str(node), "--version"]).strip()
    report["npmVersion"] = run("npm-version", ["npm", "--version"]).strip()
    report["nodeBinarySha256"] = digest(node)
    run("source-archive", ["git", "archive", "--format=tar", "HEAD", "--output", str(work / "source.tar")], cwd=repository)
    report["sourceArchiveSha256"] = digest(work / "source.tar")
    run("source-extract", ["tar", "-xf", str(work / "source.tar"), "-C", str(source)])
    report["isolation"]["sourceHadNodeModules"] = any(source.rglob("node_modules"))
    installer = run("install", ["npm", "run", "install:preview", "--", "--directory", str(target), "--owner", "local-user"])
    receipt = json.loads((target / "installation-receipt.json").read_text())
    (out / "installation-receipt.sanitized.json").write_text(sanitize(json.dumps(receipt, indent=2)) + "\n")
    report["artifact"] = {key: receipt["artifact"][key] for key in ["name", "version", "sha256"]}
    report["artifact"]["archiveHashMatchesReceipt"] = digest(Path(receipt["artifact"]["path"])) == receipt["artifact"]["sha256"]
    report["artifact"]["installedRuntimeFilesMatchSourceHashes"] = all(
        digest(target / "app/node_modules/cairn-memory-local-preview" / path) == expected
        for path, expected in receipt["artifact"]["sourceHashes"].items()
    )
    report["artifact"]["verifiedRuntimeFileCount"] = len(receipt["artifact"]["sourceHashes"])
    if not report["artifact"]["archiveHashMatchesReceipt"]:
        raise RuntimeError("artifact_archive_hash_mismatch")
    if not report["artifact"]["installedRuntimeFilesMatchSourceHashes"]:
        raise RuntimeError("installed_source_hash_mismatch")
    executable = target / "app/node_modules/.bin/cairn-memory"
    report["isolation"]["installationOpenedDatabase"] = Path(receipt["databasePath"]).exists()
    run("sdk-install", ["npm", "ci", "--prefix", "adapters/mcp"])
    walkthrough = json.loads(run("walkthrough", [str(node), "adapters/mcp/walkthrough.mjs", "--executable", str(executable)], timeout=150))
    report["walkthrough"] = {key: walkthrough[key] for key in ["status", "runtime", "withRecall", "stages"]}
    if walkthrough["status"] != "passed" or walkthrough["withRecall"]:
        raise RuntimeError("walkthrough acceptance failed")
    # A separate, explicitly labeled model-free loop preserves actual tool bodies.
    transcript = run("tool-transcript", [str(node), "adapters/mcp/demo-transcript.mjs", str(executable)], timeout=150)
    report["toolTranscript"] = {
        "file": "tool-transcript.stdout.txt", "separateLoopFromAssertionWalkthrough": True,
        "containsModelNotConfigured": '"code": "model_not_configured"' in transcript,
        "containsFreshProcess": "session B (fresh process)" in transcript,
        "fixture": "Tabs preference explicitly corrected to spaces; synthetic content only.",
    }
    report["status"] = "passed"
except Exception as error:
    report["status"] = "failed"
    report["failure"] = sanitize(str(error))
finally:
    report["finishedAt"] = stamp()
    report["totalStepDurationSeconds"] = round(sum(step["durationSeconds"] for step in report["steps"]), 3)
    report["readmeCommandDurationSeconds"] = round(sum(step["durationSeconds"] for step in report["steps"] if step["name"] in ["install", "sdk-install", "walkthrough"]), 3)
    save()
    print(json.dumps({"attempt": args.attempt, "status": report["status"], "workRoot": str(work),
                      "executable": str(target / "app/node_modules/.bin/cairn-memory")}), flush=True)
raise SystemExit(0 if report["status"] == "passed" else 1)
