"""Offline authoring/check of cl100k_base counts; socket creation is forbidden.

Requires an already installed tiktoken and cached cl100k_base vocabulary.
No installation/download is attempted. Text never goes to stdout.
"""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import sys


def audit(event, args):
    if event in {"socket.connect", "socket.getaddrinfo", "socket.sendto"}:
        raise RuntimeError("offline_tokenizer_cache_required")


sys.addaudithook(audit)
import tiktoken  # noqa: E402
import tiktoken.load  # noqa: E402


def cached_only(path):
    # read_file_cached invokes read_file only on a cache miss.
    if "://" in path:
        raise RuntimeError("offline_tokenizer_cache_required")
    return Path(path).read_bytes()


tiktoken.load.read_file = cached_only

root = Path(__file__).resolve().parents[2] / "evaluation/context-read-p2e/fixtures"
fixture = json.loads((root / "corpus-queries.json").read_text())
safety = json.loads((root / "safety.json").read_text())
encoder = tiktoken.get_encoding("cl100k_base")
vocabulary = hashlib.sha256()
for token, rank in sorted(encoder._mergeable_ranks.items()):
    vocabulary.update(len(token).to_bytes(4, "big") + token + rank.to_bytes(4, "big"))
texts = ([d["text"] for d in fixture["documents"]] + [q["text"] for q in fixture["queries"]]
         + [d["text"] for d in safety["canaries"]] + [safety["query"]])
counts = {hashlib.sha256(text.encode()).hexdigest(): len(encoder.encode(text, disallowed_special=())) for text in texts}
result = {"counter": "cl100k_base", "package": f"tiktoken@{importlib.metadata.version('tiktoken')}",
          "vocabularySha256": vocabulary.hexdigest(), "counts": dict(sorted(counts.items()))}
data = json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n"
target = root / "tokens.json"
if sys.argv[1:] == ["--write"]:
    target.write_text(data)
elif sys.argv[1:] == ["--verify"]:
    if target.read_text() != data:
        raise RuntimeError("token_count_mismatch")
else:
    raise RuntimeError("require_write_or_verify")
print(json.dumps({"counter": result["counter"], "uniqueInputs": len(counts), "status": "verified"}))
