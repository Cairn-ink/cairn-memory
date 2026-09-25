"""No-key actual-engine checks. Launched only through run.py's clean env."""

import hashlib
import importlib.metadata
import ipaddress
import json
import os
import re
import socket
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ENGINE_VERSION = "2.2.0"
ENGINE_COMMIT = "47a69e1e72dc562b6fdd49a9ef892229afc7508a"
# SHA-256 over sorted relative .py and oss_notices_config.json names, each
# followed by NUL and its SHA-256 bytes, from the official tag checkout.
ENGINE_TREE_DIGEST = "6884f0109e5ef418c58972e12b95e1a5480293a14b0f35ee3be6e2ef7d3a0fcd"
ENGINE_FILE_COUNT = 149


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def install_socket_denial():
    """Observe and reject non-loopback Python sockets before engine import.

    This is a synthetic process check, not an OS sandbox or a paid-run guard.
    """
    rejected = []
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex
    original_getaddrinfo = socket.getaddrinfo

    def allowed_address(address):
        if not isinstance(address, tuple):
            return True  # Unix-domain socket path, not an internet endpoint.
        try:
            return ipaddress.ip_address(address[0]).is_loopback
        except (ValueError, TypeError):
            return False

    def connect(sock, address):
        if not allowed_address(address):
            rejected.append(repr(address))
            raise OSError("synthetic preflight denied non-loopback socket")
        return original_connect(sock, address)

    def connect_ex(sock, address):
        if not allowed_address(address):
            rejected.append(repr(address))
            raise OSError("synthetic preflight denied non-loopback socket")
        return original_connect_ex(sock, address)

    def getaddrinfo(host, *args, **kwargs):
        try:
            allowed = ipaddress.ip_address(host).is_loopback
        except (ValueError, TypeError):
            allowed = host == "localhost"
        if not allowed:
            rejected.append(repr(host))
            raise OSError("synthetic preflight denied non-loopback DNS")
        return original_getaddrinfo(host, *args, **kwargs)

    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex
    socket.getaddrinfo = getaddrinfo
    return rejected


def install_write_audit(root):
    """Deny Python-audited filesystem writes outside this run's temp root."""
    rejected = []
    allowed = []
    special_sinks = []
    root = root.resolve()
    sys.dont_write_bytecode = True

    def check(path, event):
        if isinstance(path, int):
            return  # Audit cannot recover the pathname from an existing fd.
        resolved = Path(path).resolve()
        if resolved == Path("/dev/null"):
            special_sinks.append(event)
            return
        if not resolved.is_relative_to(root):
            rejected.append(event)
            raise PermissionError("synthetic preflight denied off-root file write")
        allowed.append(event)

    def audit(event, args):
        if event == "open":
            path, mode, flags = args
            writing = any(character in str(mode) for character in ("w", "a", "x", "+"))
            writing = writing or bool(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC))
            if writing:
                check(path, event)
        elif event in ("os.mkdir", "os.remove", "os.unlink", "os.rmdir", "os.truncate"):
            check(args[0], event)
        elif event in ("os.rename", "os.replace"):
            check(args[0], event)
            check(args[1], event)
        elif event == "sqlite3.connect":
            if args[0] != ":memory:":
                check(args[0], event)

    sys.addaudithook(audit)
    return rejected, allowed, special_sinks


def verify_distribution():
    lock = Path(__file__).with_name("requirements.lock").read_text()
    locked_versions = dict(re.findall(r"(?m)^([A-Za-z0-9_.-]+)==([^\s\\]+)", lock))
    require(len(locked_versions) == 34, "full dependency lock count changed")
    for name, version in locked_versions.items():
        require(importlib.metadata.version(name) == version, f"installed {name} differs from hash lock")
    distribution = importlib.metadata.distribution("mem0ai")
    require(distribution.version == ENGINE_VERSION, "installed Mem0 version differs from pin")
    package = Path(distribution.locate_file("mem0"))
    files = sorted(
        path for path in package.rglob("*")
        if path.is_file() and (path.suffix == ".py" or path.name == "oss_notices_config.json")
    )
    digest = hashlib.sha256()
    for path in files:
        digest.update(path.relative_to(package).as_posix().encode())
        digest.update(b"\0")
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    require(len(files) == ENGINE_FILE_COUNT, "installed Mem0 source-file count differs from tag")
    require(digest.hexdigest() == ENGINE_TREE_DIGEST, "installed Mem0 files differ from official tag")
    optional = {
        name: importlib.metadata.packages_distributions().get(name)
        for name in ("spacy", "fastembed", "cohere", "sentence_transformers")
    }
    require(all(value is None for value in optional.values()), "optional model/reranker dependency unexpectedly installed")
    return optional, locked_versions


class FakeState:
    def __init__(self):
        self.lock = threading.Lock()
        self.requests = []
        self.mode = "normal"
        self.extract_mode = "one"
        self.cap = None
        self.denied = 0

    def start_request(self, path, body):
        with self.lock:
            entry = {"path": path, "body": body, "mode": self.mode, "status": None}
            self.requests.append(entry)
            if self.cap is not None and len(self.requests) > self.cap:
                self.denied += 1
                entry["status"] = 429
                return entry, "cap"
            return entry, self.mode

    def set_mode(self, mode):
        with self.lock:
            self.mode = mode

    def entries(self, *, mode=None, path=None):
        with self.lock:
            return [
                entry for entry in self.requests
                if (mode is None or entry["mode"] == mode)
                and (path is None or entry["path"] == path)
            ]


def make_handler(state):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_args):
            pass

        def answer(self, status, payload):
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass  # The deliberate timeout closed this synthetic connection.

        def do_POST(self):
            size = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(size))
            entry, mode = state.start_request(self.path, body)
            if mode == "timeout":
                time.sleep(0.3)
            if mode in ("429", "cap"):
                entry["status"] = 429
                self.answer(429, {"error": {"message": "synthetic refusal", "type": "rate_limit_error"}})
                return
            if self.path == "/v1/embeddings":
                inputs = body["input"]
                if mode == "batch_fail" and len(inputs) > 1:
                    entry["status"] = 500
                    self.answer(500, {"error": {"message": "synthetic batch failure"}})
                    return
                vector = [1.0] + [0.0] * 1535
                entry["status"] = 200
                self.answer(200, {
                    "object": "list",
                    "data": [
                        {"object": "embedding", "index": index, "embedding": vector}
                        for index, _text in enumerate(inputs)
                    ],
                    "model": body["model"],
                    "usage": {"prompt_tokens": len(inputs), "total_tokens": len(inputs)},
                })
                return
            if self.path == "/v1/chat/completions":
                facts = [{"id": "0", "text": "The project mascot is a red fox.", "attributed_to": "user"}]
                if state.extract_mode == "two":
                    facts.append({"id": "1", "text": "The backup mascot is a green owl.", "attributed_to": "assistant"})
                entry["status"] = 200
                self.answer(200, {
                    "id": "chatcmpl-synthetic",
                    "object": "chat.completion",
                    "created": 0,
                    "model": body["model"],
                    "choices": [{
                        "index": 0,
                        "finish_reason": "stop",
                        "message": {"role": "assistant", "content": json.dumps({"memory": facts})},
                    }],
                    "usage": {"prompt_tokens": 5, "completion_tokens": 5, "total_tokens": 10},
                })
                return
            entry["status"] = 404
            self.answer(404, {"error": {"message": "unrecognized synthetic path"}})

    return Handler


def make_memory(Memory, root, name, endpoint):
    return Memory.from_config({
        "vector_store": {"provider": "qdrant", "config": {
            "path": str(root / f"{name}-qdrant"),
            "collection_name": f"{name}_memories",
            "embedding_model_dims": 1536,
        }},
        "history_db_path": str(root / f"{name}-history.db"),
        "llm": {"provider": "openai", "config": {
            "model": "gpt-5-mini", "api_key": "synthetic-no-key", "openai_base_url": endpoint,
        }},
        "embedder": {"provider": "openai", "config": {
            "model": "text-embedding-3-small", "api_key": "synthetic-no-key",
            "openai_base_url": endpoint,
        }},
    })


def disk_bytes(path):
    path = Path(path)
    if path.is_file():
        return path.stat().st_size
    return sum(file.stat().st_size for file in path.rglob("*") if file.is_file())


def main(root):
    root = Path(root)
    require(set(os.environ) == {
        "MEM0_DIR", "MEM0_TELEMETRY", "OPENAI_API_KEY", "PYTHONNOUSERSITE",
        "XDG_CACHE_HOME", "TMPDIR", "LC_ALL",
    }, "child environment was not the explicit allowlist")
    require(os.environ["OPENAI_API_KEY"] == "synthetic-no-key", "non-synthetic key")
    rejected_writes, allowed_writes, special_sinks = install_write_audit(root)
    try:
        with open(root.with_name(root.name + "-denied-probe"), "w"):
            pass
    except PermissionError:
        pass
    require(len(rejected_writes) == 1, "off-root file-write denial was not observed")
    rejected = install_socket_denial()
    try:
        with socket.socket() as probe:
            probe.connect(("198.51.100.7", 443))
    except OSError:
        pass
    require(len(rejected) == 1, "non-loopback socket denial was not observed")
    optional, locked_versions = verify_distribution()

    # Import only after env isolation and the socket guard are active.
    from mem0 import Memory
    from mem0.configs.base import MemoryConfig

    defaults = MemoryConfig()
    require(defaults.vector_store.provider == "qdrant", "vector store default changed")
    require(defaults.vector_store.config.path == "/tmp/qdrant", "default Qdrant path changed")
    require(defaults.llm.provider == "openai", "LLM provider default changed")
    require(defaults.embedder.provider == "openai", "embedder provider default changed")
    require(defaults.reranker is None, "default reranker changed")

    state = FakeState()
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(state))
    server.daemon_threads = True
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    endpoint = f"http://127.0.0.1:{server.server_port}/v1"
    try:
        first = make_memory(Memory, root, "first", endpoint)
        second = make_memory(Memory, root, "second", endpoint)
        default_retries = {
            "llm": first.llm.client.max_retries,
            "embedder": first.embedding_model.client.max_retries,
        }
        require(default_retries == {"llm": 2, "embedder": 2}, "SDK default retries changed")
        for memory in (first, second):
            for provider in (memory.llm, memory.embedding_model):
                require(str(provider.client.base_url) == endpoint + "/", "provider escaped fake endpoint")
                provider.client = provider.client.with_options(max_retries=0, timeout=5.0)
                require(provider.client.max_retries == 0, "controlled retry disable failed")

        cutoff = "2024-01-02T00:00:00+00:00"
        events = [
            {"role": "user", "content": "The project mascot is a red fox.", "at": "2024-01-01T10:00:00+00:00", "source_id": "u1"},
            {"role": "assistant", "content": "I will remember the red fox.", "at": "2024-01-01T10:01:00+00:00", "source_id": "a1"},
            {"role": "user", "content": "POST_CUTOFF_SENTINEL: switch to a black cat.", "at": "2024-01-03T10:00:00+00:00", "source_id": "u2"},
        ]
        accepted = [event for event in events if event["at"] <= cutoff]
        require([event["source_id"] for event in accepted] == ["u1", "a1"], "cutoff selection failed")
        result = first.add(
            [{"role": event["role"], "content": event["content"]} for event in accepted],
            user_id="alpha",
            metadata={"source_ids": [event["source_id"] for event in accepted], "source_time": accepted[-1]["at"]},
        )
        require(len(result["results"]) == 1, "default inferred add did not persist the synthetic fact")
        chats = state.entries(path="/v1/chat/completions")
        require(len(chats) == 1, "expected one actual-engine extraction request")
        extraction_prompt = chats[0]["body"]["messages"][1]["content"]
        require(extraction_prompt.index("user: The project mascot") < extraction_prompt.index("assistant: I will remember"), "role order lost")
        require("POST_CUTOFF_SENTINEL" not in extraction_prompt, "post-cutoff turn leaked to extraction")
        today = datetime.now(timezone.utc).date().isoformat()
        require(f"## Observation Date\n{today}" in extraction_prompt, "observation date was not run date")
        require(f"## Current Date\n{today}" in extraction_prompt, "current date was not run date")

        first.add("The beta mascot is a blue whale.", user_id="beta", infer=False)
        second.add("The other store has a bronze turtle.", user_id="gamma", infer=False)
        alpha = first.search("What is the mascot?", filters={"user_id": "alpha"}, top_k=5, threshold=0.0)
        beta = first.search("What is the mascot?", filters={"user_id": "beta"}, top_k=5, threshold=0.0)
        isolated = second.search("What is the mascot?", filters={"user_id": "alpha"}, top_k=5, threshold=0.0)
        require([x["memory"] for x in alpha["results"]] == ["The project mascot is a red fox."], "alpha evidence or filter mismatch")
        require([x["memory"] for x in beta["results"]] == ["The beta mascot is a blue whale."], "beta namespace mismatch")
        require(isolated["results"] == [], "separate store leaked evidence")
        evidence = alpha["results"][0]
        require(evidence["metadata"]["source_ids"] == ["u1", "a1"], "call-level source metadata missing")
        require(evidence["metadata"]["source_time"] == accepted[-1]["at"], "source time metadata missing")
        require("source_span" not in evidence and "source_span" not in evidence["metadata"], "unexpected source-span field")
        require(evidence["attributed_to"] == "user", "inferred attribution not returned")
        require(all("POST_CUTOFF_SENTINEL" not in json.dumps(entry["body"]) for entry in state.entries()), "post-cutoff sentinel was sent")
        require(str(root) in str(first.config.history_db_path), "history path escaped temporary root")
        require(str(root) in str(first.config.vector_store.config.path), "Qdrant path escaped temporary root")

        temporal_errors = {}
        for name, action in (
            ("add_timestamp", lambda: first.add("synthetic", user_id="alpha", timestamp=cutoff)),
            ("search_reference_date", lambda: first.search("synthetic", filters={"user_id": "alpha"}, reference_date=cutoff)),
        ):
            try:
                action()
            except ValueError as error:
                temporal_errors[name] = str(error)
            else:
                raise AssertionError(f"{name} unexpectedly accepted by OSS engine")
        require(all("not supported" in text.lower() for text in temporal_errors.values()), "temporal rejection changed")

        state.set_mode("429")
        try:
            first.search("synthetic rate limit", filters={"user_id": "alpha"})
        except Exception as error:
            rate_error = type(error).__name__
        else:
            raise AssertionError("429 did not surface as failure")
        require(len(state.entries(mode="429")) == 1, "controlled 429 retried or escaped accounting")

        state.set_mode("timeout")
        first.embedding_model.client = first.embedding_model.client.with_options(timeout=0.1)
        try:
            first.search("synthetic timeout", filters={"user_id": "alpha"})
        except Exception as error:
            timeout_error = type(error).__name__
        else:
            raise AssertionError("timeout did not surface as failure")
        require(len(state.entries(mode="timeout")) == 1, "controlled timeout retried or escaped accounting")
        first.embedding_model.client = first.embedding_model.client.with_options(timeout=5.0)

        state.set_mode("batch_fail")
        state.extract_mode = "two"
        batch_result = second.add(
            [{"role": "user", "content": "Record two synthetic mascot facts."}],
            user_id="delta",
        )
        require(len(batch_result["results"]) == 2, "batch fallback did not persist both facts")
        batch_embeddings = state.entries(mode="batch_fail", path="/v1/embeddings")
        batch_lengths = [len(entry["body"]["input"]) for entry in batch_embeddings]
        require(batch_lengths == [1, 2, 1, 1], f"batch-to-individual attempt sequence changed: {batch_lengths}")
        require([entry["status"] for entry in batch_embeddings] == [200, 500, 200, 200], "batch fallback statuses changed")

        state.set_mode("normal")
        with state.lock:
            state.cap = len(state.requests)
        try:
            first.search("synthetic cap", filters={"user_id": "alpha"})
        except Exception as error:
            cap_error = type(error).__name__
        else:
            raise AssertionError("local request cap did not refuse further work")
        require(state.denied == 1, "local cap denial count changed")
        require(len(state.entries()) == state.cap + 1, "local cap allowed additional attempts")
        require(len(rejected) == 1, "engine attempted a non-loopback connection")
        require(len(rejected_writes) == 1, "engine attempted an off-root Python-audited write")
        require(allowed_writes, "no temporary writes were observed by the audit hook")

        return {
            "engine": f"mem0ai {ENGINE_VERSION}",
            "commit": ENGINE_COMMIT,
            "installed_tree_sha256": ENGINE_TREE_DIGEST,
            "locked_dependency_count": len(locked_versions),
            "installed_openai_sdk": locked_versions["openai"],
            "python": sys.version.split()[0],
            "optional_providers_absent": sorted(optional),
            "config_defaults": {
                "vector_store": defaults.vector_store.provider,
                "vector_path": defaults.vector_store.config.path,
                "llm_provider": defaults.llm.provider,
                "embedder_provider": defaults.embedder.provider,
                "reranker": defaults.reranker,
            },
            "default_sdk_retries": default_retries,
            "controlled_sdk_retries": 0,
            "requests_observed": len(state.entries()),
            "rate_limit_attempts": len(state.entries(mode="429")),
            "timeout_attempts": len(state.entries(mode="timeout")),
            "batch_embedding_attempt_sizes": batch_lengths,
            "local_cap_denials": state.denied,
            "synthetic_socket_denials": len(rejected),
            "synthetic_off_root_write_denials": len(rejected_writes),
            "temporary_write_events": len(allowed_writes),
            "dev_null_write_events": len(special_sinks),
            "temporal_errors": temporal_errors,
            "retrieved_evidence_fields": sorted(evidence),
            "observation_date": today,
            "source_date": accepted[-1]["at"],
            "bm25_encoder_available": first.vector_store._get_bm25_encoder() is not None,
            "reranker_configured": first.reranker is not None,
            "local_store_bytes": {
                "first_qdrant": disk_bytes(first.config.vector_store.config.path),
                "first_sqlite": disk_bytes(first.config.history_db_path),
                "second_qdrant": disk_bytes(second.config.vector_store.config.path),
                "second_sqlite": disk_bytes(second.config.history_db_path),
                "mem0_config": disk_bytes(os.environ["MEM0_DIR"]),
            },
        }
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    print(json.dumps(main(sys.argv[1]), sort_keys=True))
