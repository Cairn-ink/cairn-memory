# Mem0 OSS actual-engine synthetic preflight

This maintainer-only packet exercises the real Python `Memory.add` and
`Memory.search` methods with synthetic turns, fake loopback HTTP and temporary
local stores. It does not answer or judge benchmark questions and provides no
competitor accuracy, cost or parity result. The frozen acceptance contract is
[the preflight plan](plans/mem0-engine-preflight.md).

## Reproduce without a provider key

Use Python 3.11 and `uv`; install only into a new temporary virtual environment.
These preparation commands may fetch public package artifacts. The test command
itself performs no installation or model-asset download.

```sh
MEM0_PREFLIGHT_DIR=$(mktemp -d /tmp/cairn-mem0-preflight.XXXXXX)
uv venv --python 3.11 --no-python-downloads "$MEM0_PREFLIGHT_DIR/venv"
uv pip sync --python "$MEM0_PREFLIGHT_DIR/venv/bin/python" --require-hashes --strict evaluation/comparators/mem0-preflight/requirements.lock
"$MEM0_PREFLIGHT_DIR/venv/bin/python" evaluation/comparators/mem0-preflight/run.py
```

The [input pin](../evaluation/comparators/mem0-preflight/requirements.in) is
`mem0ai==2.2.0`. The [hash lock](../evaluation/comparators/mem0-preflight/requirements.lock)
resolves 34 packages for Python 3.11, including OpenAI SDK 3.19.2,
Qdrant client 1.19.1 and PostHog 7.60.0. The official
[`v2.2.0` tag ref](https://api.github.com/repos/mem0ai/mem0/git/refs/tags/v2.2.0)
resolves to commit `47a69e1e72dc562b6fdd49a9ef892229afc7508a`.
The preflight checks installed distribution version and the SHA-256 tree
fingerprint of all 149 packaged Python/config files against that tag, and
compares all 34 installed dependency versions with the hash lock. During
preparation, a temporary official tag checkout and the installed wheel had
matching files except source-only `AGENTS.md` and `CLAUDE.md`. The engine's
[package manifest](https://github.com/mem0ai/mem0/blob/47a69e1e72dc562b6fdd49a9ef892229afc7508a/pyproject.toml)
declares Apache-2.0 and Python ≥3.10; this lock deliberately narrows the
reproduction to Python 3.11. No optional spaCy, FastEmbed or reranker package
is installed.

In this Linux environment the virtual environment occupied 149 MiB (`du -sh`),
with 139,116,242 bytes in `site-packages`; the Mem0 package tree occupied
2,084,155 bytes. These installed-tree measurements include 13,141,486 bytes of
Python bytecode cache across `site-packages` (720,927 bytes under Mem0) generated
by earlier local probes. They are not a package download size or a Cairn
comparison. The separate official tag
checkout occupied 57 MiB and was used only to verify source identity. `uv`'s
download/wheel cache and the interpreter installation are outside those
figures. No Python test framework was added; this packet uses the standard
library. Temporary stores are measured separately below. These observations
do not establish a relative lightweight advantage for either engine.

The wrapper constructs an explicit child environment containing only temporary
`MEM0_DIR`, `XDG_CACHE_HOME` and `TMPDIR`, `MEM0_TELEMETRY=False`, a dummy
`OPENAI_API_KEY`, locale and Python user-site control. It starts the child with
`-I`. Before importing Mem0, the child patches Python socket connection and
DNS entry points to reject non-loopback destinations and proves one deliberate
denial. It also disables bytecode writes and audits Python writable opens and
filesystem mutations, allowing only its temporary root and the exact
`/dev/null` sink. A deliberate off-root write attempt is refused; in the sample
run 30 temporary write events and one `/dev/null` write were observed, with no
other denied off-root write. Both Mem0 OpenAI clients are configured to one fake loopback server;
the child asserts their effective base URLs. Qdrant paths and SQLite history
paths are explicit and separate for two stores. This interception observes
Python-audited calls in the tested process; native code or previously open
descriptors are outside that proof. It is not an OS sandbox, a complete
outbound or user-path-write proof for future executions, or the shared paid
request/cost ledger. See Mem0's
[telemetry setup](https://github.com/mem0ai/mem0/blob/47a69e1e72dc562b6fdd49a9ef892229afc7508a/mem0/memory/telemetry.py),
[local setup](https://github.com/mem0ai/mem0/blob/47a69e1e72dc562b6fdd49a9ef892229afc7508a/mem0/memory/setup.py)
and [configuration defaults](https://github.com/mem0ai/mem0/blob/47a69e1e72dc562b6fdd49a9ef892229afc7508a/mem0/configs/base.py).

## Observed engine behavior

The child fed two ordered, dated user/assistant turns to default inferred
`add`, excluding a later sentinel at a fixed question cutoff. The fake LLM
request contained the turns in role order and omitted the sentinel. Its
`Observation Date` and `Current Date` were the run date, not the supplied
2024 source date. The engine returned one synthetic inferred memory; subsequent
`search` returned a memory, score, timestamps, user scope, attribution and
call-level metadata. The `source_ids` and `source_time` in that metadata were
provided by this harness, not generated source-span receipts. A second user in
the same store and another separate store did not leak into the first user's
results. OSS `add(timestamp=...)` and `search(reference_date=...)` both raised
explicit unsupported-parameter errors. The actual
[add/search implementation](https://github.com/mem0ai/mem0/blob/47a69e1e72dc562b6fdd49a9ef892229afc7508a/mem0/memory/main.py)
uses [role-prefixed message flattening](https://github.com/mem0ai/mem0/blob/47a69e1e72dc562b6fdd49a9ef892229afc7508a/mem0/memory/utils.py)
and [run-date prompt defaults](https://github.com/mem0ai/mem0/blob/47a69e1e72dc562b6fdd49a9ef892229afc7508a/mem0/configs/prompts.py).
One batch also confirmed `infer=True` can fall back from a failed two-input
embedding request to two individual requests.

The default/controlled distinction matters:

| Aspect | Framework default at this pin | Synthetic controlled check |
| --- | --- | --- |
| Models | OpenAI `gpt-5-mini` extraction and `text-embedding-3-small`/1536 embeddings | Same names, but all responses came from fake HTTP |
| Local stores | Qdrant `/tmp/qdrant`, SQLite under `MEM0_DIR` or `~/.mem0` | Two explicit Qdrant/SQLite paths under one temporary root |
| Retrieval | `top_k=20`, threshold `0.1`; no reranker | Explicit `top_k=5`, threshold `0` for evidence-shape checks |
| Retry | Both installed OpenAI SDK clients report two default retries | Both clients set to zero; ordinary local calls use a five-second timeout, and only the deliberate timeout probe uses 0.1 seconds |
| Optional search | FastEmbed BM25 and spaCy English entity processing are absent from the base lock | BM25 encoder unavailable; no reranker configured |

The [Qdrant implementation](https://github.com/mem0ai/mem0/blob/47a69e1e72dc562b6fdd49a9ef892229afc7508a/mem0/vector_stores/qdrant.py)
has optional BM25 encoding; [spaCy loading](https://github.com/mem0ai/mem0/blob/47a69e1e72dc562b6fdd49a9ef892229afc7508a/mem0/utils/spacy_models.py)
can download an English model if spaCy is installed without the asset. Those
choices and model assets require a separate frozen decision before any scored
comparison. The fake server observed 16 requests total in the sample run:
one controlled 429, one controlled timeout, and embedding request sizes
`1, 2, 1, 1` across a failed batch and its fallback. A local request cap
refused its next request once. Default retries were inspected without running
the retry sequence or spending against a provider.
After these tiny synthetic operations, the first Qdrant/SQLite store occupied
45,658/20,480 bytes and the second occupied 62,043/20,480 bytes; Mem0's
temporary config occupied 57 bytes. The wrapper removes those stores on exit.
These single-run byte counts are not a growth profile or steady-state resource
comparison.

## What remains before S3

This synthetic inferred-add check returned one fact; it did not evaluate
update/delete quality. Its attribution was a role, not an exact source passage.
A fair historical comparison still needs a frozen
timestamp representation/replay strategy and equivalent evidence packing for
both arms. `search` returns memories rather than generated answers, so a later
harness can supply the same external answering prompt/model and scorer, while
charging their requests to both arms. It also needs a complete outbound closure and shared durable paid
guard that reserves and accounts every LLM, embedding and optional rerank HTTP
attempt, including SDK retries and engine fallback calls; embedding price and
usage accounting are not established by this fake server. Freeze model/version,
embedding dimensions, BM25/reranker availability, independent stores, local
resource limits, balanced arm order, scorer and fixed-N failure accounting before
any held-out scoring. The later live-smoke and S1 gates remain independent.
