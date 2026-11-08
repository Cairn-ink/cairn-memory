"""Regression coverage for bounded HTTP requests and permanent router shutdown."""

import json
import time

import pytest


def test_recall_trickle_releases_worker_and_allows_next_recall(install, cloud, monkeypatch):
    _, provider, _, hosted = install()
    workers = []
    spawn = hosted.spawn_context_thread

    def track_worker(*args, **kwargs):
        worker = spawn(*args, **kwargs)
        workers.append(worker)
        return worker

    monkeypatch.setattr(hosted, "spawn_context_thread", track_worker)
    cloud.trickle_response = "/api/memory/recall"
    started = time.monotonic()
    assert provider.prefetch("Synthetic first query", session_id="conversation") == ""
    assert time.monotonic() - started < 0.75
    # The HTTP budget is the prefetch cap plus 0.5 seconds, with 0.5 seconds of margin.
    workers[0].join(max(0, started + 1.25 - time.monotonic()))
    assert not workers[0].is_alive(), "Trickling kept the recall worker alive past its total deadline"
    assert not provider._hosted._inflight
    cloud.trickle_response = None
    assert "Synthetic note" in provider.prefetch("Synthetic next query", session_id="conversation")
    assert len(cloud.requests_for("/api/memory/recall")) == 2
    assert not provider._hosted._late


@pytest.mark.parametrize("operation", ["initialize", "tools/call", "credential"])
def test_trickle_has_total_deadline(install, cloud, monkeypatch, operation):
    _, provider, _, hosted = install()
    monkeypatch.setattr(hosted, "REQUEST_TIMEOUT_SECONDS", 0.25, raising=False)
    cloud.trickle_response = "/api/cli-auth/v1/credential" if operation == "credential" else operation
    started = time.monotonic()
    if operation == "credential":
        credential, message = hosted.check_credential(cloud.endpoint, "synthetic-memory-token")
        assert credential is None
        assert "transport failure" in message
    else:
        result = json.loads(provider.handle_tool_call("cairn_recall_memory", {"query": "Synthetic query"}))
        assert result == {"ok": False, "error": {"code": "cairn_transport_failed", "retryable": True}}
        assert provider._hosted._mcp_initialized is (operation == "tools/call")
    assert time.monotonic() - started < 0.75


@pytest.mark.parametrize("operation", ["recall", "initialize", "tools/call", "credential"])
def test_oversize_response_fails_closed(install, cloud, operation):
    _, provider, _, hosted = install(cap="3000")
    cloud.oversize_response = {"recall": "/api/memory/recall",
                               "credential": "/api/cli-auth/v1/credential"}.get(operation, operation)
    if operation == "recall":
        assert provider.prefetch("Synthetic query", session_id="conversation") == ""
        assert not provider._hosted._inflight
        assert not provider._hosted._late
        assert provider.recall_status() is None
    elif operation == "credential":
        credential, message = hosted.check_credential(cloud.endpoint, "synthetic-memory-token")
        assert credential is None
        assert "transport failure" in message
    else:
        result = json.loads(provider.handle_tool_call("cairn_recall_memory", {"query": "Synthetic query"}))
        assert result == {"ok": False, "error": {"code": "cairn_transport_failed", "retryable": True}}


@pytest.mark.parametrize("selected", [False, True])
def test_shutdown_prevents_backend_reactivation(install, cloud, selected):
    home, provider, _, hosted = install(configured=False)
    values = {"mode": "hosted", "api_endpoint": cloud.endpoint, "prefetch_timeout_ms": "250"}
    (home / "cairn.json").write_text(json.dumps(values))
    hosted.write_credential(home, {"endpoint": cloud.endpoint, "token": "synthetic-memory-token",
                                 "token_id": "synthetic-token-id", "expires_at": None})
    if selected:
        assert provider.is_available()
    backend = provider._hosted
    provider.shutdown()
    available = provider.is_available()
    try:
        provider.initialize("conversation", hermes_home=str(home), platform="cli", agent_context="primary")
    except ValueError as exc:
        initialization_error = str(exc)
    else:
        initialization_error = None
    result = provider.prefetch("Synthetic private query", session_id="conversation")
    tool = json.loads(provider.handle_tool_call("cairn_recall_memory", {"query": "Synthetic private query"}))
    assert not cloud.requests
    assert available is False
    assert initialization_error == "cairn_unsupported_context"
    assert result == ""
    assert tool["ok"] is False
    assert provider._hosted is backend


@pytest.mark.parametrize("entry", ["is_available", "save_config", "get_tool_schemas", "initialize",
                                  "handle_tool_call", "prefetch", "recall_status", "system_prompt_block", "shutdown"])
def test_closed_router_never_delegates(install, cloud, monkeypatch, entry):
    home, provider, _, hosted = install()
    provider.shutdown()
    original_shutdown = provider._hosted.shutdown

    def forbidden(*args, **kwargs):
        pytest.fail("Closed router delegated to its backend")

    monkeypatch.setattr(hosted, "HostedMemoryProvider", forbidden)
    monkeypatch.setattr(provider._hosted, entry, forbidden, raising=False)
    if entry == "save_config":
        before = (home / "cairn.json").read_bytes()
        with pytest.raises(ValueError, match="cairn_unsupported_context"):
            provider.save_config({"mode": "hosted", "api_endpoint": cloud.endpoint}, str(home))
        assert (home / "cairn.json").read_bytes() == before
    elif entry == "initialize":
        with pytest.raises(ValueError, match="cairn_unsupported_context"):
            provider.initialize("conversation", hermes_home=str(home), platform="cli", agent_context="primary")
    elif entry == "handle_tool_call":
        assert json.loads(provider.handle_tool_call("cairn_recall_memory", {"query": "Synthetic query"}))["ok"] is False
    elif entry == "prefetch":
        assert provider.prefetch("Synthetic query") == ""
    else:
        expected = {"is_available": False, "get_tool_schemas": [], "recall_status": None,
                    "system_prompt_block": "", "shutdown": None}
        try:
            assert getattr(provider, entry)() == expected[entry]
        finally:
            if entry == "shutdown":
                monkeypatch.setattr(provider._hosted, "shutdown", original_shutdown)
    assert not cloud.requests
