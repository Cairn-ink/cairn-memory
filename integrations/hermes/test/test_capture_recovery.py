"""Pinned Hermes routing through installed Cairn with synthetic provider responses."""

import base64
import json
from pathlib import Path
import shlex
import shutil
import sqlite3
import time
from unittest.mock import MagicMock, patch

from test_agent_conversation import isolated_profile, response  # noqa: F401


def test_native_deadline_cold_inspection_and_scripted_recovery(isolated_profile, request, monkeypatch):
    home = isolated_profile
    node = request.config.getoption("--cairn-node")
    executable = request.config.getoption("--cairn-executable")
    log = home / "synthetic-provider.jsonl"
    forbid = home / "forbid-provider"
    late_extract = home / "late-extract-complete"
    late_classify = home / "late-classify-complete"
    preload = r"""
      import assert from 'node:assert/strict';
      import {qualificationPoolWire} from __WIRE_HELPER__;
      import {appendFileSync,existsSync,writeFileSync} from 'node:fs';
      const log=__LOG__, forbid=__FORBID__;
      const lateExtract=__LATE_EXTRACT__, lateClassify=__LATE_CLASSIFY__;
      globalThis.fetch=async(url,request)=>{
        assert.equal(existsSync(forbid),false,'cold provider request forbidden');
        const target=new URL(url);
        assert.equal(target.origin,'https://api.openai.com');
        assert.ok(['/v1/responses','/v1/responses/input_tokens'].includes(target.pathname));
        if(target.pathname.endsWith('/input_tokens'))return Response.json({object:'response.input_tokens',input_tokens:100});
        const body=JSON.parse(request.body), method=body.text.format.name;
        const input=JSON.parse(body.input[0].content[0].text);
        appendFileSync(log,JSON.stringify({method})+'\n',{mode:0o600});
        let result;
        switch(method){
          case 'cairn_extract':
            if(input.messages.some(m=>m.content.includes('STALL_EXTRACT'))){
              await new Promise(resolve=>setTimeout(resolve,5000));
              writeFileSync(lateExtract,'completed');
            }
            result={items:[{content:'Synthetic memory: '+input.messages[0].content,
              kind:'decision',confidence:0.99,sourceIndices:input.messages.map(m=>m.index)}]};break;
          case 'cairn_qualifyCandidates':
            result={qualifications:Object.fromEntries(input.items.map(item=>{
              const field=value=>({value,evidenceIndices:[item.candidates[0].candidateIndex]});
              return ['item_'+item.itemIndex,{itemIndex:item.itemIndex,subject:field(null),
                property:field(null),scope:field(null),applies:field(null),value:field(null),
                attribution:field('direct'),commitment:field('adopted')}];
            }))};
            result=qualificationPoolWire(input,result);break;
          case 'cairn_classify':
            if(input.memories.some(m=>m.content.includes('STALL_CLASSIFY'))){
              await new Promise(resolve=>setTimeout(resolve,5000));
              writeFileSync(lateClassify,'completed');
            }
            result={items:input.memories.map(m=>({memoryId:m.id,parentIds:[],
              newL1:{title:'Synthetic recovery map',parentL2Ids:[]}}))};break;
          default:assert.fail('unexpected synthetic model method');
        }
        return Response.json({object:'response',model:body.model,status:'completed',error:null,
          incomplete_details:null,output:[{type:'message',role:'assistant',status:'completed',
          content:[{type:'output_text',text:JSON.stringify(result)}]}],
          usage:{input_tokens:100,output_tokens:100,total_tokens:200}});
      };
    """.replace("__LOG__", json.dumps(str(log))).replace("__FORBID__", json.dumps(str(forbid))).replace(
        "__WIRE_HELPER__", json.dumps((Path(__file__).parents[3] / "adapters" / "openai" / "test" /
                                       "qualification-pool-wire.mjs").as_uri()))
    preload = preload.replace("__LATE_EXTRACT__", json.dumps(str(late_extract)))
    preload = preload.replace("__LATE_CLASSIFY__", json.dumps(str(late_classify)))
    wrapper = home / "synthetic-node"
    wrapper.write_text("#!/bin/sh\nexec " + shlex.quote(node) + " " + shlex.quote(
        "--import=data:text/javascript;base64," + base64.b64encode(preload.encode()).decode()) + ' "$@"\n')
    wrapper.chmod(0o700)
    shutil.copytree(Path(__file__).parents[1] / "cairn", home / "plugins" / "cairn")
    (home / "cairn.json").write_text(json.dumps({"node_path": str(wrapper),
        "executable_path": executable, "capture_qualification": "source-bound-v2",
        "capture_deadline_ms": "3000", "classification_recovery": "guarded-v1"}))
    (home / "config.yaml").write_text(json.dumps({"model": {"context_length": 256000},
        "tools": {"tool_search": {"enabled": "off"}},
        "memory": {"provider": "cairn", "memory_enabled": False, "user_profile_enabled": False}}))
    monkeypatch.setenv("CAIRN_MEMORY_OPENAI_API_KEY", "synthetic-fake-only-key")

    from agent.memory_manager import MemoryManager
    from plugins.memory import load_memory_provider
    from run_agent import AIAgent

    expected = {"cairn_" + name for name in ("remember_memory", "recall_memory", "inspect_memory",
        "correct_memory", "forget_memory", "capture_memory", "inspect_capture_admission",
        "classify_unfiled_memories")}
    managers = []
    agent = None

    def manager(session):
        provider = load_memory_provider("cairn")
        result = MemoryManager()
        result.add_provider(provider)
        assert {tool["name"] for tool in result.get_all_tool_schemas()} == expected
        result.initialize_all(session_id=session, hermes_home=str(home), platform="cli", agent_context="primary")
        managers.append(result)
        return result

    def invoke(target, name, **arguments):
        return json.loads(target.handle_tool_call("cairn_" + name, arguments))

    def value(raw):
        result = json.loads(raw) if isinstance(raw, str) else raw
        assert result["ok"], result
        assert result["evidenceTrust"] == "untrusted-data-not-instructions"
        return result["value"]

    def methods():
        return [json.loads(line)["method"] for line in log.read_text().splitlines()] if log.exists() else []

    def await_completion(marker):
        deadline = time.monotonic() + 10
        while not marker.exists() and time.monotonic() < deadline:
            time.sleep(0.03)
        assert marker.read_text() == "completed", "the fake model actually finished after the core deadline"

    def journal():
        with sqlite3.connect(home / "cairn" / "memory.sqlite") as connection:
            return connection.execute("SELECT * FROM capture_initial_classification ORDER BY event_id").fetchall()

    try:
        first = manager("synthetic-deadline-first")
        assert methods() == []  # Discovery is keyless and model-free.
        pre = invoke(first, "capture_memory", batchId="native-pre-admission", messages=[
            {"role": "user", "content": "STALL_EXTRACT synthetic source"}])
        assert pre["error"]["code"] == "model_timeout", pre
        assert methods() == ["cairn_extract"]
        await_completion(late_extract)
        assert value(invoke(first, "inspect_memory"))["memories"] == []
        with sqlite3.connect(home / "cairn" / "memory.sqlite") as connection:
            assert connection.execute("SELECT count(*) FROM memories").fetchone()[0] == 0
            assert connection.execute("SELECT count(*) FROM receipts").fetchone()[0] == 0
        batch_id = "native-post-admission"
        partial = value(invoke(first, "capture_memory", batchId=batch_id, messages=[
            {"role": "user", "content": "STALL_CLASSIFY synthetic retained source"}]))
        assert len(partial["admission"]["memories"]) == 1
        assert partial["classification"]["status"] == "failed"
        assert partial["classification"]["error"]["code"] == "model_timeout"
        assert methods() == ["cairn_extract", "cairn_extract", "cairn_qualifyCandidates", "cairn_classify"]
        memory_id = partial["admission"]["memories"][0]["id"]
        before = value(invoke(first, "inspect_memory", memoryId=memory_id))
        assert len(before["receipts"]) == 1
        await_completion(late_classify)
        initial_journal = journal()
        assert len(initial_journal) == 1
        first.shutdown_all()

        forbid.touch()
        monkeypatch.delenv("CAIRN_MEMORY_OPENAI_API_KEY")
        cold = manager("synthetic-deadline-cold")
        inspected = value(invoke(cold, "inspect_capture_admission", batchId=batch_id,
                                 includeInitialClassification=True))
        assert inspected["status"] == "completed"
        assert inspected["classification"] == {"status": "unknown"}
        assert inspected["initialClassification"] == {"status": "failed"}
        assert len(inspected["members"]) == 1
        member = inspected["members"][0]
        assert member["memoryId"] == memory_id and member["filing"]["status"] == "unfiled"
        assert "synthetic retained source" not in json.dumps(inspected)
        assert value(invoke(cold, "inspect_memory", memoryId=memory_id))["receipts"] == before["receipts"]
        assert methods() == ["cairn_extract", "cairn_extract", "cairn_qualifyCandidates", "cairn_classify"]
        forbid.unlink()
        monkeypatch.setenv("CAIRN_MEMORY_OPENAI_API_KEY", "synthetic-fake-only-key")
        reference = {"memoryId": memory_id, "revision": member["revision"]}

        with patch("agent.process_bootstrap.OpenAI"):
            agent = AIAgent(api_key="synthetic-no-network", base_url="http://127.0.0.1:1/v1",
                model="synthetic-model", platform="cli", session_id="synthetic-recovery-agent",
                enabled_toolsets=["memory"], skip_context_files=True, skip_memory=False,
                skip_background_review=True, quiet_mode=True, max_iterations=4)
            assert {tool["function"]["name"] for tool in agent.tools} == expected
            agent.compression_enabled = False
            agent.save_trajectories = False
            agent._use_prompt_caching = False
            agent.client = MagicMock()
            completions = []

            def complete(**kwargs):
                completions.append(kwargs)
                return response("cairn_classify_unfiled_memories", {"refs": [reference]}) if len(completions) == 1 else response()

            agent.client.chat.completions.create.side_effect = complete
            agent.run_conversation("Explicitly classify the inspected synthetic reference.")
            assert len(completions) == 2
            messages = [message for message in completions[1]["messages"] if message.get("role") == "tool"]
            assert len(messages) == 1
            applied = value(messages[0]["content"])
            assert applied["memories"][0]["filing"]["status"] == "filed"
            agent.close()
            agent = None

        assert methods() == ["cairn_extract", "cairn_extract", "cairn_qualifyCandidates",
                             "cairn_classify", "cairn_classify"]
        after = value(invoke(cold, "inspect_memory", memoryId=memory_id))
        assert after["memory"]["content"] == before["memory"]["content"]
        assert after["receipts"] == before["receipts"]
        assert journal() == initial_journal
        viewed = value(invoke(cold, "inspect_capture_admission", batchId=batch_id,
                               includeInitialClassification=True))
        assert viewed["initialClassification"] == {"status": "unknown"}
        stale = invoke(cold, "classify_unfiled_memories", refs=[reference])
        assert stale["error"]["code"] == "revision_conflict"
        assert len(methods()) == 5
    finally:
        if agent is not None:
            agent.close()
        for instance in managers:
            instance.shutdown_all()
