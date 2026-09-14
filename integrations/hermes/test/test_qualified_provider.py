"""Actual pinned-host discovery with synthetic profiles/keys; no model traffic."""
import importlib
import importlib.util
from contextlib import asynccontextmanager, contextmanager
import json
from pathlib import Path
import shutil
import subprocess
import threading
import time
from types import SimpleNamespace

import anyio

import psutil
import pytest

from agent.memory_manager import MemoryManager
from plugins.memory import load_memory_provider, list_memory_provider_names
from hermes_cli import memory_setup


@pytest.fixture
def provider_factory(tmp_path, monkeypatch, request):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    managers = []

    def make(name, enabled=True, initialize=True, source_context=False):
        home = tmp_path / name
        shutil.copytree(Path(__file__).parents[1] / "cairn", home / "plugins" / "cairn")
        monkeypatch.setenv("HERMES_HOME", str(home))
        (home / "config.yaml").write_text("memory:\n  provider: cairn\n")
        assert "cairn" in list_memory_provider_names()
        provider = load_memory_provider("cairn")
        config = {"node_path": request.config.getoption("--cairn-node"),
                  "executable_path": request.config.getoption("--cairn-executable")}
        if enabled:
            config["capture_qualification"] = "source-bound-v2"
        if source_context:
            config["recall_context"] = "source-evidence"
        provider.save_config(config, str(home))
        manager = MemoryManager()
        manager.add_provider(provider)
        managers.append(manager)
        assert not (home / "cairn").exists()
        if initialize:
            manager.initialize_all(session_id="synthetic", hermes_home=str(home), platform="cli", agent_context="primary")
        return home, provider, manager, config

    yield make
    for manager in managers:
        manager.shutdown_all()


def call(manager, name, **args):
    return json.loads(manager.handle_tool_call("cairn_" + name + "_memory", args))


def test_strict_config_and_actual_native_wizard_optional_blank(provider_factory, monkeypatch):
    home, provider, _, config = provider_factory("wizard")
    for value in [None, True, False, "", "source-bound-v1", " source-bound-v2", 2]:
        with pytest.raises(ValueError, match="cairn_invalid_configuration"):
            provider.save_config({**config, "capture_qualification": value}, str(home))
    for value in [None, True, False, "", "qualified", " source-evidence", "source-evidence ", 2]:
        with pytest.raises(ValueError, match="cairn_invalid_configuration"):
            provider.save_config({**config, "recall_context": value}, str(home))
    with pytest.raises(ValueError):
        provider.save_config({**config, "timeout": 999}, str(home))
    assert json.loads((home / "cairn.json").read_text()) == config
    schema = provider.get_config_schema()
    mode = next(field for field in schema if field["key"] == "capture_qualification")
    assert not mode.get("required") and not mode.get("default") and not mode.get("choices")
    context = next(field for field in schema if field["key"] == "recall_context")
    assert not context.get("required") and not context.get("default") and not context.get("choices")
    for selected, recall_context in [("", ""), ("source-bound-v2", "source-evidence")]:
        answers = iter([config["node_path"], config["executable_path"], selected, recall_context,
                        "synthetic-wizard-key"])
        monkeypatch.setattr(memory_setup, "_prompt", lambda *args, **kwargs: next(answers))
        collected, secrets = {}, {}
        assert memory_setup._prompt_schema_fields("cairn", schema, collected, secrets)
        assert ("capture_qualification" in collected) == bool(selected)
        assert ("recall_context" in collected) == bool(recall_context)
        assert secrets == {"CAIRN_MEMORY_OPENAI_API_KEY": "synthetic-wizard-key"}
        provider.save_config(collected, str(home))
        assert json.loads((home / "cairn.json").read_text()) == collected
        assert "synthetic-wizard-key" not in (home / "cairn.json").read_text()


def test_opt_in_recall_context_supplies_only_missing_default_without_mutating_callers(provider_factory, monkeypatch):
    _, provider, _, _ = provider_factory("source-context", source_context=True)
    observed = []

    def request(operation, database, owner, **fields):
        observed.append((operation, fields))
        return {"ok": True, "value": {}}

    monkeypatch.setattr(provider, "_request", request)
    calls = [
        ("recall_memory", {"query": "default", "limit": 3},
         {"query": "default", "limit": 3, "contextMode": "source-evidence"}),
        ("recall_memory", {"query": "qualified", "includeQualification": False},
         {"query": "qualified", "includeQualification": False}),
        ("recall_memory", {"query": "qualified support", "includeQualification": True},
         {"query": "qualified support", "includeQualification": True}),
        ("recall_memory", {"query": "rationale", "contextMode": "rationale-evidence"},
         {"query": "rationale", "contextMode": "rationale-evidence"}),
        ("inspect_memory", {"limit": 2}, {"limit": 2}),
    ]
    for name, arguments, expected in calls:
        original = dict(arguments)
        assert json.loads(provider.handle_tool_call("cairn_" + name, arguments))["ok"]
        assert arguments == original
        assert observed[-1][0] == "call"
        assert observed[-1][1]["name"] == name
        assert observed[-1][1]["arguments"] == expected

    _, ordinary, _, _ = provider_factory("ordinary-context", source_context=False)
    monkeypatch.setattr(ordinary, "_request", request)
    arguments = {"query": "ordinary"}
    assert json.loads(ordinary.handle_tool_call("cairn_recall_memory", arguments))["ok"]
    assert arguments == {"query": "ordinary"}
    assert observed[-1][1]["arguments"] == arguments


def test_discovery_uses_keyless_synthetic_db_and_matching_five_six_allowlist(provider_factory, monkeypatch):
    real_popen = subprocess.Popen
    observed = []

    def launch(*args, **kwargs):
        observed.append(dict(kwargs["env"]))
        return real_popen(*args, **kwargs)

    monkeypatch.setattr(subprocess, "Popen", launch)
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-generic-never-use")
    monkeypatch.setenv("CAIRN_MEMORY_OPENAI_API_KEY", "synthetic-dedicated-never-discover")
    for enabled in [False, True]:
        home, provider, manager, _ = provider_factory("discovery-" + str(enabled), enabled)
        assert len(manager.get_all_tool_schemas()) == (6 if enabled else 5)
        assert ("cairn_capture_memory" in {s["name"] for s in manager.get_all_tool_schemas()}) == enabled
        assert not (home / "cairn").exists()
        assert observed[-1] == {"LANG": "C.UTF-8", "PATH": "/usr/bin:/bin"}
        if not enabled:
            assert not json.loads(provider.handle_tool_call("cairn_capture_memory", {"batchId": "synthetic", "messages": []}))["ok"]


def test_dedicated_key_forwarded_only_capture_recall_with_no_generic_env_or_payload_authority(provider_factory, monkeypatch):
    _, provider, manager, _ = provider_factory("keys")
    real_popen = subprocess.Popen
    observed = []

    def launch(*args, **kwargs):
        observed.append(dict(kwargs["env"]))
        kwargs["env"].pop("OPENAI_API_KEY", None)  # Observe canary then prevent any model traffic.
        return real_popen(*args, **kwargs)

    monkeypatch.setattr(subprocess, "Popen", launch)
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-generic-key")
    monkeypatch.setenv("CAIRN_MEMORY_OPENAI_API_KEY", "synthetic-dedicated-key")
    monkeypatch.setenv("NODE_OPTIONS", "--invalid-host-option")
    for operation, arguments in [("capture", {"batchId": "synthetic-batch", "messages": [{"role": "user", "content": "Synthetic source"}]}),
                                 ("recall", {"query": "Synthetic"})]:
        assert call(manager, operation, **arguments)["error"]["code"] == "model_not_configured"
        assert observed[-1] == {"LANG": "C.UTF-8", "PATH": "/usr/bin:/bin", "OPENAI_API_KEY": "synthetic-dedicated-key"}
    memory = call(manager, "remember", content="Synthetic manual source")["value"]["memory"]
    for operation, arguments in [("inspect", {}), ("correct", {"memoryId": memory["id"], "expectedRevision": memory["revision"], "content": "Changed"}),
                                 ("forget", {"memoryId": memory["id"], "expectedRevision": 999})]:
        call(manager, operation, **arguments)
        assert observed[-1] == {"LANG": "C.UTF-8", "PATH": "/usr/bin:/bin"}
    for authority in [{"capture_qualification": "source-bound-v2"}, {"ownerId": "foreign"}, {"timeout": 999}]:
        result = call(manager, "capture", batchId="invalid", messages=[{"role": "user", "content": "Source"}], **authority)
        assert not result["ok"]
    monkeypatch.delenv("CAIRN_MEMORY_OPENAI_API_KEY")
    call(manager, "recall", query="Synthetic")
    assert observed[-1].get("OPENAI_API_KEY", "") == ""


def test_capture_config_remains_bound_to_session_and_context(provider_factory):
    home, provider, manager, config = provider_factory("binding")
    assert manager.prefetch_all("Must not capture") == ""
    manager.sync_all("Unrequested", "Unrequested")
    manager.on_session_end([{"role": "user", "content": "Unrequested"}])
    assert not (home / "cairn").exists()
    provider.save_config({key: value for key, value in config.items() if key != "capture_qualification"}, str(home))
    with pytest.raises(ValueError, match="cairn_profile_binding_changed"):
        provider.initialize("changed", hermes_home=str(home), platform="cli", agent_context="primary")
    assert not call(manager, "capture", batchId="blocked", messages=[])["ok"]
    for context in ["subagent", "cron", None]:
        with pytest.raises(ValueError, match="cairn_unsupported_context"):
            provider.initialize("invalid", hermes_home=str(home), platform="cli", agent_context=context)


def test_bridge_applies_operation_deadlines_and_fixed_mode_arguments(provider_factory, monkeypatch):
    _, provider, _, config = provider_factory("bridge-parameters")
    module = importlib.import_module(provider.__class__.__module__)
    spec = importlib.util.spec_from_file_location("synthetic_parameter_bridge", Path(module.__file__).with_name("bridge.py"))
    bridge = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bridge)
    observations = {}

    @contextmanager
    def deadline(seconds):
        observations["helper"] = seconds
        yield

    @asynccontextmanager
    async def streams(parameters, **kwargs):
        observations["parameters"] = parameters
        yield (object(), object())

    class Session:
        def __init__(self, *args, read_timeout_seconds):
            observations["sdk"] = read_timeout_seconds

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def initialize(self):
            pass

        async def list_tools(self):
            return SimpleNamespace(next_cursor=None, tools=[])

        async def call_tool(self, name, arguments):
            observations["call"] = (name, arguments)
            return SimpleNamespace(content=[SimpleNamespace(type="text", text='{"ok":true,"value":{}}')])

    monkeypatch.setattr(bridge.anyio, "fail_after", deadline)
    monkeypatch.setattr(bridge, "stdio_client", streams)
    monkeypatch.setattr(bridge, "ClientSession", Session)
    for enabled, source_context in [(False, False), (False, True), (True, False), (True, True)]:
        for operation in ["list", "recall_memory", "capture_memory"]:
            observations.clear()
            request = {"node_path": config["node_path"], "executable_path": config["executable_path"],
                       "database": "/synthetic/unused.sqlite", "owner": "synthetic-owner",
                       "operation": "list" if operation == "list" else "call"}
            if enabled:
                request["capture_qualification"] = "source-bound-v2"
            if source_context:
                request["recall_context"] = "source-evidence"
            if operation != "list":
                request.update(name=operation, arguments={"synthetic": True})
            anyio.run(bridge.exchange, request)
            assert observations["helper"] == (125 if operation == "capture_memory" else 35)
            assert observations["sdk"] == (120 if operation == "capture_memory" else 30)
            expected = [config["executable_path"], "--db", "/synthetic/unused.sqlite", "--owner", "synthetic-owner"]
            if enabled:
                expected += ["--capture-qualification", "source-bound-v2"]
            assert observations["parameters"].args == expected
            assert observations["parameters"].command == config["node_path"]


@pytest.mark.parametrize("action", ["timeout", "shutdown"])
def test_capture_deadline_or_shutdown_reaps_active_helper_and_sdk_without_retry(provider_factory, monkeypatch, tmp_path, action):
    _, provider, manager, _ = provider_factory("bounded-" + action)
    module = importlib.import_module(provider.__class__.__module__)
    assert module.TIMEOUT_SECONDS == 45 and module.CAPTURE_TIMEOUT_SECONDS == 135
    bridge_spec = importlib.util.spec_from_file_location("synthetic_cairn_bridge", Path(module.__file__).with_name("bridge.py"))
    bridge = importlib.util.module_from_spec(bridge_spec)
    bridge_spec.loader.exec_module(bridge)
    assert (bridge.SDK_TIMEOUT_SECONDS, bridge.HELPER_TIMEOUT_SECONDS) == (30, 35)
    assert (bridge.CAPTURE_SDK_TIMEOUT_SECONDS, bridge.CAPTURE_HELPER_TIMEOUT_SECONDS) == (120, 125)
    marker = tmp_path / (action + "-started")
    hanging = tmp_path / (action + "-hanging.mjs")
    hanging.write_text("import fs from 'node:fs';fs.writeFileSync(" + json.dumps(str(marker)) + ",String(process.pid));setInterval(()=>{},1000);\n")
    provider._config["executable_path"] = str(hanging)
    monkeypatch.setattr(module, "CAPTURE_TIMEOUT_SECONDS", 2)
    real_popen = subprocess.Popen
    launches = []

    def launch(*args, **kwargs):
        process = real_popen(*args, **kwargs)
        launches.append(process.pid)
        return process

    monkeypatch.setattr(subprocess, "Popen", launch)
    results = []
    worker = threading.Thread(target=lambda: results.append(call(manager, "capture", batchId="uncertain", messages=[{"role": "user", "content": "Synthetic"}])))
    worker.start()
    deadline = time.monotonic() + 5
    while not marker.exists() and time.monotonic() < deadline:
        time.sleep(0.02)
    assert marker.exists()
    child_pid = int(marker.read_text())
    helper_pid = provider._process.pid
    if action == "shutdown":
        manager.shutdown_all()
    worker.join(timeout=8)
    assert not worker.is_alive() and len(results) == 1 and not results[0]["ok"]
    assert provider._process is None
    assert launches == [helper_pid], "No automatic retry after uncertain capture"
    for pid in [helper_pid, child_pid]:
        assert not psutil.pid_exists(pid) or psutil.Process(pid).status() == psutil.STATUS_ZOMBIE
