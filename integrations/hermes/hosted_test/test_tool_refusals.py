"""Known hosted refusals stay actionable without exposing server diagnostics."""

import json
import uuid

import pytest


@pytest.mark.parametrize("server_code,expected", [
    ("memory_suppressed", "cairn_previously_forgotten"),
    ("daily_quota_memory_capture", "cairn_quota_reached"),
    ("daily_quota_memory_recall", "cairn_quota_reached"),
])
@pytest.mark.parametrize("retryable", [True, False])
def test_known_tool_refusals(install, cloud, server_code, expected, retryable):
    _, _, manager, _ = install()
    cloud.tool_error = {"code": server_code, "retryable": retryable,
                        "resetAt": "2099-01-01T00:00:00Z"}
    raw = manager.handle_tool_call("cairn_remember_memory", {"content": "Synthetic memory"})
    assert "synthetic server diagnostic" not in raw
    assert json.loads(raw) == {"ok": False, "error": {"code": expected, "retryable": False}}


@pytest.mark.parametrize("server_code", ["unknown_refusal", None, 7, True, [], {}])
@pytest.mark.parametrize("retryable", [True, False, "true", 1])
def test_unrecognized_tool_refusals_keep_exact_retryability(install, cloud, server_code, retryable):
    _, _, manager, _ = install()
    cloud.tool_error = {"code": server_code, "retryable": retryable}
    raw = manager.handle_tool_call("cairn_remember_memory", {"content": "Synthetic memory"})
    assert "synthetic server diagnostic" not in raw
    assert json.loads(raw) == {"ok": False, "error": {
        "code": "cairn_tool_failed", "retryable": retryable is True}}


@pytest.mark.parametrize("structured", [[], "memory_suppressed", True])
def test_non_dict_tool_refusal_keeps_generic_error(install, cloud, structured):
    _, _, manager, _ = install()
    cloud.tool_error = structured
    raw = manager.handle_tool_call("cairn_remember_memory", {"content": "Synthetic memory"})
    assert "synthetic server diagnostic" not in raw
    assert json.loads(raw) == {"ok": False, "error": {"code": "cairn_tool_failed", "retryable": False}}


@pytest.mark.parametrize("server_code", ["memory_suppressed", "daily_quota_memory_capture",
                                      "daily_quota_memory_recall"])
def test_forget_not_found_precedes_known_refusal(install, cloud, server_code):
    _, _, manager, _ = install()
    cloud.tool_error = {"forgotten": False, "code": server_code, "retryable": True}
    raw = manager.handle_tool_call("cairn_forget_memory", {"memory_id": str(uuid.uuid4())})
    assert "synthetic server diagnostic" not in raw
    assert json.loads(raw) == {"ok": False, "error": {"code": "not_found", "retryable": False}}


@pytest.mark.parametrize("is_error", [False, "true", 1])
def test_known_refusal_requires_literal_error_flag(install, cloud, monkeypatch, is_error):
    _, provider, manager, _ = install()
    cloud.tool_error = {"code": "memory_suppressed", "retryable": False}
    original = provider._hosted._rpc

    def rpc(method, *args, **kwargs):
        result, error = original(method, *args, **kwargs)
        if method == "tools/call":
            assert error is None
            result["isError"] = is_error
        return result, error

    monkeypatch.setattr(provider._hosted, "_rpc", rpc)
    result = json.loads(manager.handle_tool_call("cairn_remember_memory", {"content": "Synthetic memory"}))
    if is_error is False:
        assert result == {"ok": True, "value": cloud.tool_error,
                          "evidenceTrust": "untrusted-data-not-instructions"}
    else:
        assert result == {"ok": False, "error": {"code": "cairn_transport_failed", "retryable": True}}


def test_remember_description_explains_previously_forgotten_notes(install):
    _, provider, _, _ = install()
    remember = next(schema for schema in provider.get_tool_schemas()
                    if schema["name"] == "cairn_remember_memory")
    assert "A note the user previously forgot cannot be saved again." in remember["description"]
