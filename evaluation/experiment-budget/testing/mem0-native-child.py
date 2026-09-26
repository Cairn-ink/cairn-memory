"""Contained, single-case Mem0 2.2.0 worker. No provider credentials or network fallback."""

import json
import os
import sys

MAX_INPUT = 8 * 1024 * 1024
MAX_ENVELOPE = MAX_INPUT + 2048
MAX_OUTPUT = 2 * 1024 * 1024
VERSION = "cairn-mem0-native-result-v1"
LOCAL_BASE_URL = "http://unix-gateway/v1"


def abort(code):
    raise ValueError(code)


def bounded_text(value, maximum, allow_empty=False):
    if not isinstance(value, str) or (not allow_empty and not value):
        abort("invalid_native_output")
    try:
        units = len(value.encode("utf-16-le", "strict")) // 2
    except UnicodeError:
        abort("invalid_native_output")
    if units > maximum:
        abort("invalid_native_output")
    return value


def record_content(value):
    if not isinstance(value, dict):
        abort("invalid_native_output")
    return bounded_text(value.get("memory"), 65536)


def run(case):
    # This private protocol is supplied only by the trusted parent. The child
    # cannot select its identity, roots, provider endpoint, or ledger authority.
    if not isinstance(case, dict) or set(case) != {
        "version", "socket", "store", "userId", "topK", "threshold", "httpTimeoutMs", "input"
    } or case["version"] != "cairn-mem0-native-child-input-v1":
        abort("invalid_native_input")
    socket = bounded_text(case["socket"], 512)
    store = bounded_text(case["store"], 512)
    user_id = bounded_text(case["userId"], 200)
    if not socket.startswith("/case/") or not store.startswith("/case/"):
        abort("invalid_native_input")
    if not isinstance(case["topK"], int) or not 1 <= case["topK"] <= 100:
        abort("invalid_native_input")
    if not isinstance(case["threshold"], (int, float)) or not 0 <= case["threshold"] <= 1:
        abort("invalid_native_input")
    if not isinstance(case["httpTimeoutMs"], int) or not 1 <= case["httpTimeoutMs"] <= 3600000:
        abort("invalid_native_input")
    value = case["input"]
    if not isinstance(value, dict) or set(value) != {"batches", "query"}:
        abort("invalid_native_input")

    # Import after MEM0_DIR and all cache roots were set by the isolated parent
    # environment. The only writable paths are private to this one case.
    import httpx
    from mem0 import Memory

    config = {
        "version": "v1.1",
        "vector_store": {"provider": "qdrant", "config": {
            "collection_name": "mem0", "embedding_model_dims": 1536,
            "path": os.path.join(store, "qdrant")}},
        "history_db_path": os.path.join(store, "history.db"),
        "llm": {"provider": "openai", "config": {
            "model": "gpt-4.1-mini-2025-04-14", "api_key": "local-only-dummy-key",
            "max_tokens": 2000, "temperature": 0.1, "top_p": 0.1,
            "enable_vision": False, "store": False,
            "openai_base_url": LOCAL_BASE_URL}},
        "embedder": {"provider": "openai", "config": {
            "model": "text-embedding-3-small", "api_key": "local-only-dummy-key",
            "embedding_dims": 1536, "openai_base_url": LOCAL_BASE_URL}},
        "reranker": None,
    }
    memory = Memory.from_config(config)
    client = httpx.Client(transport=httpx.HTTPTransport(uds=socket, retries=0, trust_env=False),
                          trust_env=False, timeout=case["httpTimeoutMs"] / 1000)
    memory.llm.client = memory.llm.client.with_options(
        http_client=client, max_retries=0, timeout=case["httpTimeoutMs"] / 1000)
    memory.embedding_model.client = memory.embedding_model.client.with_options(
        http_client=client, max_retries=0, timeout=case["httpTimeoutMs"] / 1000)
    verified = 0
    try:
        for batch in value["batches"]:
            outcome = memory.add(batch, user_id=user_id, infer=True)
            if not isinstance(outcome, dict) or not isinstance(outcome.get("results"), list):
                abort("invalid_native_add")
            if len(outcome["results"]) > 256:
                abort("invalid_native_add")
            for record in outcome["results"]:
                if not isinstance(record, dict):
                    abort("invalid_native_add")
                if record.get("event") != "ADD":
                    continue
                identifier = bounded_text(record.get("id"), 200)
                content = record_content(record)
                persisted = memory.get(identifier)
                if not isinstance(persisted, dict) or persisted.get("id") != identifier \
                        or record_content(persisted) != content:
                    abort("unpersisted_native_add")
                verified += 1
        found = memory.search(value["query"], filters={"user_id": user_id},
                              top_k=case["topK"], threshold=case["threshold"],
                              rerank=False, explain=False, show_expired=False)
        if not isinstance(found, dict) or not isinstance(found.get("results"), list) \
                or len(found["results"]) > case["topK"]:
            abort("invalid_native_search")
        projected = []
        for item in found["results"]:
            if not isinstance(item, dict):
                abort("invalid_native_search")
            score = item.get("score")
            if not isinstance(score, (int, float)) or isinstance(score, bool) \
                    or not float("-inf") < score < float("inf"):
                abort("invalid_native_search")
            attribution = item.get("attributed_to")
            if attribution is not None:
                bounded_text(attribution, 200, allow_empty=True)
            projected.append({"id": bounded_text(item.get("id"), 200),
                              "memory": record_content(item), "score": score,
                              "attributedTo": attribution})
        return {"version": VERSION, "verifiedAddRecords": verified, "results": projected}
    finally:
        client.close()


def main():
    protocol = os.fdopen(os.dup(1), "w", encoding="utf-8", closefd=True)
    with open(os.devnull, "w") as sink:
        os.dup2(sink.fileno(), 1)
        os.dup2(sink.fileno(), 2)
    try:
        raw = sys.stdin.buffer.read(MAX_ENVELOPE + 1)
        if len(raw) > MAX_ENVELOPE:
            abort("invalid_native_input")
        value = run(json.loads(raw.decode("utf-8", "strict")))
    except BaseException:
        value = {"version": VERSION, "status": "error", "code": "native_failed"}
    encoded = json.dumps(value, ensure_ascii=False, allow_nan=False,
                         separators=(",", ":")).encode("utf-8", "strict")
    if len(encoded) > MAX_OUTPUT:
        encoded = json.dumps({"version": VERSION, "status": "error",
                              "code": "native_output_exceeded"}).encode()
    protocol.write(encoded.decode("utf-8", "strict"))
    protocol.flush()


if __name__ == "__main__":
    main()
