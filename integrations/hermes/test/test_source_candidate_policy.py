"""Pinned native Hermes and installed Cairn: synthetic source-candidate opt-in only."""

import base64
import importlib.util
import json
from pathlib import Path
import shlex
import shutil
import subprocess
from unittest.mock import MagicMock, patch

import anyio
import pytest

from test_agent_conversation import isolated_profile, response  # noqa: F401


SEED = r"""
import assert from 'node:assert/strict';
const {openMemoryCore}=await import(process.argv[1]);
const namespace={ownerId:process.argv[3],scope:'personal',projectId:null};
const core=openMemoryCore({path:process.argv[2]});
const memories=[];
try {
  for(let index=0;index<1025;index++){
    const marker=`nativemarker${String(index).padStart(5,'0')}`;
    const source=`${marker} retained original source`;
    const saved=core.admit({namespace,memory:{content:`Generic native note ${String(index).padStart(5,'0')}`,
      kind:'fact'},receipts:[{client:'synthetic-native',sessionId:'public-admit',
      eventId:`event-${index}`,role:'user',excerpt:source}]});
    assert.equal(saved.ok,true,JSON.stringify(saved));
    memories.push({id:saved.value.memory.id,source});
  }
  const target=memories.toSorted((a,b)=>a.id.localeCompare(b.id)).at(-1);
  assert.equal(memories.filter(item=>item.id.localeCompare(target.id)<0).length,1024);
  const detail=core.get({namespace,memoryId:target.id});
  assert.equal(detail.ok,true);assert.equal(detail.value.receipts[0].excerpt,target.source);
  process.stdout.write(JSON.stringify(target));
} finally {core.close();}
"""


def fake_node(home, node):
    # The wrapper only substitutes fake HTTP. It never modifies CLI arguments,
    # core options, visible candidates, or the saved Hermes profile.
    preload = r"""
      import assert from 'node:assert/strict';
      import {appendFileSync} from 'node:fs';
      globalThis.fetch=async(url,request)=>{
        const target=new URL(url);
        assert.equal(target.origin,'https://api.openai.com');
        assert.ok(['/v1/responses','/v1/responses/input_tokens'].includes(target.pathname));
        const body=JSON.parse(request.body);
        if(target.pathname.endsWith('/input_tokens'))
          return Response.json({object:'response.input_tokens',input_tokens:100});
        const input=JSON.parse(body.input[0].content[0].text);
        let output;
        if(body.text.format.name==='cairn_select'){
          const matches=input.maps.flatMap(page=>page.items.filter(item=>
            item.label?.split(/\s+/u).includes(input.query)).map(item=>({namespaceIndex:page.namespaceIndex,
            ...(item.type==='unfiled'?item.ref:{memoryId:item.ref.childId,revision:item.ref.childRevision})})));
          appendFileSync(__LOG__,JSON.stringify({method:'select',matched:matches.length})+'\n');
          output={refs:matches.slice(0,input.maxRefs)};
        }else if(body.text.format.name==='cairn_rank'){
          output={refs:input.candidates.filter(item=>item.receipts?.some(receipt=>
            receipt.excerpt.split(/\s+/u).includes(input.query))).slice(0,input.limit).map(item=>({
            namespaceIndex:item.namespaceIndex,memoryId:item.memory.id,revision:item.memory.revision}))};
          appendFileSync(__LOG__,JSON.stringify({method:'rank',matched:output.refs.length})+'\n');
        }else throw new Error('unexpected_model_method');
        return Response.json({object:'response',model:body.model,status:'completed',error:null,
          incomplete_details:null,output:[{type:'message',role:'assistant',status:'completed',
          content:[{type:'output_text',text:JSON.stringify(output)}]}],
          usage:{input_tokens:100,output_tokens:100,total_tokens:200}});
      };
    """.replace("__LOG__", json.dumps(str(home / "fake-http.jsonl")))
    encoded = base64.b64encode(preload.encode()).decode()
    wrapper = home / "synthetic-node"
    wrapper.write_text("#!/bin/sh\nexec " + shlex.quote(node) + " " + shlex.quote(
        "--import=data:text/javascript;base64," + encoded) + ' "$@"\n')
    wrapper.chmod(0o700)
    return wrapper


def test_native_installed_source_candidate_profile_reaches_beyond_prefix(isolated_profile, request, monkeypatch):
    home = isolated_profile
    node = request.config.getoption("--cairn-node")
    executable = Path(request.config.getoption("--cairn-executable")).resolve()
    installed_core = executable.parent.parent / "core" / "contract.mjs"
    assert installed_core.is_file()
    wrapper = fake_node(home, node)
    shutil.copytree(Path(__file__).parents[1] / "cairn", home / "plugins" / "cairn")
    (home / "cairn.json").write_text(json.dumps({"node_path": str(wrapper),
        "executable_path": str(executable), "source_candidate_policy": "bounded-keyset-v1"}))
    (home / "config.yaml").write_text(json.dumps({"model": {"context_length": 256000},
        "tools": {"tool_search": {"enabled": "off"}},
        "memory": {"provider": "cairn", "memory_enabled": False, "user_profile_enabled": False}}))
    monkeypatch.setenv("CAIRN_MEMORY_OPENAI_API_KEY", "synthetic-dedicated-key")

    from agent.memory_manager import MemoryManager
    from plugins.memory import load_memory_provider
    from run_agent import AIAgent

    expected = {"cairn_" + action + "_memory" for action in
                ("remember", "recall", "inspect", "correct", "forget")}
    provider = load_memory_provider("cairn")
    manager = MemoryManager()
    manager.add_provider(provider)
    assert {tool["name"] for tool in manager.get_all_tool_schemas()} == expected
    manager.initialize_all(session_id="synthetic-seed", hermes_home=str(home), platform="cli", agent_context="primary")
    try:
        assert json.loads(manager.handle_tool_call("cairn_inspect_memory", {}))["ok"]
    finally:
        manager.shutdown_all()
    owner = "hermes-" + (home / "cairn" / "owner-id").read_text()
    db = home / "cairn" / "memory.sqlite"
    seeded = subprocess.run([node, "--input-type=module", "--eval", SEED, installed_core.as_uri(),
                             str(db), owner], capture_output=True, text=True, check=True, timeout=90)
    target = json.loads(seeded.stdout)
    query = target["source"].split(" ")[0]
    assert not (home / "fake-http.jsonl").exists()

    with patch("agent.process_bootstrap.OpenAI"):
        agent = AIAgent(api_key="synthetic-no-network", base_url="http://127.0.0.1:1/v1",
            model="synthetic-model", platform="cli", session_id="synthetic-cold-session",
            enabled_toolsets=["memory"], skip_context_files=True, skip_memory=False,
            skip_background_review=True, quiet_mode=True, max_iterations=4)
        try:
            assert {tool["function"]["name"] for tool in agent.tools} == expected
            agent.compression_enabled = False
            agent.save_trajectories = False
            agent._use_prompt_caching = False
            agent.client = MagicMock()
            completions = []

            def complete(**kwargs):
                completions.append(kwargs)
                return response("cairn_recall_memory", {"query": query, "contextMode": "source-evidence", "limit": 1}) \
                    if len(completions) == 1 else response()

            agent.client.chat.completions.create.side_effect = complete
            agent.run_conversation("Recall the explicitly requested synthetic source.")
            assert len(completions) == 2
            tools = [message for message in completions[1]["messages"] if message.get("role") == "tool"]
            assert len(tools) == 1
            result = json.loads(tools[0]["content"])
            assert result["ok"], result
            item = result["value"]["memories"][0]
            assert item["memory"]["id"] == target["id"]
            assert item["receipts"][0]["excerpt"] == target["source"]
            assert item["interpretationStatus"] == "omitted"
        finally:
            agent.close()
    events = [json.loads(line) for line in (home / "fake-http.jsonl").read_text().splitlines()]
    assert any(event == {"method": "select", "matched": 1} for event in events)
    assert any(event == {"method": "rank", "matched": 1} for event in events)

    other_home = home / "other-profile"
    other_home.mkdir()
    shutil.copytree(Path(__file__).parents[1] / "cairn", other_home / "plugins" / "cairn")
    (other_home / "cairn.json").write_text((home / "cairn.json").read_text())
    (other_home / "config.yaml").write_text((home / "config.yaml").read_text())
    monkeypatch.setenv("HERMES_HOME", str(other_home))
    isolated = load_memory_provider("cairn")
    second = MemoryManager()
    second.add_provider(isolated)
    second.initialize_all(session_id="synthetic-foreign", hermes_home=str(other_home), platform="cli", agent_context="primary")
    try:
        denied = json.loads(second.handle_tool_call("cairn_inspect_memory", {"memoryId": target["id"]}))
        assert not denied["ok"] and denied["error"]["code"] == "memory_not_found"
        absent = json.loads(second.handle_tool_call("cairn_recall_memory", {"query": query,
            "contextMode": "source-evidence"}))
        assert absent["ok"] and absent["value"]["memories"] == []
        assert (other_home / "cairn" / "owner-id").read_text() != (home / "cairn" / "owner-id").read_text()
    finally:
        second.shutdown_all()


def test_bridge_rejects_invalid_policy_before_child(isolated_profile, request, monkeypatch):
    path = Path(__file__).parents[1] / "cairn" / "bridge.py"
    spec = importlib.util.spec_from_file_location("synthetic_cairn_bridge", path)
    bridge = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bridge)
    monkeypatch.setattr(bridge, "stdio_client", lambda *args, **kwargs: pytest.fail("child must not start"))
    request_value = {"operation": "list", "database": str(isolated_profile / "unused.sqlite"),
        "owner": "synthetic-owner", "node_path": request.config.getoption("--cairn-node"),
        "executable_path": request.config.getoption("--cairn-executable")}
    for value in [None, True, False, "", "bounded-keyset-v2", " bounded-keyset-v1", 1, {}, []]:
        with pytest.raises(ValueError, match="invalid_source_candidate_configuration"):
            anyio.run(bridge.exchange, {**request_value, "source_candidate_policy": value})
    assert not (isolated_profile / "unused.sqlite").exists()
