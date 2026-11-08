"""Loopback regressions for resolver cancellation, setup closure and REST recall."""

import json
import socket
import threading
import time

import pytest


def wait_until(predicate, deadline):
    while not predicate() and time.monotonic() < deadline:
        time.sleep(0.005)
    assert predicate()


def resolver_profile(install, cloud):
    home, provider, _, hosted = install(configured=False)
    endpoint = cloud.endpoint.replace("127.0.0.1", "localhost")
    provider.save_config({"mode": "hosted", "api_endpoint": endpoint,
                          "prefetch_timeout_ms": "250"}, str(home))
    hosted.write_credential(home, {"endpoint": endpoint, "token": "synthetic-memory-token",
                                  "token_id": "synthetic-token-id", "expires_at": None})
    provider.initialize("conversation", hermes_home=str(home), platform="cli", agent_context="primary")
    return provider, hosted, endpoint


def slow_resolver(monkeypatch):
    original = socket.getaddrinfo
    calls = []
    entered = threading.Event()
    finished = threading.Event()

    def resolve(host, port, *args, **kwargs):
        assert host in ("localhost", b"localhost")
        calls.append(time.monotonic())
        entered.set()
        try:
            time.sleep(2)
            return original("127.0.0.1", port, *args, **kwargs)
        finally:
            finished.set()

    monkeypatch.setattr(socket, "getaddrinfo", resolve)
    return entered, finished, calls


@pytest.mark.parametrize("operation", ["prefetch", "initialize", "tools/call", "credential"])
def test_resolver_deadline_and_prefetch_guard(install, cloud, monkeypatch, operation):
    provider, hosted, endpoint = resolver_profile(install, cloud)
    if operation == "tools/call":
        # Warm protocol state without opening a connection, so tools/call resolves too.
        provider._hosted._mcp_initialized = True
    monkeypatch.setattr(hosted, "REQUEST_TIMEOUT_SECONDS", 0.25)
    entered, finished, calls = slow_resolver(monkeypatch)
    started = time.monotonic()
    try:
        if operation == "prefetch":
            assert provider.prefetch("Synthetic first", session_id="conversation") == ""
            caller = time.monotonic() - started
            wait_until(lambda: not provider._hosted._inflight, started + 1.25)
            released = time.monotonic() - started
            print(f"resolver prefetch caller={caller:.3f}s guard={released:.3f}s")
            assert caller < 0.65
            assert released < 1.25
            assert provider.prefetch("Synthetic second", session_id="conversation") == ""
            wait_until(lambda: len(calls) == 2, time.monotonic() + 0.3)
        elif operation == "credential":
            value, message = hosted.check_credential(endpoint, "synthetic-memory-token")
            elapsed = time.monotonic() - started
            print(f"resolver credential caller={elapsed:.3f}s")
            assert value is None and "transport failure" in message
            assert elapsed < 0.65
        else:
            result = json.loads(provider.handle_tool_call("cairn_remember_memory", {"content": "Synthetic note"}))
            elapsed = time.monotonic() - started
            print(f"resolver {operation} caller={elapsed:.3f}s")
            assert result == {"ok": False, "error": {"code": "cairn_transport_failed", "retryable": True}}
            assert elapsed < 0.65
        assert entered.is_set()
    finally:
        provider.shutdown()
        assert finished.wait(3)


def test_shared_client_reuses_connection(install, cloud):
    _, provider, _, _ = install(cap="3000")
    assert provider.prefetch("Synthetic first", session_id="conversation")
    assert provider.prefetch("Synthetic second", session_id="conversation")
    print(f"sequential recalls connections={cloud.connections}")
    assert len(cloud.requests_for("/api/memory/recall")) == 2
    assert cloud.connections == 1


def test_shutdown_with_stalled_resolver(install, cloud, monkeypatch):
    provider, _, _ = resolver_profile(install, cloud)
    entered, finished, _ = slow_resolver(monkeypatch)
    caller = threading.Thread(target=lambda: provider.prefetch("Synthetic first", session_id="conversation"))
    caller.start()
    assert entered.wait(1)
    started = time.monotonic()
    try:
        provider.shutdown()
        elapsed = time.monotonic() - started
        print(f"resolver shutdown={elapsed:.3f}s")
        assert elapsed < 1.5
        caller.join(0.5)
        assert not caller.is_alive()
        wait_until(lambda: not provider._hosted._inflight, time.monotonic() + 0.3)
        assert provider.prefetch("Synthetic after shutdown") == ""
        assert not json.loads(provider.handle_tool_call("cairn_remember_memory", {"content": "Synthetic note"}))["ok"]
        assert not cloud.requests
    finally:
        assert finished.wait(3)
        caller.join(3)


@pytest.mark.parametrize("selected", [False, True])
def test_closed_setup_has_no_side_effects(install, cloud, monkeypatch, capsys, selected):
    home, provider, _, hosted = install(configured=False)
    if selected:
        provider.save_config({"mode": "hosted", "api_endpoint": cloud.endpoint}, str(home))
    provider.shutdown()
    prompts = []
    answers = iter(["hosted", cloud.endpoint])

    def answer(prompt):
        prompts.append(prompt)
        return next(answers)

    monkeypatch.setattr("builtins.input", answer)
    monkeypatch.setattr(hosted.getpass, "getpass", lambda _: "synthetic-memory-token")
    provider.post_setup(str(home), {})
    assert not cloud.requests
    assert not (home / "cairn" / "hosted-credential.json").exists()
    assert not (home / "config.yaml").exists()
    assert not prompts
    assert capsys.readouterr().out == "Cairn provider is shut down; restart Hermes and run memory setup.\n"


def recall(provider, **args):
    return json.loads(provider.handle_tool_call("cairn_recall_memory", args))


def test_recall_tool_rest_contract_and_session_switch(install, cloud):
    _, provider, _, _ = install()
    cloud.partial = True
    result = recall(provider, query="  Synthetic query  ")
    assert result == {"ok": True, "value": {"memories": cloud.recall_value["memories"], "partial": True},
                      "evidenceTrust": "untrusted-data-not-instructions"}
    assert cloud.requests_for("/api/memory/recall")[-1][1] == {
        "query": "Synthetic query", "limit": 6, "session_id": "conversation"}
    provider.on_session_switch("synthetic-next", parent_session_id="synthetic-parent", reset=True)
    assert recall(provider, query="Synthetic next", limit=12)["ok"]
    assert cloud.requests_for("/api/memory/recall")[-1][1] == {
        "query": "Synthetic next", "limit": 12, "session_id": "synthetic-next"}
    provider.on_session_switch("invalid\n")
    cloud.partial = False
    assert recall(provider, query="Synthetic invalid session")["value"]["partial"] is False
    assert set(cloud.requests_for("/api/memory/recall")[-1][1]) == {"query", "limit"}
    for _, _, headers in cloud.requests:
        assert "X-Cairn-Memory-Partial-Support" not in headers
    assert not cloud.requests_for("/api/mcp")


@pytest.mark.parametrize("session_id", ["", "bad\n", "x" * 201, None, "合法", "valid._:-123"])
def test_recall_tool_session_validation(install, cloud, session_id):
    home, provider, _, _ = install(initialize=False)
    provider.initialize(session_id, hermes_home=str(home), platform="cli", agent_context="primary")
    assert recall(provider, query="Synthetic query")["ok"]
    body = cloud.requests_for("/api/memory/recall")[-1][1]
    assert ("session_id" in body) is (session_id == "valid._:-123")
    assert not cloud.requests_for("/api/mcp")


@pytest.mark.parametrize("status,value,expected,retryable", [
    (429, {"error": "quota_reached"}, "cairn_quota_reached", False),
    (429, {"error": "other"}, "cairn_rate_limited", True),
    (429, None, "cairn_rate_limited", True),
    (401, {}, "cairn_auth_failed", False), (403, {}, "cairn_auth_failed", False),
    (404, {}, "cairn_unavailable", True), (501, {}, "cairn_unavailable", True),
    (503, {}, "cairn_unavailable", True), (500, {}, "cairn_transport_failed", True),
    (302, {}, "cairn_transport_failed", True), (206, {}, "cairn_transport_failed", True),
    (200, {"memories": {}}, "cairn_transport_failed", True),
])
def test_recall_tool_rest_status(install, cloud, status, value, expected, retryable):
    _, provider, _, _ = install()
    cloud.recall_status, cloud.recall_value = status, value
    result = recall(provider, query="Synthetic query")
    assert result["ok"] is False
    assert result["error"]["code"] == expected
    assert result["error"]["retryable"] is retryable
    assert not cloud.requests_for("/api/mcp")


def test_recall_tool_invalid_json(install, cloud):
    _, provider, _, _ = install()
    cloud.invalid_json = True
    assert recall(provider, query="Synthetic query") == {
        "ok": False, "error": {"code": "cairn_transport_failed", "retryable": True}}
    cloud.recall_status = 429
    assert recall(provider, query="Synthetic query")["error"]["code"] == "cairn_rate_limited"
    assert not cloud.requests_for("/api/mcp")


def test_recall_tool_has_ten_second_budget(install, cloud, monkeypatch):
    _, provider, _, hosted = install()
    requests = []
    original = provider._hosted._client.request

    def request(method, url, *, budget, **kwargs):
        requests.append((url, budget))
        # Exercise actual deadline cancellation without spending ten seconds.
        return original(method, url, budget=0.25, **kwargs)

    monkeypatch.setattr(provider._hosted._client, "request", request)
    cloud.trickle_response = "/api/memory/recall"
    started = time.monotonic()
    result = recall(provider, query="Synthetic query")
    assert time.monotonic() - started < 0.65
    assert result == {"ok": False, "error": {"code": "cairn_transport_failed", "retryable": True}}
    assert requests == [(cloud.endpoint + "/api/memory/recall", 10)]


@pytest.mark.parametrize("operation", ["prefetch", "initialize", "tools/call", "credential"])
def test_stall_after_headers_closes_response(install, cloud, monkeypatch, operation):
    _, provider, _, hosted = install()
    monkeypatch.setattr(hosted, "REQUEST_TIMEOUT_SECONDS", 0.25)
    cloud.stall_response = {"prefetch": "/api/memory/recall",
                            "credential": "/api/cli-auth/v1/credential"}.get(operation, operation)
    closed = threading.Event()
    original = hosted.httpx.Response.aclose

    async def close(response):
        try:
            await original(response)
        finally:
            path = response.request.url.path
            is_target = path == cloud.stall_response
            if path == "/api/mcp":
                is_target = json.loads(response.request.content)["method"] == operation
            if is_target:
                closed.set()

    monkeypatch.setattr(hosted.httpx.Response, "aclose", close)
    started = time.monotonic()
    if operation == "prefetch":
        assert provider.prefetch("Synthetic stalled query") == ""
        wait_until(lambda: not provider._hosted._inflight, started + 1.25)
    elif operation == "credential":
        value, message = hosted.check_credential(cloud.endpoint, "synthetic-memory-token")
        assert value is None and "transport failure" in message
    else:
        result = json.loads(provider.handle_tool_call("cairn_remember_memory", {"content": "Synthetic note"}))
        assert result == {"ok": False, "error": {"code": "cairn_transport_failed", "retryable": True}}
    assert closed.wait(max(0, started + 1.25 - time.monotonic()))
    assert time.monotonic() - started < 1.25


@pytest.mark.parametrize("size,ok", [(1024 * 1024, True), (1024 * 1024 + 1, False)])
def test_decoded_body_size_limit(install, cloud, size, ok):
    _, provider, _, _ = install(cap="3000")
    cloud.decoded_size = size
    result = recall(provider, query="Synthetic compressed query")
    assert result["ok"] is ok
    if not ok:
        assert result["error"] == {"code": "cairn_transport_failed", "retryable": True}


def test_transport_is_lazy_and_setup_loop_is_torn_down(install, cloud, monkeypatch):
    _, provider, _, hosted = install()
    assert provider._hosted._client._loop is None
    threads = []
    original = hosted.spawn_context_thread

    def spawn(*args, **kwargs):
        thread = original(*args, **kwargs)
        threads.append(thread)
        return thread

    monkeypatch.setattr(hosted, "spawn_context_thread", spawn)
    value, message = hosted.check_credential(cloud.endpoint, "synthetic-memory-token")
    assert value is not None and message == ""
    assert len(threads) == 1
    assert not threads[0].is_alive()
    assert provider._hosted._client._loop is None
    assert recall(provider, query="Synthetic first")["ok"]
    assert recall(provider, query="Synthetic second")["ok"]
    assert len(threads) == 2
    assert threads[1].is_alive() and threads[1].daemon
    provider.shutdown()
    assert not threads[1].is_alive()
