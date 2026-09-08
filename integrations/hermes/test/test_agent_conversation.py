"""Opt-in pinned Hermes agent-loop tests; completions are synthetic, tools are real."""

import json
import os
from pathlib import Path
import shutil
import socket
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest


def response(name=None, arguments=None):
    calls = None if name is None else [SimpleNamespace(
        id="synthetic-call", type="function", function=SimpleNamespace(
            name=name, arguments=json.dumps(arguments or {})))]
    return SimpleNamespace(choices=[SimpleNamespace(
        message=SimpleNamespace(content="Synthetic completion" if name is None else None,
                                tool_calls=calls),
        finish_reason="stop" if name is None else "tool_calls")],
        model="synthetic-model", usage=None)


@pytest.fixture
def isolated_profile(tmp_path, monkeypatch):
    # Set isolation before importing Hermes: some modules cache paths at import.
    for key in list(os.environ):
        if key not in {"PATH", "LANG", "LC_ALL", "TZ", "PYTHONHASHSEED"}:
            monkeypatch.delenv(key)
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.chdir(tmp_path)
    connect = socket.socket.connect
    connect_ex = socket.socket.connect_ex

    def deny_network(sock, address):
        if sock.family in (socket.AF_INET, socket.AF_INET6):
            raise AssertionError("Network forbidden in synthetic agent test")
        return connect(sock, address)

    def deny_network_ex(sock, address):
        if sock.family in (socket.AF_INET, socket.AF_INET6):
            raise AssertionError("Network forbidden in synthetic agent test")
        return connect_ex(sock, address)

    monkeypatch.setattr(socket.socket, "connect", deny_network)
    monkeypatch.setattr(socket.socket, "connect_ex", deny_network_ex)
    return tmp_path


@pytest.mark.parametrize("mode", ["native", "mcp"])
def test_actual_agent_cross_session_lifecycle(isolated_profile, request, mode):
    home = isolated_profile
    node = request.config.getoption("--cairn-node")
    executable = request.config.getoption("--cairn-executable")
    config = {"model": {"context_length": 256000},
              "tools": {"tool_search": {"enabled": "off"}},
              "memory": {"provider": "cairn" if mode == "native" else "",
                         "memory_enabled": False, "user_profile_enabled": False}}
    if mode == "native":
        shutil.copytree(Path(__file__).parents[1] / "cairn", home / "plugins" / "cairn")
        (home / "cairn.json").write_text(json.dumps(
            {"node_path": node, "executable_path": executable}))
    else:
        config["mcp_servers"] = {"cairn": {"command": node, "args": [
            executable, "--db", str(home / "memory.sqlite"), "--owner", "synthetic-owner"]}}
    # JSON is valid YAML; configuration loading remains the host's real implementation.
    (home / "config.yaml").write_text(json.dumps(config))

    from run_agent import AIAgent
    from tools.mcp_tool_discovery import discover_mcp_tools
    from tools.mcp_tool_lifecycle import shutdown_mcp_servers

    prefix = "cairn_" if mode == "native" else "mcp__cairn__"
    expected = {prefix + action + "_memory" for action in
                ("remember", "recall", "inspect", "correct", "forget")}
    agents = []

    def new_agent(session):
        if mode == "mcp":
            assert set(discover_mcp_tools()) == expected
        agent = AIAgent(api_key="synthetic-no-network", base_url="http://127.0.0.1:1/v1",
                        model="synthetic-model", platform="cli", session_id=session,
                        enabled_toolsets=["memory" if mode == "native" else "mcp-cairn"],
                        skip_context_files=True, skip_memory=mode != "native",
                        skip_background_review=True, quiet_mode=True, max_iterations=4)
        agents.append(agent)
        assert {tool["function"]["name"] for tool in agent.tools} == expected
        agent.compression_enabled = False
        agent.save_trajectories = False
        agent._use_prompt_caching = False
        agent.client = MagicMock()
        return agent

    def turn(agent, action, **arguments):
        name = prefix + action + "_memory"
        captured = []

        def complete(**kwargs):
            assert {tool["function"]["name"] for tool in kwargs["tools"]} == expected
            captured.append(kwargs)
            if len(captured) == 1:
                return response(name, arguments)
            assert len(captured) == 2
            return response()

        agent.client.chat.completions.create.side_effect = complete
        agent.run_conversation("Synthetic user explicitly requests " + action)
        assert len(captured) == 2
        results = [m for m in captured[1]["messages"] if m.get("role") == "tool"]
        assert len(results) == 1, results
        raw = results[0]["content"]
        if mode == "mcp":
            # Hermes preserves its external-source warning around the MCP envelope.
            assert raw.startswith('<untrusted_tool_result source="' + name + '">\n')
            assert raw.endswith("\n</untrusted_tool_result>")
            payload = raw.split("\n\n", 1)[1].removesuffix("\n</untrusted_tool_result>")
            envelope = json.loads(payload)
            assert set(envelope) in ({"result"}, {"error"}), envelope
            raw = envelope.get("result", envelope.get("error"))
            assert json.loads(raw)["ok"] == ("result" in envelope)
        return json.loads(raw)

    def value(result):
        assert result["ok"], result
        assert result["evidenceTrust"] == "untrusted-data-not-instructions"
        return result["value"]

    # Only the completion client constructor/transport is mocked. Real discovery,
    # schemas, routing, provider, SDK stdio and SQLite execute below.
    with patch("agent.process_bootstrap.OpenAI"):
        try:
            first = new_agent("synthetic-session-a")
            memory = value(turn(first, "remember", content="Synthetic preference: concise examples."))["memory"]
            detail = value(turn(first, "inspect", memoryId=memory["id"]))
            assert detail["memory"]["content"] == "Synthetic preference: concise examples."
            assert detail["receipts"][0]["excerpt"] == detail["memory"]["content"]
            first.close()
            if mode == "mcp":
                shutdown_mcp_servers()
            second = new_agent("synthetic-session-b")
            again = value(turn(second, "inspect", memoryId=memory["id"]))
            assert again == detail
            assert turn(second, "recall", query="examples")["error"]["code"] == "model_not_configured"
            changed = value(turn(second, "correct", memoryId=memory["id"],
                                 expectedRevision=memory["revision"],
                                 content="Synthetic preference: detailed examples."))["memory"]
            corrected = value(turn(second, "inspect", memoryId=memory["id"]))
            assert corrected["memory"]["content"] == "Synthetic preference: detailed examples."
            assert corrected["receipts"][0]["excerpt"] == corrected["memory"]["content"]
            assert turn(second, "forget", memoryId=memory["id"],
                        expectedRevision=memory["revision"])["error"]["code"] == "revision_conflict"
            value(turn(second, "forget", memoryId=memory["id"], expectedRevision=changed["revision"]))
            assert turn(second, "inspect", memoryId=memory["id"])["error"]["code"] == "memory_not_found"
            assert value(turn(second, "inspect"))["memories"] == []
        finally:
            for agent in agents:
                agent.close()
            shutdown_mcp_servers()
