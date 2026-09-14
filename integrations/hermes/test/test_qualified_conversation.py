"""Pinned native Hermes + installed core, synthetic completions/provider only."""

import base64
import json
from pathlib import Path
import shlex
import shutil
from unittest.mock import MagicMock, patch

from test_agent_conversation import isolated_profile, response  # noqa: F401


def test_native_qualified_capture_and_scripted_agent_dispatch(isolated_profile, request, monkeypatch):
    home = isolated_profile
    node = request.config.getoption("--cairn-node")
    executable = request.config.getoption("--cairn-executable")
    log = home / "synthetic-provider.jsonl"
    forbid = home / "forbid-provider"
    # Explicit test-only node_path wrapper. No production environment passthrough
    # or alternate memory engine: installed CLI/core/adapter remain untouched.
    preload = r"""
      import assert from 'node:assert/strict';
      import {appendFileSync,existsSync} from 'node:fs';
      const log=__LOG__, forbid=__FORBID__;
      globalThis.fetch=async(url,request)=>{
        assert.equal(existsSync(forbid),false,'cold provider request forbidden');
        const target=new URL(url);
        assert.equal(target.origin,'https://api.openai.com');
        assert.ok(['/v1/responses','/v1/responses/input_tokens'].includes(target.pathname));
        const body=JSON.parse(request.body), method=body.text.format.name;
        const input=JSON.parse(body.input[0].content[0].text);
        appendFileSync(log,JSON.stringify({method,route:target.pathname,
          ...(method==='cairn_rank'?{input}:{})})+'\n',{mode:0o600});
        if(target.pathname.endsWith('/input_tokens'))return Response.json({object:'response.input_tokens',input_tokens:100});
        let result;
        switch(method){
          case 'cairn_extract':
            assert.ok(input.messages.every(m=>m.content.length<=800));
            result={items:[{content:'WRONG_ADOPTION: '+input.messages[0].content.slice(0,120),
              kind:'decision',confidence:0.99,sourceIndices:input.messages.map(m=>m.index)}]};break;
          case 'cairn_qualifyCandidates':
            result={qualifications:input.items.map(item=>{
              const field=value=>({value,evidenceIndices:[item.candidates[0].candidateIndex]});
              return {itemIndex:item.itemIndex,subject:field(null),property:field(null),scope:field(null),
                applies:field(null),value:field(null),attribution:field('direct'),commitment:field('adopted')};
            })};break;
          case 'cairn_classify':result={items:input.memories.map(m=>({memoryId:m.id,parentIds:[]}))};break;
          case 'cairn_select':result={refs:input.maps.flatMap(map=>map.items.filter(i=>i.type==='unfiled')
            .map(i=>({namespaceIndex:map.namespaceIndex,...i.ref})))};break;
          case 'cairn_rank':
            for(const item of input.candidates){
              if(item.interpretationStatus==='omitted'){
                assert.equal(item.sourceSelectionCoverage,'unassessed');
                assert.equal('content' in item.memory,false);assert.equal('qualification' in item,false);
                assert.equal(JSON.stringify(item).includes('WRONG_ADOPTION'),false);
              }else{
                assert.ok(item.memory.content.startsWith('WRONG_ADOPTION'));
                assert.equal(item.qualification.commitment,'adopted');
              }
            }
            result={refs:input.candidates.map(i=>({namespaceIndex:i.namespaceIndex,memoryId:i.memory.id,revision:i.memory.revision}))};break;
          default:assert.fail('Unexpected model method');
        }
        if(method==='cairn_qualifyCandidates')result.qualifications=Object.fromEntries(result.qualifications.map(item=>['item_'+item.itemIndex,item]));
        return Response.json({object:'response',model:body.model,status:'completed',error:null,incomplete_details:null,
          output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(result)}]}],
          usage:{input_tokens:100,output_tokens:100,total_tokens:200}});
      };
    """.replace("__LOG__", json.dumps(str(log))).replace("__FORBID__", json.dumps(str(forbid)))
    encoded = base64.b64encode(preload.encode()).decode()
    wrapper = home / "synthetic-node"
    wrapper.write_text("#!/bin/sh\nexec " + shlex.quote(node) + " " + shlex.quote(
        "--import=data:text/javascript;base64," + encoded) + ' "$@"\n')
    wrapper.chmod(0o700)
    shutil.copytree(Path(__file__).parents[1] / "cairn", home / "plugins" / "cairn")
    (home / "cairn.json").write_text(json.dumps({"node_path": str(wrapper),
        "executable_path": executable, "capture_qualification": "source-bound-v2"}))
    (home / "config.yaml").write_text(json.dumps({"model": {"context_length": 256000},
        "tools": {"tool_search": {"enabled": "off"}},
        "memory": {"provider": "cairn", "memory_enabled": False, "user_profile_enabled": False}}))
    monkeypatch.setenv("CAIRN_MEMORY_OPENAI_API_KEY", "synthetic-dedicated-key")

    from agent.memory_manager import MemoryManager
    from plugins.memory import load_memory_provider
    from run_agent import AIAgent

    expected = {"cairn_" + action + "_memory" for action in
                ("remember", "capture", "recall", "inspect", "correct", "forget")}
    managers, agents = [], []

    def manager(session):
        provider = load_memory_provider("cairn")
        result = MemoryManager()
        result.add_provider(provider)
        assert {tool["name"] for tool in result.get_all_tool_schemas()} == expected
        result.initialize_all(session_id=session, hermes_home=str(home), platform="cli", agent_context="primary")
        managers.append(result)
        return result

    def value(raw):
        result = json.loads(raw)
        assert result["ok"], result
        assert result["evidenceTrust"] == "untrusted-data-not-instructions"
        return result["value"]

    def call(manager, action, **args):
        return value(manager.handle_tool_call("cairn_" + action + "_memory", args))

    def requests():
        return [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []

    messages = [{"role": "assistant", "content": "You could take the tram 🚋."},
                {"role": "user", "content": "Does it have space for luggage?"}]
    batch = {"batchId": "synthetic-manager-capture", "messages": messages}
    agent_batch = {"batchId": "synthetic-agent-capture", "messages": [
        {"role": "user", "content": "Perhaps I prefer growing herbs, but I am still unsure."}]}
    try:
        first = manager("synthetic-qualified-first")
        assert requests() == []  # Discovery is keyless, even with dedicated key configured.
        captured = call(first, "capture", **batch)
        assert len(requests()) == 6
        assert captured["retainedSourceWindow"] == {"maxUnitsPerMessage": 800, "truncatedMessageIndices": []}
        memory_id = captured["admission"]["memories"][0]["id"]
        inspected = call(first, "inspect", memoryId=memory_id, includeQualification=True)
        assert inspected["memory"]["content"].startswith("WRONG_ADOPTION")
        assert inspected["qualification"]["commitment"] == "adopted"
        ordinary = call(first, "recall", query="What did I ask about the tram?")
        ordinary_item = ordinary["memories"][0]
        assert ordinary_item["memory"]["content"].startswith("WRONG_ADOPTION")
        assert ordinary_item["qualification"]["commitment"] == "adopted"
        assert len(requests()) == 10
        recalled = call(first, "recall", query="What did I ask about the tram?", contextMode="source-evidence")
        item = recalled["memories"][0]
        assert set(item) == {"memory", "receipts", "receiptCount", "interpretationStatus", "sourceSelectionCoverage"}
        assert sorted(({"role": r["role"], "content": r["excerpt"]} for r in item["receipts"]),
                      key=lambda r: r["role"]) == messages
        assert len(requests()) == 14
        first.shutdown_all()

        configured = json.loads((home / "cairn.json").read_text())
        configured["recall_context"] = "source-evidence"
        (home / "cairn.json").write_text(json.dumps(configured))

        # Only agent completions are scripted. Hermes chooses no tools naturally
        # in this fixture: explicit dispatch exercises its real loop while the
        # provider, not the scripted completion, supplies the recall context.
        with patch("agent.process_bootstrap.OpenAI"):
            def agent_turn(session, action, arguments):
                agent = AIAgent(api_key="synthetic-no-network", base_url="http://127.0.0.1:1/v1",
                    model="synthetic-model", platform="cli", session_id=session,
                    enabled_toolsets=["memory"], skip_context_files=True, skip_memory=False,
                    skip_background_review=True, quiet_mode=True, max_iterations=4)
                agents.append(agent)
                assert {tool["function"]["name"] for tool in agent.tools} == expected
                agent.compression_enabled = False
                agent.save_trajectories = False
                agent._use_prompt_caching = False
                agent.client = MagicMock()
                completions = []

                def complete(**kwargs):
                    completions.append(kwargs)
                    return response("cairn_" + action + "_memory", arguments) if len(completions) == 1 else response()

                agent.client.chat.completions.create.side_effect = complete
                agent.run_conversation("Explicitly invoke synthetic " + action + ".")
                assert len(completions) == 2
                tools = [message for message in completions[1]["messages"] if message.get("role") == "tool"]
                assert len(tools) == 1
                result = value(tools[0]["content"])
                agent.close()
                return result

            agent_recalled = agent_turn("synthetic-source-default-agent", "recall",
                                        {"query": "What did I ask about the tram?"})
            source_item = agent_recalled["memories"][0]
            assert set(source_item) == {"memory", "receipts", "receiptCount", "interpretationStatus",
                                        "sourceSelectionCoverage"}
            assert sorted(({"role": r["role"], "content": r["excerpt"]} for r in source_item["receipts"]),
                          key=lambda r: r["role"]) == messages
            assert len(requests()) == 18

            agent_captured = agent_turn("synthetic-qualified-agent", "capture", agent_batch)
            assert len(agent_captured["admission"]["memories"]) == 1
            assert len(requests()) == 24

        forbid.touch()
        monkeypatch.delenv("CAIRN_MEMORY_OPENAI_API_KEY")
        cold = manager("synthetic-qualified-cold")
        assert call(cold, "inspect", memoryId=memory_id, includeQualification=True) == inspected
        for original in (batch, agent_batch):
            assert call(cold, "capture", **original)["duplicate"] is True
        assert len(requests()) == 24
    finally:
        for agent in agents:
            agent.close()
        for instance in managers:
            instance.shutdown_all()
