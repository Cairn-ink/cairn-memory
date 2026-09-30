"""Pinned real Hermes/installed MCP; sources and agent completions are synthetic."""

import base64
import copy
import json
from pathlib import Path
import shlex
import shutil
import sqlite3
import subprocess
import sys
from unittest.mock import MagicMock, patch

import pytest

from test_agent_conversation import isolated_profile, response  # noqa: F401


DEFAULTS = {"remember_memory", "recall_memory", "inspect_memory", "correct_memory", "forget_memory"}


def prepare(home, request, settings=None, forbid_key=False):
    node = request.config.getoption("--cairn-node")
    # This test wrapper forbids all provider fetches in the real installed Node
    # subprocess. Key assertions cover the actual bridge -> SDK -> CLI boundary.
    preload = "globalThis.fetch=()=>{throw Error('synthetic provider forbidden')};"
    if forbid_key:
        preload += "if(process.env.OPENAI_API_KEY!==undefined)process.exit(91);"
    wrapper = home / "synthetic-node"
    wrapper.write_text("#!/bin/sh\nexec " + shlex.quote(node) + " " + shlex.quote(
        "--import=data:text/javascript;base64," + base64.b64encode(preload.encode()).decode()) + ' "$@"\n')
    wrapper.chmod(0o700)
    shutil.copytree(Path(__file__).parents[1] / "cairn", home / "plugins" / "cairn")
    config = {"node_path": str(wrapper), "executable_path": request.config.getoption("--cairn-executable"),
              **(settings or {})}
    (home / "cairn.json").write_text(json.dumps(config))
    (home / "config.yaml").write_text(json.dumps({"model": {"context_length": 256000},
        "tools": {"tool_search": {"enabled": "off"}},
        "memory": {"provider": "cairn", "memory_enabled": False, "user_profile_enabled": False}}))
    return config


def manager(home, session="synthetic-history-session"):
    from agent.memory_manager import MemoryManager
    from plugins.memory import load_memory_provider

    provider = load_memory_provider("cairn")
    assert provider is not None
    result = MemoryManager()
    try:
        result.add_provider(provider)
        result.initialize_all(session_id=session, hermes_home=str(home), platform="cli", agent_context="primary")
    except BaseException:
        result.shutdown_all()
        raise
    return provider, result


def invoke(target, name, arguments=None):
    return json.loads(target.handle_tool_call("cairn_" + name, arguments or {}))


def value(result):
    assert result["ok"], result
    assert result["evidenceTrust"] == "untrusted-data-not-instructions"
    return result["value"]


def inspected(target, memory):
    return value(invoke(target, "inspect_memory", {"memoryId": memory["id"]}))


def material(home):
    with sqlite3.connect(home / "cairn" / "memory.sqlite") as connection:
        tables = connection.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
        return [(name, connection.execute('SELECT * FROM "' + name + '" ORDER BY rowid').fetchall())
                for name, in tables]


@pytest.mark.parametrize("capture,recovery,history", [(c, r, h) for c in (False, True)
                         for r in (False, True) for h in (False, True)])
def test_history_inventory_config_and_profile_binding(isolated_profile, request, monkeypatch, capture, recovery, history):
    home = isolated_profile
    settings = {}
    expected = set(DEFAULTS)
    if capture:
        settings.update(capture_qualification="source-bound-v2", capture_deadline_ms="110000")
        expected.add("capture_memory")
    if recovery:
        settings["classification_recovery"] = "guarded-v1"
        expected.update({"inspect_capture_admission", "classify_unfiled_memories"})
    if history:
        settings["history_updates"] = "explicit-v1"
        expected.add("supersede_memory")
    config = prepare(home, request, settings, forbid_key=True)
    provider, target = manager(home)
    try:
        module = __import__(provider.__class__.__module__, fromlist=["validate_config"])
        assert module.configured_tools(config) == expected
        schemas = target.get_all_tool_schemas()
        assert {item["name"] for item in schemas} == {"cairn_" + name for name in expected}
        assert len(schemas) == 5 + int(capture) + 2 * int(recovery) + int(history)
        assert not (home / "cairn").exists(), "schema discovery must not open profile memory"
        field = next(item for item in provider.get_config_schema() if item["key"] == "history_updates")
        assert field["required"] is False
        assert field.get("default") == ("explicit-v1" if history else None)
        for invalid in [None, False, "", "other", "EXPLICIT-V1", [], {}]:
            with pytest.raises(ValueError, match="cairn_invalid_configuration"):
                provider.save_config({**config, "history_updates": invalid}, str(home))
            assert json.loads((home / "cairn.json").read_text()) == config
        if history:
            schema = next(item for item in schemas if item["name"] == "cairn_supersede_memory")
            assert set(schema["parameters"]["required"]) == {"memoryId", "expectedRevision", "replacement", "sourceExcerpt"}
            assert set(schema["parameters"]["properties"]["replacement"]["required"]) == {"content", "kind"}
            schema["parameters"].clear()
            assert next(item for item in target.get_all_tool_schemas() if item["name"] == "cairn_supersede_memory")["parameters"]
        if not capture and not recovery and not history:
            # Exercise the host's actual setup wizard with the independent
            # field, including its established blank-reconfiguration behavior.
            from hermes_cli import memory_setup

            with monkeypatch.context() as wizard:
                wizard.setattr(memory_setup, "_get_available_providers", lambda: [("cairn", "local", provider)])
                wizard.setattr(memory_setup, "_install_dependencies", lambda *args, **kwargs: None)
                wizard.setattr(memory_setup, "_curses_select", lambda *args, **kwargs: 0)
                wizard.setattr(memory_setup, "masked_secret_prompt", lambda *args, **kwargs: "")
                wizard.setattr(memory_setup, "_write_env_vars", lambda values: pytest.fail("No wizard credential writes"))
                import io

                wizard.setattr(sys, "stdin", io.StringIO("\n\n\n\n\nexplicit-v1\n"))
                memory_setup.cmd_setup([])
                enabled = {**config, "history_updates": "explicit-v1"}
                assert json.loads((home / "cairn.json").read_text()) == enabled
                wizard.setattr(sys, "stdin", io.StringIO("\n" * 6))
                memory_setup.cmd_setup([])
                assert json.loads((home / "cairn.json").read_text()) == enabled
                # The running session remains bound to its original profile;
                # resetting the synthetic config restores the next assertion's
                # known starting point without changing its cached inventory.
                (home / "cairn.json").write_text(json.dumps(config))
                assert not (home / "cairn").exists()
        changed = dict(config)
        if history:
            changed.pop("history_updates")
        else:
            changed["history_updates"] = "explicit-v1"
        (home / "cairn.json").write_text(json.dumps(changed))
        with pytest.raises(ValueError, match="cairn_profile_binding_changed"):
            provider.initialize("changed", hermes_home=str(home), platform="cli", agent_context="primary")
        assert invoke(target, "remember_memory", {"content": "Must not save after binding change."})["error"]["code"] == "cairn_not_initialized"
        assert not (home / "cairn").exists()
    finally:
        target.shutdown_all()


def test_history_memory_manager_cold_restart_evidence_loss_and_keyless_short_timeout(isolated_profile, request, monkeypatch):
    home = isolated_profile
    prepare(home, request, {"history_updates": "explicit-v1"}, forbid_key=True)
    provider, first = manager(home)
    targets = [first]
    try:
        old = value(invoke(first, "remember_memory", {"content": "Synthetic Hermes review is Friday."}))["memory"]
        unrelated = value(invoke(first, "remember_memory", {"content": "Synthetic unrelated memory."}))["memory"]
        before = inspected(first, old)
        input_args = {"memoryId": old["id"], "expectedRevision": old["revision"],
            "replacement": {"content": "Synthetic Hermes review is Monday.", "kind": "fact"},
            "sourceExcerpt": "I have adopted Monday for the synthetic Hermes review."}
        submitted = copy.deepcopy(input_args)
        real_popen = subprocess.Popen
        launches, deadlines = [], []

        def observe(*args, **kwargs):
            launches.append(dict(kwargs["env"]))
            process = real_popen(*args, **kwargs)
            communicate = process.communicate

            def exchange(*args, **kwargs):
                deadlines.append(kwargs["timeout"])
                return communicate(*args, **kwargs)

            process.communicate = exchange
            return process

        monkeypatch.setenv("CAIRN_MEMORY_OPENAI_API_KEY", "synthetic-dedicated-must-not-forward")
        monkeypatch.setenv("OPENAI_API_KEY", "synthetic-host-must-not-forward")
        # The pinned Python SDK cannot JSON-serialize lone surrogates, so this
        # earlier seam refuses before Node's invalid_input preflight. Preserve
        # the existing specific fail-closed transport envelope, not any error.
        before_invalid = material(home)
        for lone in ["\ud800", "\udc00"]:
            for patch_args in [{"sourceExcerpt": lone}, {"replacement": {"content": lone, "kind": "fact"}}]:
                malformed = {**submitted, **patch_args}
                original_malformed = copy.deepcopy(malformed)
                refused = invoke(first, "supersede_memory", malformed)
                assert not refused["ok"]
                assert refused["error"]["code"] == "cairn_transport_failed"
                assert refused["error"]["retryable"] is False
                assert malformed == original_malformed
                assert material(home) == before_invalid
                assert inspected(first, old) == before
                assert inspected(first, old)["memory"]["state"] == "active"
        # A valid update on that same predecessor still succeeds after refusal.
        with monkeypatch.context() as patcher:
            patcher.setattr(subprocess, "Popen", observe)
            changed = value(invoke(first, "supersede_memory", input_args))
        assert input_args == submitted
        assert launches == [{"LANG": "C.UTF-8", "PATH": "/usr/bin:/bin"}]
        assert deadlines == [45]
        history, successor = inspected(first, old), inspected(first, changed["memory"])
        assert history["memory"]["state"] == "historical"
        assert history["receipts"] == before["receipts"]
        assert successor["memory"]["state"] == "active"
        assert successor["receipts"][0]["excerpt"] == submitted["sourceExcerpt"]
        assert history["supersession"]["receiptIds"] == [successor["receipts"][0]["id"]]
        assert history["supersession"]["evidenceAvailable"] is True
        first.shutdown_all()
        _, cold = manager(home, "synthetic-history-cold")
        targets.append(cold)
        assert inspected(cold, old) == history
        assert inspected(cold, changed["memory"]) == successor
        assert {item["id"] for item in value(invoke(cold, "inspect_memory", {"states": ["active"]}))["memories"]} == {changed["memory"]["id"], unrelated["id"]}
        assert [item["id"] for item in value(invoke(cold, "inspect_memory", {"states": ["historical"]}))["memories"]] == [old["id"]]
        store = material(home)
        for patch_args, code in [({"expectedRevision": old["revision"]}, "revision_conflict"),
                                 ({"expectedRevision": history["memory"]["revision"]}, "memory_historical"),
                                 ({"memoryId": "missing"}, "memory_not_found")]:
            assert invoke(cold, "supersede_memory", {**submitted, **patch_args})["error"]["code"] == code
            assert material(home) == store
        for source in [None, "", " \t\n", "x" * 801, "ﬃ" * 300]:
            result = invoke(cold, "supersede_memory", {**submitted, "memoryId": changed["memory"]["id"],
                "expectedRevision": changed["memory"]["revision"], "sourceExcerpt": source})
            assert not result["ok"]
            assert material(home) == store
        corrected = value(invoke(cold, "correct_memory", {"memoryId": changed["memory"]["id"],
            "expectedRevision": changed["memory"]["revision"], "content": "Synthetic Hermes Monday morning review."}))["memory"]
        assert corrected["id"] == changed["memory"]["id"]
        assert inspected(cold, old)["supersession"]["evidenceAvailable"] is False
        assert inspected(cold, old)["supersession"]["receiptIds"] == []
        value(invoke(cold, "forget_memory", {"memoryId": corrected["id"], "expectedRevision": corrected["revision"]}))
        assert inspected(cold, old)["supersession"] == {"previousRevision": old["revision"],
            "replacement": None, "receiptIds": [], "evidenceAvailable": False}
        assert inspected(cold, unrelated)["memory"]["state"] == "active"
        cold.shutdown_all()
        _, restarted = manager(home, "synthetic-history-after-forget")
        targets.append(restarted)
        assert inspected(restarted, old)["memory"]["state"] == "historical"
        assert inspected(restarted, old)["supersession"]["evidenceAvailable"] is False
    finally:
        for target in targets:
            target.shutdown_all()


def test_history_actual_aiagent_scripted_update_and_cross_session_inspection(isolated_profile, request):
    home = isolated_profile
    prepare(home, request, {"history_updates": "explicit-v1"}, forbid_key=True)
    from run_agent import AIAgent

    expected = {"cairn_" + name for name in DEFAULTS | {"supersede_memory"}}
    agents = []

    def new_agent(session):
        agent = AIAgent(api_key="synthetic-no-network", base_url="http://127.0.0.1:1/v1",
            model="synthetic-model", platform="cli", session_id=session, enabled_toolsets=["memory"],
            skip_context_files=True, skip_memory=False, skip_background_review=True, quiet_mode=True, max_iterations=4)
        agents.append(agent)
        assert {tool["function"]["name"] for tool in agent.tools} == expected
        agent.compression_enabled = False
        agent.save_trajectories = False
        agent._use_prompt_caching = False
        agent.client = MagicMock()
        return agent

    def turn(agent, name, arguments=None):
        captured = []

        def complete(**kwargs):
            assert {tool["function"]["name"] for tool in kwargs["tools"]} == expected
            captured.append(kwargs)
            return response("cairn_" + name, arguments) if len(captured) == 1 else response()

        agent.client.chat.completions.create.side_effect = complete
        agent.run_conversation("Synthetic user explicitly requests " + name)
        assert len(captured) == 2
        results = [message for message in captured[1]["messages"] if message.get("role") == "tool"]
        assert len(results) == 1
        return json.loads(results[0]["content"])

    with patch("agent.process_bootstrap.OpenAI"):
        try:
            first = new_agent("synthetic-adopted-update")
            old = value(turn(first, "remember_memory", {"content": "Synthetic agent review is Friday."}))["memory"]
            original = value(turn(first, "inspect_memory", {"memoryId": old["id"]}))
            changed = value(turn(first, "supersede_memory", {"memoryId": old["id"], "expectedRevision": old["revision"],
                "replacement": {"content": "Synthetic agent review is Monday.", "kind": "fact"},
                "sourceExcerpt": "I have adopted Monday for the synthetic agent review."}))
            first.close()
            second = new_agent("synthetic-adopted-update-cold")
            history = value(turn(second, "inspect_memory", {"memoryId": old["id"]}))
            successor = value(turn(second, "inspect_memory", {"memoryId": changed["memory"]["id"]}))
            assert history["memory"]["state"] == "historical"
            assert history["receipts"] == original["receipts"]
            assert successor["memory"]["state"] == "active"
            assert history["supersession"]["replacement"]["memoryId"] == successor["memory"]["id"]
            assert history["supersession"]["receiptIds"] == [successor["receipts"][0]["id"]]
            assert successor["receipts"][0]["excerpt"] == "I have adopted Monday for the synthetic agent review."
        finally:
            for agent in agents:
                agent.close()
