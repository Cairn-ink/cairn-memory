"""Pinned native host and installed public engine; synthetic sources/HTTP only."""

import hashlib
import importlib
import base64
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import time
from unittest.mock import MagicMock, patch

import pytest

from test_agent_conversation import isolated_profile, response  # noqa: F401

HOST_ROOT = Path.cwd().resolve()
HOST_HASHES = {
    "agent/memory_manager.py": "9abf3b8610f6abe8d77f30b779ded8fb52a9ba48279453c3f2480a4c2c240194",
    "agent/memory_provider.py": "8970de8fd26dd6829220261d720fc0bb7abc9c162a54a654275b56f5ee5a267c",
    "run_agent.py": "51e28e8905ebe1c9442e0c67a7eca0d53e6315414cf8c6927501b130d7650872",
    "hermes_cli/memory_setup.py": "87200e3997df3c6ac12266079554778384fb0565b5b994689d47f438a53bd156",
    "plugins/memory/__init__.py": "c77c8d9e7f554a62552c5b6777e4e1291a8a37434cd17ecdf43ffe563f453154",
    "hermes_constants.py": "6e6e47b32e4aa8350afbd69e39e7d9648edc2c14558ce7464c2ff7ba3453a3a0",
}
CANONICAL = {"capture_source_policy": "indexed-staged-v1"}
ACCESS = {"capture_evidence_access": "staged-v1"}
BASE_TOOLS = {"remember_memory", "recall_memory", "inspect_memory", "correct_memory", "forget_memory"}
EVIDENCE_TOOLS = {"inspect_capture_evidence", "discard_capture_evidence"}


def dispose_all(callbacks):
    errors = []
    while callbacks:
        try:
            callbacks.pop()()
        except BaseException as exc:
            errors.append(exc)
    if errors:
        raise BaseExceptionGroup("synthetic cleanup failures", errors)


@pytest.fixture
def native(isolated_profile, request):
    # The shared venv's editable finder must not silently load the retained tree.
    for name, relative in [("agent.memory_manager", "agent/memory_manager.py"),
                           ("agent.memory_provider", "agent/memory_provider.py"),
                           ("run_agent", "run_agent.py"),
                           ("hermes_cli.memory_setup", "hermes_cli/memory_setup.py"),
                           ("plugins.memory", "plugins/memory/__init__.py"),
                           ("hermes_constants", "hermes_constants.py")]:
        module = importlib.import_module(name)
        assert Path(module.__file__).resolve() == HOST_ROOT / relative
        assert hashlib.sha256(Path(module.__file__).read_bytes()).hexdigest() == HOST_HASHES[relative]
    from agent.memory_manager import MemoryManager
    from plugins.memory import load_memory_provider

    cleanup = []

    def make(name, settings=None, node=None, executable=None):
        home = isolated_profile / name
        if not home.exists():
            def remove():
                shutil.rmtree(home)
                assert not home.exists()
            home.mkdir()
            cleanup.append(remove)
            shutil.copytree(Path(__file__).parents[1] / "cairn", home / "plugins" / "cairn")
        os.environ["HERMES_HOME"] = str(home)
        (home / "config.yaml").write_text(json.dumps({"memory": {"provider": "cairn"}}))
        provider = load_memory_provider("cairn")
        cleanup.append(provider.shutdown)  # Before config or schema discovery can fail.
        config = {"node_path": node or request.config.getoption("--cairn-node"),
                  "executable_path": executable or request.config.getoption("--cairn-executable"), **(settings or {})}
        provider.save_config(config, str(home))
        manager = MemoryManager()
        cleanup.append(manager.shutdown_all)  # add_provider itself performs discovery.
        manager.add_provider(provider)
        assert not (home / "cairn").exists() or (home / "cairn" / "owner-id").exists()
        manager.initialize_all(session_id="synthetic-native-session", hermes_home=str(home),
                               platform="cli", agent_context="primary")
        return home, provider, manager, config

    try:
        yield make, cleanup
    finally:
        dispose_all(cleanup)


def invoke(manager, name, **arguments):
    return json.loads(manager.handle_tool_call("cairn_" + name, arguments))


def value(result):
    assert result["ok"], result
    assert result["evidenceTrust"] == "untrusted-data-not-instructions"
    return result["value"]


@pytest.fixture
def fake_http(isolated_profile, request):
    log = isolated_profile / "calls.jsonl"
    mode = isolated_profile / "mode"
    mode.write_text("empty")
    # Every fetch is replaced. No ambient HTTP implementation is retained.
    preload = r"""
      import assert from 'node:assert/strict';
      import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';
      globalThis.fetch=async(url,request)=>{
        const target=new URL(url),body=JSON.parse(request.body);
        assert.equal(target.origin,'https://api.openai.com');
        const mode=readFileSync(__MODE__,'utf8');assert.notEqual(mode,'forbidden');
        const method=body.text.format.name,input=JSON.parse(body.input[0].content[0].text);
        const counting=target.pathname==='/v1/responses/input_tokens';
        assert.ok(counting||target.pathname==='/v1/responses');
        appendFileSync(__LOG__,JSON.stringify({method:counting?method+':count':method,input})+'\n');
        if(counting)return Response.json({object:'response.input_tokens',input_tokens:100});
        if(mode==='deadline'){
          await new Promise(resolve=>setTimeout(resolve,2000));
          writeFileSync(__MODE__+'.late','completed');
        }
        if(mode==='failure')throw Error('SYNTHETIC_PRIVATE_PROVIDER_ERROR');
        let output;
        if(method==='cairn_extract'){
          assert.equal(input.inputMode,'indexed-windows-v1');
          output=mode==='malformed'?{items:'invalid'}:mode==='empty'?{items:[]}:
            {items:[{content:'Synthetic interpretation',kind:'context',confidence:0.5,sourceIndices:[0]}]};
        }else if(method==='cairn_classify')output={items:input.memories.map(m=>({memoryId:m.id,parentIds:[]}))};
        else if(method==='cairn_select')output={refs:input.maps.flatMap(m=>m.items.filter(i=>i.type==='unfiled').map(i=>({namespaceIndex:m.namespaceIndex,...i.ref})))};
        else if(method==='cairn_rank')output={refs:input.candidates.map(i=>({namespaceIndex:i.namespaceIndex,memoryId:i.memory.id,revision:i.memory.revision}))};
        else assert.fail('No qualifier or other model stage permitted');
        return Response.json({object:'response',model:body.model,status:'completed',error:null,incomplete_details:null,
          output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(output)}]}],
          usage:{input_tokens:100,output_tokens:30,total_tokens:130}});
      };
    """.replace("__MODE__", json.dumps(str(mode))).replace("__LOG__", json.dumps(str(log)))
    wrapper = isolated_profile / "synthetic-node"
    wrapper.write_text("#!/bin/sh\nexec " + shlex.quote(request.config.getoption("--cairn-node")) + " " +
                       shlex.quote("--import=data:text/javascript;base64," + base64.b64encode(preload.encode()).decode()) + ' "$@"\n')
    wrapper.chmod(0o700)

    def calls():
        return [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
    return str(wrapper), mode, calls


def test_canonical_configuration_discovery_and_cold_access(native):
    make, _ = native
    home, provider, manager, _ = make("canonical-red", {"capture_source_policy": "indexed-staged-v1"})
    assert {tool["name"] for tool in manager.get_all_tool_schemas()} == {
        "cairn_" + name for name in ("remember_memory", "recall_memory", "inspect_memory",
                                   "correct_memory", "forget_memory", "capture_memory",
                                   "inspect_capture_evidence", "discard_capture_evidence")}
    assert not (home / "cairn").exists()
    assert manager.prefetch_all("Unrequested conversation") == ""
    manager.sync_all("unrequested user", "unrequested assistant")
    manager.on_session_end([{"role": "user", "content": "not submitted"}])
    assert not (home / "cairn").exists()
    assert json.loads(provider.handle_tool_call("cairn_inspect_capture_evidence", {"batchId": "absent"},
                                             platform="gateway"))["error"]["code"] == "cairn_unsupported_context"
    assert not (home / "cairn").exists()
    provider.save_config({"node_path": provider._config["node_path"],
                          "executable_path": provider._config["executable_path"], **ACCESS}, str(home))
    with pytest.raises(ValueError, match="cairn_profile_binding_changed"):
        provider.initialize("changed", hermes_home=str(home), platform="cli", agent_context="primary")
    assert json.loads(provider.handle_tool_call("cairn_capture_memory", {}))["error"]["code"] == "cairn_not_initialized"


def test_strict_settings_and_real_canonical_wizard(native, monkeypatch):
    make, _ = native
    home, provider, _, config = make("wizard", CANONICAL)
    original = (home / "cairn.json").read_bytes()
    for field, valid in [("capture_source_policy", "indexed-staged-v1"), ("capture_evidence_access", "staged-v1")]:
        for bad in [None, True, False, 1, "", " " + valid, valid + " ", "unknown", [], {}]:
            with pytest.raises(ValueError, match="cairn_invalid_configuration"):
                provider.save_config({**config, field: bad}, str(home))
            assert (home / "cairn.json").read_bytes() == original and not (home / "cairn").exists()
    for bad in [None, True, "source-bound-v2"]:
        with pytest.raises(ValueError):
            provider.save_config({**config, "capture_qualification": bad}, str(home))
    for deadline in [None, 1, "0", "01", "１２", "110001", "9" * 50]:
        with pytest.raises(ValueError):
            provider.save_config({**config, "capture_deadline_ms": deadline}, str(home))
    for deadline in ["1", "110000"]:
        provider.save_config({**config, "capture_deadline_ms": deadline}, str(home))
    from hermes_cli import memory_setup
    schema = provider.get_config_schema()
    assert "when" not in next(f for f in schema if f["key"] == "capture_deadline_ms")
    values, secrets = {}, {}
    answers = {"node_path": config["node_path"], "executable_path": config["executable_path"],
               "capture_source_policy": "indexed-staged-v1", "capture_deadline_ms": "1500"}
    prompts = iter(answers.get(field["key"], "") for field in schema)
    monkeypatch.setattr(memory_setup, "_prompt", lambda *args, **kwargs: next(prompts))
    assert memory_setup._prompt_schema_fields("cairn", schema, values, secrets)
    provider.save_config(values, str(home))
    assert json.loads((home / "cairn.json").read_text()) == answers
    assert not secrets and not (home / "cairn").exists()


def test_all_capture_access_recovery_inventories_and_key_isolation(native, monkeypatch):
    make, _ = native
    real_popen, observed = subprocess.Popen, []

    def launch(*args, **kwargs):
        observed.append(dict(kwargs["env"]))
        kwargs["env"].pop("OPENAI_API_KEY", None)  # Observe synthetic canary; never send it.
        return real_popen(*args, **kwargs)
    monkeypatch.setattr(subprocess, "Popen", launch)
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-generic-never-forward")
    monkeypatch.setenv("CAIRN_MEMORY_OPENAI_API_KEY", "synthetic-dedicated-canary")
    monkeypatch.setenv("NODE_OPTIONS", "--invalid-host-option")
    for capture in [{}, {"capture_qualification": "source-bound-v2"}, CANONICAL]:
        for access in [{}, ACCESS]:
            for recovery in [{}, {"classification_recovery": "guarded-v1"}]:
                settings = {**capture, **access, **recovery}
                home, provider, manager, _ = make("inventory-" + str(len(observed)), settings)
                expected = BASE_TOOLS | ({"capture_memory"} if capture else set())
                if access or capture == CANONICAL:
                    expected |= EVIDENCE_TOOLS
                if recovery:
                    expected |= {"inspect_capture_admission", "classify_unfiled_memories"}
                schemas = manager.get_all_tool_schemas()
                assert {tool["name"] for tool in schemas} == {"cairn_" + name for name in expected}
                assert manager.get_all_tool_names() == {"cairn_" + name for name in expected}
                schemas[0]["parameters"].clear()
                assert manager.get_all_tool_schemas()[0]["parameters"]
                assert observed[-1] == {"LANG": "C.UTF-8", "PATH": "/usr/bin:/bin"}
                assert not (home / "cairn").exists()
                if access or capture == CANONICAL:
                    assert value(invoke(manager, "inspect_capture_evidence", batchId="absent"))["evidence"] is None
                    assert observed[-1] == {"LANG": "C.UTF-8", "PATH": "/usr/bin:/bin"}
                    invoke(manager, "discard_capture_evidence", batchId="absent")
                    assert "OPENAI_API_KEY" not in observed[-1]
                if capture:
                    result = invoke(manager, "capture_memory", batchId="missing-model", messages=[{"role": "user", "content": "Synthetic"}])
                    assert result["error"]["code"] == "model_not_configured"
                    assert observed[-1] == {"LANG": "C.UTF-8", "PATH": "/usr/bin:/bin", "OPENAI_API_KEY": "synthetic-dedicated-canary"}
                else:
                    assert "error" in invoke(manager, "capture_memory", batchId="blocked", messages=[])


@pytest.mark.parametrize("mode", ["empty", "malformed", "failure", "nonempty"])
def test_actual_canonical_capture_cold_recovery_and_replay_fences(native, fake_http, monkeypatch, mode):
    make, _ = native
    node, mode_file, calls = fake_http
    mode_file.write_text(mode)
    monkeypatch.setenv("CAIRN_MEMORY_OPENAI_API_KEY", "synthetic-fake-only-key")
    home, provider, manager, _ = make("lifecycle", CANONICAL, node)
    assert not calls()
    messages = [{"role": "assistant", "content": "a" * 1100 + " LATE_ASSISTANT_SUGGESTION"},
                {"role": "user", "content": "b" * 1100 + " LATE_USER_CORRECTION"}]
    batch = {"batchId": "synthetic-canonical", "messages": messages}
    captured = invoke(manager, "capture_memory", **batch)
    if mode in {"empty", "nonempty"}:
        assert value(captured)["qualificationStatus"] == "not-requested"
    else:
        assert captured["error"]["code"] == ("extraction_failed" if mode == "failure" else "invalid_model_output")
        assert "SYNTHETIC_PRIVATE" not in json.dumps(captured)
    saved = value(invoke(manager, "inspect_capture_evidence", batchId=batch["batchId"]))["evidence"]
    assert saved["view"]["format"] == "canonical-messages-v1"
    assert [{"role": m["role"], "content": m["content"]} for m in saved["view"]["messages"]] == messages
    assert saved["view"]["messages"][0]["id"] == hashlib.sha256(json.dumps(
        ["cairn.mcp.submitted-message.v1", batch["batchId"], 0], separators=(",", ":")).encode()).hexdigest()
    assert not any(c["method"].startswith("cairn_qualif") for c in calls())
    memories = value(invoke(manager, "inspect_memory"))["memories"]
    before_replay = calls()
    replay = invoke(manager, "capture_memory", **batch)
    if mode in {"empty", "nonempty"}:
        assert value(replay)["duplicate"]
    else:
        assert replay["error"]["code"] == "capture_evidence_closed"
    assert calls() == before_replay
    assert value(invoke(manager, "inspect_capture_evidence", batchId=batch["batchId"]))["evidence"]["expiresAt"] == saved["expiresAt"]
    if mode == "nonempty":
        memory_id = captured["value"]["admission"]["memories"][0]["id"]
        detail = value(invoke(manager, "inspect_memory", memoryId=memory_id, includeQualification=True))
        assert detail["qualification"] is None
        assert detail["receipts"][0]["role"] == "assistant" and detail["receipts"][0]["excerpt"] == "a" * 800
        assert "LATE_" not in json.dumps(detail)
        assert value(invoke(manager, "capture_memory", **batch))["duplicate"]
        assert value(invoke(manager, "inspect_capture_evidence", batchId=batch["batchId"]))["evidence"]["expiresAt"] == saved["expiresAt"]
        recall = value(invoke(manager, "recall_memory", query="synthetic"))
        assert "LATE_" not in json.dumps(recall)
    else:
        assert memories == []
    before = calls()
    assert invoke(manager, "capture_memory", **{**batch, "messages": [{"role": "user", "content": "different"}]})["error"]["code"] == "event_payload_conflict"
    assert calls() == before
    manager.shutdown_all()
    monkeypatch.delenv("CAIRN_MEMORY_OPENAI_API_KEY")
    mode_file.write_text("forbidden")
    _, _, different_policy, _ = make("lifecycle", {"capture_qualification": "source-bound-v2", **ACCESS}, node)
    assert invoke(different_policy, "capture_memory", **batch)["error"]["code"] == "event_payload_conflict"
    assert calls() == before
    different_policy.shutdown_all()
    _, cold_provider, cold, _ = make("lifecycle", ACCESS, node)
    assert value(invoke(cold, "inspect_capture_evidence", batchId=batch["batchId"]))["evidence"] == saved
    assert "error" in invoke(cold, "capture_memory", **batch)
    other_home, _, other, _ = make("foreign", ACCESS, node)
    assert value(invoke(other, "inspect_capture_evidence", batchId=batch["batchId"]))["evidence"] is None
    assert (other_home / "cairn" / "owner-id").read_text() != (home / "cairn" / "owner-id").read_text()
    for authority in [{"ownerId": "foreign"}, {"profile": "foreign"}, {"database": "other"},
                      {"captureSourcePolicy": "indexed-staged-v1"}, {"capture_evidence_access": "staged-v1"}, {"node_path": node}]:
        assert not invoke(cold, "inspect_capture_evidence", batchId=batch["batchId"], **authority)["ok"]
        assert not invoke(cold, "discard_capture_evidence", batchId=batch["batchId"], **authority)["ok"]
    assert value(invoke(cold, "inspect_capture_evidence", batchId=batch["batchId"]))["evidence"] == saved
    value(invoke(cold, "discard_capture_evidence", batchId=batch["batchId"]))
    assert value(invoke(cold, "inspect_capture_evidence", batchId=batch["batchId"]))["evidence"]["view"] is None
    assert value(invoke(cold, "inspect_memory"))["memories"] == memories
    cold.shutdown_all()
    _, _, reopened, _ = make("lifecycle", CANONICAL, node)
    assert invoke(reopened, "capture_memory", **batch)["error"]["code"] == "capture_evidence_closed"
    assert calls() == before


def near_native_arguments():
    # JSON ensure_ascii escaping, not UTF-16 source units or MCP frame bytes.
    content = "こんにちは" * 460 + '"\\' * 200 + "x" * 300
    arguments = {"batchId": "near-native", "messages": [{"role": "user", "content": content}] * 4}
    assert 59000 <= len(json.dumps(arguments)) <= 60000
    return arguments


def test_real_native_unicode_boundary_and_pretransport_refusal(native, fake_http, monkeypatch):
    make, _ = native
    node, _, calls = fake_http
    monkeypatch.setenv("CAIRN_MEMORY_OPENAI_API_KEY", "synthetic-fake-only-key")
    home, provider, manager, _ = make("near-native", CANONICAL, node)
    arguments = near_native_arguments()
    assert value(invoke(manager, "capture_memory", **arguments))["qualificationStatus"] == "not-requested"
    saved = value(invoke(manager, "inspect_capture_evidence", batchId=arguments["batchId"]))["evidence"]
    assert saved["view"]["messages"][0]["content"] == arguments["messages"][0]["content"]
    _, _, denied, _ = make("oversized-native", CANONICAL, node)
    before = calls()
    over = {"batchId": "over-native", "messages": [{"role": "user", "content": "中" * 4000}] * 3}
    assert len(json.dumps(over)) > 60000
    result = invoke(denied, "capture_memory", **over)
    assert result["error"]["code"] == "invalid_input"
    assert "中" not in json.dumps(result, ensure_ascii=False)
    assert not (home.parent / "oversized-native" / "cairn").exists()
    assert calls() == before and provider._process is None


def test_canonical_deadline_preserves_source_and_blocks_late_admission(native, fake_http, monkeypatch):
    make, _ = native
    node, mode, calls = fake_http
    mode.write_text("deadline")
    monkeypatch.setenv("CAIRN_MEMORY_OPENAI_API_KEY", "synthetic-fake-only-key")
    _, _, manager, _ = make("canonical-deadline", {**CANONICAL, "capture_deadline_ms": "1000"}, node)
    batch = {"batchId": "deadline", "messages": [{"role": "assistant", "content": "a" * 1200 + " late suggestion"}]}
    assert invoke(manager, "capture_memory", **batch)["error"]["code"] == "model_timeout"
    marker, until = Path(str(mode) + ".late"), time.monotonic() + 5
    while not marker.exists() and time.monotonic() < until:
        time.sleep(0.02)
    assert marker.read_text() == "completed", "synthetic abort-ignoring extraction actually completed late"
    assert value(invoke(manager, "inspect_memory"))["memories"] == []
    assert value(invoke(manager, "inspect_capture_evidence", batchId=batch["batchId"]))["evidence"]["view"]["messages"][0]["content"] == batch["messages"][0]["content"]
    before = calls()
    assert invoke(manager, "capture_memory", **batch)["error"]["code"] == "capture_evidence_closed"
    assert calls() == before and [c["method"] for c in before] == ["cairn_extract:count", "cairn_extract"]


def test_configuration_envelope_can_refuse_otherwise_native_legal_input(native, fake_http, isolated_profile, request, monkeypatch):
    make, _ = native
    wrapper, _, calls = fake_http
    directory = isolated_profile
    while len(str(directory)) < 3550:
        directory /= "d" * 180
        directory.mkdir()
    node = directory / "node"
    executable = directory / "cairn.mjs"
    node.symlink_to(wrapper)
    executable.symlink_to(request.config.getoption("--cairn-executable"))
    monkeypatch.setenv("CAIRN_MEMORY_OPENAI_API_KEY", "synthetic-fake-only-key")
    home, provider, manager, config = make("envelope", CANONICAL, str(node), str(executable))
    arguments = near_native_arguments()
    request_payload = {"operation": "call", "database": str(home / "cairn" / "memory.sqlite"),
                       "owner": "hermes-" + "0" * 36, **config, "name": "capture_memory", "arguments": arguments}
    assert len(json.dumps(arguments)) <= 60000 and len(json.dumps(request_payload).encode()) > 65537
    result = invoke(manager, "capture_memory", **arguments)
    assert result["error"]["code"] == "cairn_transport_failed"
    assert "中" not in json.dumps(result, ensure_ascii=False)
    assert not (home / "cairn" / "memory.sqlite").exists()
    assert not calls() and provider._process is None


def test_real_sdk_bridge_encoded_output_ceiling(native, isolated_profile, request):
    make, _ = native
    home, provider, _, _ = make("encoded-result", ACCESS)
    executable = request.config.getoption("--cairn-executable")
    fake = isolated_profile / "synthetic-result-server.mjs"
    fake.write_text("""
      import {createRequire} from 'node:module';
      const require=createRequire(__EXECUTABLE__);
      const {McpServer}=await import(require.resolve('@modelcontextprotocol/server'));
      const {serveStdio}=await import(require.resolve('@modelcontextprotocol/server/stdio'));
      const z=await import(require.resolve('zod/v4'));
      const server=new McpServer({name:'synthetic-result-boundary',version:'1.0.0'});
      server.registerTool('inspect_memory',{inputSchema:z.object({units:z.number()})},({units})=>({
        content:[{type:'text',text:JSON.stringify({ok:true,value:{text:'中'.repeat(units)}})}]}));
      const handle=serveStdio(()=>server);
      process.stdin.once('end',()=>{void handle.close();});
    """.replace("__EXECUTABLE__", json.dumps(executable)))
    provider._config["executable_path"] = str(fake)
    result = provider._request("call", home / "unused.sqlite", "synthetic-owner", name="inspect_memory", arguments={"units": 40000})
    assert len(result["value"]["text"]) == 40000
    assert len(json.dumps(result).encode()) <= 262144
    assert len(json.dumps({"ok": True, "value": {"text": "中" * 46000}}).encode()) > 262144
    with pytest.raises(ValueError, match="cairn_transport_failed"):
        provider._request("call", home / "unused.sqlite", "synthetic-owner", name="inspect_memory", arguments={"units": 46000})
    assert provider._process is None and not (home / "unused.sqlite").exists()


def test_scripted_actual_agent_dispatch_and_missing_model_retention(native, fake_http, monkeypatch):
    make, cleanup = native
    node, mode, calls = fake_http
    home, _, manager, _ = make("agent", CANONICAL, node)
    batch = {"batchId": "missing-key", "messages": [{"role": "assistant", "content": "late " * 250 + "detail"}]}
    assert invoke(manager, "capture_memory", **batch)["error"]["code"] == "model_not_configured"
    assert value(invoke(manager, "inspect_memory"))["memories"] == []
    assert value(invoke(manager, "inspect_capture_evidence", batchId=batch["batchId"]))["evidence"]["view"]["messages"][0]["content"] == batch["messages"][0]["content"]
    assert not calls()
    (home / "config.yaml").write_text(json.dumps({"model": {"context_length": 256000},
        "tools": {"tool_search": {"enabled": "off"}},
        "memory": {"provider": "cairn", "memory_enabled": False, "user_profile_enabled": False}}))
    os.environ["HERMES_HOME"] = str(home)
    monkeypatch.setenv("CAIRN_MEMORY_OPENAI_API_KEY", "synthetic-fake-only-key")
    from run_agent import AIAgent
    with patch("agent.process_bootstrap.OpenAI"):
        agent = AIAgent(api_key="synthetic-no-network", base_url="http://127.0.0.1:1/v1", model="synthetic-model",
            platform="cli", session_id="synthetic-agent", enabled_toolsets=["memory"], skip_context_files=True,
            skip_memory=False, skip_background_review=True, quiet_mode=True, max_iterations=4)
        cleanup.append(agent.close)
        agent.compression_enabled = False
        agent.save_trajectories = False
        agent._use_prompt_caching = False
        agent.client = MagicMock()
        observed = []

        def complete(**kwargs):
            observed.append(kwargs)
            return response("cairn_capture_memory", {**batch, "batchId": "scripted-agent"}) if len(observed) == 1 else response()
        agent.client.chat.completions.create.side_effect = complete
        agent.run_conversation("Explicit synthetic capture, not natural tool selection.")
        tool_results = [m for m in observed[-1]["messages"] if m.get("role") == "tool"]
        assert len(observed) == 2 and len(tool_results) == 1
        assert value(json.loads(tool_results[0]["content"]))["qualificationStatus"] == "not-requested"
        assert [c["method"] for c in calls()] == ["cairn_extract:count", "cairn_extract"]


def test_owned_cleanup_attempts_every_disposer_even_after_failure(native):
    make, cleanup = native
    home, provider, _, _ = make("intentional-failure", ACCESS)
    callbacks = list(cleanup)
    cleanup.clear()
    order = []
    callbacks.append(lambda: order.append("last"))

    def fail():
        order.append("failure")
        raise AssertionError("intentional fixture failure")
    callbacks.append(fail)
    with pytest.raises(ExceptionGroup, match="synthetic cleanup failures"):
        dispose_all(callbacks)
    assert order == ["failure", "last"]
    assert not home.exists() and provider._closed and provider._process is None
