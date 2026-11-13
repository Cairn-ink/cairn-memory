"""Hosted automatic pause parity, using synthetic credentials and loopback only."""

import json
import time

import pytest


PAUSE = "/api/memory/pause-state"
RECALL = "/api/memory/recall"


def state(paused=False, generation=0, enforced=True):
    return {"paused": paused, "generation": generation, "enforced": enforced}


def withheld(provider, reason):
    assert provider.prefetch("Synthetic private query", session_id="conversation") == ""
    status = provider.recall_status()
    assert status is not None
    assert status.status == "withheld"
    assert status.reason == reason
    assert status.count == 0
    assert "withheld" in status.provider_label
    assert "synthetic-memory-token" not in repr(status)
    assert "synthetic server diagnostic" not in repr(status)


def wait_done(provider):
    deadline = time.monotonic() + 2
    while provider._hosted._inflight and time.monotonic() < deadline:
        time.sleep(0.005)
    assert not provider._hosted._inflight


def test_paused_zero_recalls_then_resumed(install, cloud):
    _, provider, _, _ = install()
    cloud.pause_value = state(True, 1)
    withheld(provider, "paused")
    assert not cloud.requests_for(RECALL)
    request = cloud.requests_for(PAUSE)[0]
    assert request[1] is None
    assert request[2]["Authorization"] == "Bearer synthetic-memory-token"
    assert request[2]["Cache-Control"] == "no-store"
    cloud.pause_value = state(False, 2)
    assert "Synthetic note" in provider.prefetch("Synthetic resumed", session_id="conversation")
    assert provider.recall_status().count == 1
    assert len(cloud.requests_for(PAUSE)) == 2
    assert len(cloud.requests_for(RECALL)) == 1


@pytest.mark.parametrize("value", [
    state(enforced=False), None, [], {}, state(generation=-1), state(generation=True),
    state(generation=9007199254740992), state(generation=1.5), state(paused=1),
    state(enforced=1), {**state(), "extra": "synthetic server diagnostic"},
    {"paused": False, "generation": 0}, b"invalid json synthetic server diagnostic",
    b"\xff", b'{"paused":false,"generation":NaN,"enforced":true}',
])
def test_invalid_observation_withheld(install, cloud, value):
    _, provider, _, _ = install()
    cloud.pause_value = value
    withheld(provider, "pause_unavailable")
    assert not cloud.requests_for(RECALL)


@pytest.mark.parametrize("status", [204, 206, 301, 307, 401, 403, 404, 429, 500, 503])
def test_non_200_and_redirect_not_followed(install, cloud, status):
    _, provider, _, _ = install()
    cloud.pause_status = status
    cloud.pause_value = b"synthetic server diagnostic synthetic-memory-token"
    withheld(provider, "pause_unavailable")
    assert [r[0] for r in cloud.requests] == [PAUSE]


@pytest.mark.parametrize("size,allowed", [(4096, True), (4097, False)])
def test_pause_decoded_body_cap(install, cloud, size, allowed):
    _, provider, _, _ = install()
    encoded = json.dumps(state()).encode()
    cloud.pause_value = encoded + b" " * (size - len(encoded))
    if allowed:
        assert "Synthetic note" in provider.prefetch("Synthetic query")
    else:
        withheld(provider, "pause_unavailable")
        assert not cloud.requests_for(RECALL)


def test_compressed_pause_body_cap(install, cloud):
    _, provider, _, _ = install()
    cloud.decoded_size = 4097
    withheld(provider, "pause_unavailable")
    assert not cloud.requests_for(RECALL)


@pytest.mark.parametrize("generation", [0, 1.0, 9007199254740991])
def test_valid_schema_generation_boundaries(install, cloud, generation):
    _, provider, _, _ = install()
    cloud.pause_value = state(generation=generation)
    assert "Synthetic note" in provider.prefetch("Synthetic query")
    assert len(cloud.requests_for(PAUSE)) == len(cloud.requests_for(RECALL)) == 1


def test_observation_history_is_per_provider(install, cloud):
    _, first, _, _ = install("first")
    cloud.pause_value = state(generation=5)
    assert first.prefetch("Synthetic first profile")
    _, second, _, _ = install("second")
    cloud.pause_value = state(generation=0)
    assert second.prefetch("Synthetic second profile")
    withheld(first, "pause_unavailable")
    assert first._hosted._pause_previous == state(generation=5)
    assert second._hosted._pause_previous == state(generation=0)


@pytest.mark.parametrize("previous,remote,reason", [
    (state(False, 3), state(False, 2), "pause_unavailable"),
    (state(True, 3), state(True, 2), "pause_unavailable"),
    (state(False, 3), state(True, 3), "pause_unavailable"),
    (state(True, 3), state(False, 3), None),
    (state(False, 3), state(False, 3), None),
    (state(True, 3), state(True, 3), "paused"),
    (state(False, 3), state(True, 4), "paused"),
    (state(True, 3), state(False, 4), None),
])
def test_node_regression_branches(install, cloud, previous, remote, reason):
    _, provider, _, _ = install()
    cloud.pause_value = previous
    provider.prefetch("Synthetic first", session_id="conversation")
    before = len(cloud.requests_for(RECALL))
    cloud.pause_value = remote
    if reason:
        withheld(provider, reason)
        assert len(cloud.requests_for(RECALL)) == before
    else:
        assert "Synthetic note" in provider.prefetch("Synthetic next", session_id="conversation")
        assert len(cloud.requests_for(RECALL)) == before + 1
    # Rejected observations must not replace the last accepted state.
    assert provider._hosted._pause_previous == (previous if reason == "pause_unavailable" else remote)


@pytest.mark.parametrize("previous", [{}, state(enforced=False)])
def test_invalid_previous_node_branches(install, cloud, previous):
    _, provider, _, _ = install()
    provider._hosted._pause_previous = previous
    withheld(provider, "pause_unavailable")
    assert not cloud.requests_for(RECALL)
    assert provider._hosted._pause_previous == previous


def test_observation_transport_failure_sanitized(install, cloud, monkeypatch, capsys):
    _, provider, _, _ = install()

    def fail(*args, **kwargs):
        raise OSError("synthetic server diagnostic synthetic-memory-token")

    monkeypatch.setattr(provider._hosted._client, "request", fail)
    withheld(provider, "pause_unavailable")
    assert not cloud.requests
    captured = capsys.readouterr()
    assert captured.out == captured.err == ""


def test_pause_and_recall_share_foreground_and_total_deadlines(install, cloud):
    _, provider, _, _ = install()
    cloud.pause_delay = 0.15
    cloud.recall_delay = 0.65
    started = time.monotonic()
    assert provider.prefetch("Synthetic slow query", session_id="conversation") == ""
    elapsed = time.monotonic() - started
    assert 0.20 <= elapsed < 0.36, f"combined foreground time {elapsed:.3f}s"
    wait_done(provider)
    assert time.monotonic() - started < 0.95
    assert not provider._hosted._late, "recall got a fresh total deadline after observing pause"
    assert len(cloud.requests_for(PAUSE)) == len(cloud.requests_for(RECALL)) == 1


@pytest.mark.parametrize("mode", ["delay", "trickle", "stall"])
def test_pause_deadline_never_sends_query_later(install, cloud, mode):
    _, provider, _, _ = install()
    if mode == "delay":
        cloud.pause_delay = 0.4
    elif mode == "trickle":
        cloud.trickle_response = PAUSE
    else:
        cloud.stall_response = PAUSE
    started = time.monotonic()
    withheld(provider, "pause_unavailable")
    assert time.monotonic() - started < 0.4
    # Wait past both the delayed response and the former recall total deadline.
    time.sleep(0.8)
    assert not cloud.requests_for(RECALL)
    assert not provider._hosted._late


@pytest.mark.parametrize("blocked", ["paused", "unavailable"])
@pytest.mark.parametrize("finished_before_check", [True, False])
def test_late_result_dropped_at_next_turn(install, cloud, blocked, finished_before_check):
    _, provider, _, _ = install()
    cloud.recall_release.clear()
    assert provider.prefetch("Synthetic first", session_id="conversation") == ""
    if finished_before_check:
        cloud.recall_release.set()
        cloud.wait_recalls(1)
        wait_done(provider)
        assert provider._hosted._late
    cloud.pause_value = state(True, 1) if blocked == "paused" else state(enforced=False)
    withheld(provider, "paused" if blocked == "paused" else "pause_unavailable")
    assert not provider._hosted._late
    cloud.recall_release.set()
    wait_done(provider)
    assert not provider._hosted._late, "an older in-flight result repopulated the late cache"
    assert len(cloud.requests_for(RECALL)) == 1
    cloud.pause_value = state(False, 2)
    cloud.recall_value["memories"][0]["content"] = "Synthetic resumed note"
    assert "Synthetic resumed note" in provider.prefetch("Synthetic resumed", session_id="conversation")


def test_late_result_injected_only_after_fresh_unpaused_observation(install, cloud):
    _, provider, _, _ = install()
    cloud.recall_release.clear()
    assert provider.prefetch("Synthetic first", session_id="conversation") == ""
    cloud.recall_release.set()
    cloud.wait_recalls(1)
    wait_done(provider)
    cloud.recall_release.clear()
    assert "Synthetic note" in provider.prefetch("Synthetic next", session_id="conversation")
    assert "Synthetic note" not in provider.prefetch("Synthetic still in flight", session_id="conversation")
    assert len(cloud.requests_for(PAUSE)) == 3
    assert len(cloud.requests_for(RECALL)) == 2
    cloud.recall_release.set()
    wait_done(provider)


@pytest.mark.parametrize("available", [True, False])
def test_explicit_tools_bypass_automatic_pause(install, cloud, available):
    _, provider, _, _ = install()
    cloud.pause_value = state(True, 1) if available else state(enforced=False)
    withheld(provider, "paused" if available else "pause_unavailable")
    saved = json.loads(provider.handle_tool_call("cairn_remember_memory", {"content": "Synthetic explicit note"}))
    assert saved["ok"]
    recalled = json.loads(provider.handle_tool_call("cairn_recall_memory", {"query": "Synthetic explicit query"}))
    assert recalled["ok"]
    forgotten = json.loads(provider.handle_tool_call("cairn_forget_memory", {"memory_id": saved["value"]["id"]}))
    assert forgotten["ok"] and forgotten["value"]["forgotten"]
    assert len(cloud.requests_for(PAUSE)) == 1
    assert len(cloud.requests_for(RECALL)) == 1
    assert [r[1]["method"] for r in cloud.requests_for("/api/mcp")] == ["initialize", "tools/call", "tools/call"]
