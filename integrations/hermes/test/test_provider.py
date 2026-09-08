import json
from pathlib import Path
import shutil
import subprocess
import threading
import time

import psutil

import pytest

from agent.memory_manager import MemoryManager
from plugins.memory import load_memory_provider, list_memory_provider_names


@pytest.fixture
def install(tmp_path, monkeypatch, request):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    config = {"node_path": request.config.getoption("--cairn-node"),
              "executable_path": request.config.getoption("--cairn-executable")}

    def make(name):
        home = tmp_path / name
        shutil.copytree(Path(__file__).parents[1] / "cairn", home / "plugins" / "cairn")
        monkeypatch.setenv("HERMES_HOME", str(home))
        (home / "config.yaml").write_text("memory:\n  provider: cairn\n")
        assert "cairn" in list_memory_provider_names()
        provider = load_memory_provider("cairn")
        assert provider is not None
        provider.save_config(config, str(home))
        assert provider.is_available()
        manager = MemoryManager()
        manager.add_provider(provider)
        assert not (home / "cairn").exists()
        assert not json.loads(manager.handle_tool_call("cairn_inspect_memory", {}))["ok"]
        assert not (home / "cairn").exists()
        manager.initialize_all(session_id="synthetic-first", hermes_home=str(home),
                               platform="cli", agent_context="primary")
        return home, provider, manager

    return make


def call(manager, name, **args):
    return json.loads(manager.handle_tool_call("cairn_" + name + "_memory", args))


def value(result):
    assert result["ok"], result
    assert result["evidenceTrust"] == "untrusted-data-not-instructions"
    return result["value"]


def test_real_discovery_dispatch_lifecycle_and_isolation(install, monkeypatch):
    home, provider, manager = install("first")
    schema = manager.get_all_tool_schemas()[0]
    schema["parameters"].clear()
    assert manager.get_all_tool_schemas()[0]["parameters"]
    memory = value(call(manager, "remember", content="Synthetic preference: use short examples."))["memory"]
    detail = value(call(manager, "inspect", memoryId=memory["id"]))
    assert detail["receipts"][0]["excerpt"] == detail["memory"]["content"]
    assert call(manager, "recall", query="examples")["error"]["code"] == "model_not_configured"
    assert not call(manager, "remember", content="wrong", ownerId="foreign")["ok"]
    manager.shutdown_all()
    moved = home.with_name("relocated")
    shutil.move(str(home), str(moved))
    home = moved
    monkeypatch.setenv("HERMES_HOME", str(home))
    reloaded = load_memory_provider("cairn")
    second = MemoryManager()
    second.add_provider(reloaded)
    second.initialize_all(session_id="synthetic-restarted", hermes_home=str(home), platform="cli", agent_context="primary")
    assert value(call(second, "inspect", memoryId=memory["id"]))["memory"]["id"] == memory["id"]
    corrected = value(call(second, "correct", memoryId=memory["id"], expectedRevision=memory["revision"],
                           content="Synthetic preference: use detailed examples."))["memory"]
    assert call(second, "forget", memoryId=memory["id"], expectedRevision=memory["revision"])["error"]["code"] == "revision_conflict"
    other_home, other, isolated = install("second")
    assert not call(isolated, "inspect", memoryId=memory["id"])["ok"]
    assert (other_home / "cairn" / "owner-id").read_text() != (home / "cairn" / "owner-id").read_text()
    value(call(second, "forget", memoryId=memory["id"], expectedRevision=corrected["revision"]))
    assert not call(second, "inspect", memoryId=memory["id"])["ok"]
    second.shutdown_all()
    isolated.shutdown_all()


def test_context_hooks_availability_and_transport_fail_closed(install, monkeypatch):
    home, provider, manager = install("boundaries")
    before = call(manager, "inspect")
    assert manager.prefetch_all("Remember this secret conversation") == ""
    manager.sync_all("unrequested user memory", "unrequested assistant memory")
    manager.on_session_end([{"role": "user", "content": "unrequested"}])
    assert call(manager, "inspect") == before
    for context in ["subagent", "cron", "flush", None]:
        provider.initialize("invalid", hermes_home=str(home), platform="cli", agent_context="primary")
        with pytest.raises(ValueError, match="cairn_unsupported_context"):
            provider.initialize("invalid", hermes_home=str(home), platform="cli", agent_context=context)
        assert not call(manager, "remember", content="must not save")["ok"]
    with pytest.raises(ValueError, match="cairn_unsupported_context"):
        provider.initialize("invalid", hermes_home=str(home), platform="telegram", agent_context="primary")
    with monkeypatch.context() as patch:
        patch.setattr(subprocess, "Popen", lambda *args, **kwargs: pytest.fail("availability spawned a process"))
        assert provider.is_available()
    with pytest.raises(ValueError, match="cairn_invalid_configuration"):
        provider.save_config({"command": "shell arbitrary"}, str(home))
    provider.initialize("valid", hermes_home=str(home), platform="cli", agent_context="primary")
    module = __import__(provider.__class__.__module__, fromlist=["TIMEOUT_SECONDS"])
    with monkeypatch.context() as patch:
        patch.setattr(module, "TIMEOUT_SECONDS", 0.001)
        assert call(manager, "inspect")["error"]["code"] == "cairn_transport_failed"
        assert provider._process is None
    assert call(manager, "inspect")["ok"]
    manager.shutdown_all()
    assert not call(manager, "remember", content="after shutdown")["ok"]


def test_explicit_key_allowlist_and_malformed_transport(install, monkeypatch, tmp_path):
    home, provider, manager = install("credentials")
    real_popen = subprocess.Popen
    observed = []

    def inspect_launch(*args, **kwargs):
        observed.append(dict(kwargs["env"]))
        # Observe only a synthetic canary; never permit a paid request in this test.
        kwargs["env"].pop("OPENAI_API_KEY", None)
        return real_popen(*args, **kwargs)

    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-unrelated-host-key")
    monkeypatch.setenv("CAIRN_MEMORY_OPENAI_API_KEY", "synthetic-dedicated-cairn-key")
    monkeypatch.setenv("NODE_OPTIONS", "--invalid-synthetic-host-option")
    monkeypatch.setattr(subprocess, "Popen", inspect_launch)
    assert call(manager, "recall", query="synthetic")["error"]["code"] == "model_not_configured"
    assert observed[-1] == {"LANG": "C.UTF-8", "PATH": "/usr/bin:/bin", "OPENAI_API_KEY": "synthetic-dedicated-cairn-key"}
    assert call(manager, "inspect")["ok"]
    assert "OPENAI_API_KEY" not in observed[-1]
    assert "api_key" not in json.loads((home / "cairn.json").read_text())
    malformed = tmp_path / "malformed.mjs"
    malformed.write_text("console.log('synthetic-private-diagnostic'); process.exit(1);\n")
    provider._config["executable_path"] = str(malformed)
    result = call(manager, "inspect")
    assert result["error"]["code"] == "cairn_transport_failed"
    assert "synthetic-private-diagnostic" not in json.dumps(result)
    assert provider._process is None
    manager.shutdown_all()


def test_corrupt_identity_cannot_fall_back_to_a_new_owner(install):
    home, provider, manager = install("identity")
    assert call(manager, "remember", content="Synthetic identity continuity")["ok"]
    identity = home / "cairn" / "owner-id"
    original = identity.read_text()
    identity.write_text("invalid")
    assert not call(manager, "inspect")["ok"]
    assert identity.read_text() == "invalid"
    identity.unlink()
    assert not call(manager, "inspect")["ok"]
    assert not identity.exists()
    identity.write_text(original)
    assert call(manager, "inspect")["ok"]
    manager.shutdown_all()


def test_shutdown_reaps_active_sdk_server(install, tmp_path):
    _, provider, manager = install("shutdown")
    hanging = tmp_path / "hanging.mjs"
    marker = tmp_path / "started"
    hanging.write_text("import fs from 'node:fs'; fs.writeFileSync(" + json.dumps(str(marker))
                       + ",String(process.pid)); setInterval(()=>{},1000);\n")
    provider._config["executable_path"] = str(hanging)
    results = []
    worker = threading.Thread(target=lambda: results.append(call(manager, "inspect")))
    worker.start()
    deadline = time.monotonic() + 10
    while not marker.exists() and time.monotonic() < deadline:
        time.sleep(0.02)
    assert marker.exists()
    child_pid = int(marker.read_text())
    manager.shutdown_all()
    worker.join(timeout=10)
    assert not worker.is_alive()
    assert not results[0]["ok"]
    assert not psutil.pid_exists(child_pid) or psutil.Process(child_pid).status() == psutil.STATUS_ZOMBIE
    assert provider._process is None
