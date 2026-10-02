#!/usr/bin/env python3
"""Save an append-only GitHub traffic snapshot using an existing gh login."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import sys


def command(args):
    result = subprocess.run(args, text=True, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError(result.stderr.strip()[:1200] or f"exit {result.returncode}")
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default="Cairn-ink/cairn-memory")
    parser.add_argument("--out", type=Path, default=Path("docs/promotion/metrics"))
    parser.add_argument("--phase", choices=["preparation", "campaign", "followup"], default="preparation")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repo):
        parser.error("--repo must be owner/name")

    started = datetime.now(timezone.utc)
    try:
        commit = command(["git", "rev-parse", "HEAD"]).strip()
        dirty = bool(command(["git", "status", "--porcelain"]).strip())
    except (OSError, RuntimeError, subprocess.TimeoutExpired):
        commit, dirty = None, None
    target = args.out / started.strftime("%Y%m%dT%H%M%S.%fZ")
    target.mkdir(parents=True, exist_ok=False)
    endpoints = {
        "repository": f"repos/{args.repo}",
        "views": f"repos/{args.repo}/traffic/views?per=day",
        "clones": f"repos/{args.repo}/traffic/clones?per=day",
        "referrers": f"repos/{args.repo}/traffic/popular/referrers",
    }

    def collect(item):
        name, endpoint = item
        try:
            value = json.loads(command(["gh", "api", "--method", "GET", endpoint]))
            if name == "repository":
                keys = ["full_name", "html_url", "stargazers_count", "forks_count", "open_issues_count", "default_branch", "topics", "pushed_at"]
                value = {key: value.get(key) for key in keys}
            (target / f"{name}.json").write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
            return name, value, None
        except (OSError, RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
            return name, None, str(error)

    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(collect, endpoints.items()))
    data = {name: value for name, value, error in results if error is None}
    errors = {name: error for name, value, error in results if error is not None}
    summary = {
        "started_at_utc": started.isoformat(),
        "completed_at_utc": datetime.now(timezone.utc).isoformat(),
        "repo": args.repo,
        "phase": args.phase,
        "local_commit": commit,
        "local_worktree_dirty": dirty,
        "stars": data.get("repository", {}).get("stargazers_count"),
        "errors": errors,
        "notes": [
            "Preparation snapshots do not start the campaign or establish publication.",
            "API uniques describe the whole returned window; do not sum daily uniques.",
            "Referrers do not establish per-channel star attribution; clones do not establish installs.",
            "Collection and installer activity may affect traffic counts.",
        ],
    }
    for name in ["views", "clones"]:
        value = data.get(name)
        if value is not None:
            days = value.get(name, [])
            summary[name] = {
                "count": value.get("count"),
                "whole_window_uniques": value.get("uniques"),
                "returned_dates_utc": [row["timestamp"] for row in days],
            }
    (target / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"snapshot": str(target), "stars": summary["stars"], "phase": args.phase, "errors": errors}, ensure_ascii=False))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
