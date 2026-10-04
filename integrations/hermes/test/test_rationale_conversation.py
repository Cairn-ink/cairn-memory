"""Explicit pinned native Hermes rationale; scripted HTTP, real installed tools."""

import base64
import hashlib
import json
from pathlib import Path
import shlex
import shutil
import time
from unittest.mock import MagicMock, patch

import pytest

from test_agent_conversation import isolated_profile, response  # noqa: F401


SOURCES = {
    "decision": "I chose A for my offline field notes.",
    "premise": "A supports offline work for my field notes.",
    "challenge": "I checked: A cannot work offline for my field notes.",
    "backup": "I keep a paper backup for my field notes.",
}
CORRECTION = "I rechecked: the offline limitation was a mistaken report."
QUERY = {"query": "field notes", "contextMode": "rationale-evidence"}
TOOLS = {"cairn_" + name for name in ("remember_memory", "recall_memory", "inspect_memory",
         "correct_memory", "forget_memory", "capture_memory", "inspect_rationale")}


def value(result):
    result = json.loads(result) if isinstance(result, str) else result
    assert result["ok"], result
    assert result["evidenceTrust"] == "untrusted-data-not-instructions"
    return result["value"]


@pytest.fixture
def native_rationale(isolated_profile, request, monkeypatch):
    home = isolated_profile
    log, forbid, stall, completed = (home / name for name in
                                   ("requests.jsonl", "forbid-provider", "stall-rationale", "rationale-completed"))
    repo = Path(__file__).parents[3]
    preload = r"""
      import assert from 'node:assert/strict';
      import {appendFileSync,existsSync,writeFileSync} from 'node:fs';
      import {rationaleModel} from __MODEL__;
      import {qualificationPoolWire} from __WIRE__;
      const log=__LOG__,forbid=__FORBID__,stall=__STALL__,completed=__COMPLETED__;
      const model=rationaleModel(),extract=model.extract,qualify=model.qualifyCandidates;
      model.extract=request=>{
        const output=extract(request);
        for(const item of output.items)item.kind=item.content.startsWith('I chose ')?'decision'
          :item.content.startsWith('I keep ')?'instruction':'fact';
        return output;
      };
      model.qualifyCandidates=request=>{
        const output=qualify(request);
        for(const entry of output.qualifications){
          const item=request.input.items.find(item=>item.itemIndex===entry.itemIndex);
          if(item.content.startsWith('I chose '))entry.commitment={value:'adopted',
            evidenceIndices:[item.candidates[0].candidateIndex]};
        }
        return output;
      };
      model.relate=({input})=>{
        const find=prefix=>input.memories.find(m=>m.receipts.some(r=>r.excerpt.startsWith(prefix)));
        const decision=find('I chose '),premise=find('A supports offline work'),
          challenge=find('I checked: A cannot work offline');
        const edge=(from,to,relation)=>({from:from.index,to:to.index,relation,
          fromReceipt:from.receipts[0].index,toReceipt:to.receipts[0].index});
        return {edges:[...(decision&&premise?[edge(premise,decision,'supports-decision')]:[]),
          ...(premise&&challenge?[edge(challenge,premise,'challenges-premise')]:[])]};
      };
      // A fresh subprocess sees only the current request, not a warm ID roster.
      model.select=({input})=>({refs:input.maps.flatMap(map=>map.items
        .filter(item=>item.type==='unfiled'&&/^(I chose |I keep )/.test(item.label)
          &&item.label.includes(input.query))
        .map(item=>({namespaceIndex:map.namespaceIndex,...item.ref})))});
      model.rank=({input})=>({refs:[...input.candidates]
        .sort((a,b)=>Number(b.receipts.some(r=>r.excerpt.startsWith('I chose ')))
          -Number(a.receipts.some(r=>r.excerpt.startsWith('I chose '))))
        .slice(0,input.limit).map(item=>({namespaceIndex:item.namespaceIndex,
          memoryId:item.memory.id,revision:item.memory.revision}))});
      globalThis.fetch=async(url,request)=>{
        assert.equal(existsSync(forbid),false,'keyless operation attempted model traffic');
        const target=new URL(url);
        assert.equal(target.origin,'https://api.openai.com');
        assert.ok(['/v1/responses','/v1/responses/input_tokens'].includes(target.pathname));
        const body=JSON.parse(request.body),method=body.text.format.name.slice('cairn_'.length),
          input=JSON.parse(body.input[0].content[0].text);
        appendFileSync(log,JSON.stringify({method,route:target.pathname,input})+'\n',{mode:0o600});
        if(target.pathname.endsWith('/input_tokens'))return Response.json({object:'response.input_tokens',input_tokens:100});
        assert.equal(typeof model[method],'function');
        if(method==='relate'&&existsSync(stall)){
          await new Promise(resolve=>setTimeout(resolve,5000));
          writeFileSync(completed,'completed',{mode:0o600});
        }
        let output=model[method]({input});
        if(method==='qualifyCandidates')output=qualificationPoolWire(input,output);
        return Response.json({object:'response',model:body.model,status:'completed',error:null,incomplete_details:null,
          output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(output)}]}],
          usage:{input_tokens:100,output_tokens:100,total_tokens:200}});
      };
    """
    for token, content in {"__MODEL__": (repo / "core/testing/rationale-model.mjs").as_uri(),
                           "__WIRE__": (repo / "adapters/openai/test/qualification-pool-wire.mjs").as_uri(),
                           "__LOG__": str(log), "__FORBID__": str(forbid), "__STALL__": str(stall),
                           "__COMPLETED__": str(completed)}.items():
        preload = preload.replace(token, json.dumps(content))
    wrapper = home / "synthetic-node"
    wrapper.write_text("#!/bin/sh\nexec " + shlex.quote(request.config.getoption("--cairn-node")) + " " +
                       shlex.quote("--import=data:text/javascript;base64," + base64.b64encode(preload.encode()).decode()) + ' "$@"\n')
    wrapper.chmod(0o700)
    shutil.copytree(Path(__file__).parents[1] / "cairn", home / "plugins/cairn")
    config = {"node_path": str(wrapper), "executable_path": request.config.getoption("--cairn-executable"),
              "capture_qualification": "source-bound-v2", "capture_deadline_ms": "110000",
              "capture_rationale": "source-bound-v1"}
    (home / "cairn.json").write_text(json.dumps(config))
    (home / "config.yaml").write_text(json.dumps({"model": {"context_length": 256000},
        "tools": {"tool_search": {"enabled": "off"}},
        "memory": {"provider": "cairn", "memory_enabled": False, "user_profile_enabled": False}}))
    from agent.memory_manager import MemoryManager
    from plugins.memory import load_memory_provider
    managers, providers, agents = [], [], []

    def manager(session):
        provider = load_memory_provider("cairn")
        result = MemoryManager()
        result.add_provider(provider)
        managers.append(result)  # Teardown registered before discovery/initialize.
        providers.append(provider)
        assert {tool["name"] for tool in result.get_all_tool_schemas()} == TOOLS
        result.initialize_all(session_id=session, hermes_home=str(home), platform="cli", agent_context="primary")
        return result

    def invoke(target, name, **arguments):
        return json.loads(target.handle_tool_call("cairn_" + name, arguments))

    def records():
        return [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []

    def agent_capture(batch):
        from run_agent import AIAgent
        with patch("agent.process_bootstrap.OpenAI"):
            agent = AIAgent(api_key="synthetic-no-network", base_url="http://127.0.0.1:1/v1",
                model="synthetic-model", platform="cli", session_id="synthetic-rationale-agent",
                enabled_toolsets=["memory"], skip_context_files=True, skip_memory=False,
                skip_background_review=True, quiet_mode=True, max_iterations=4)
            agents.append(agent)
            assert {tool["function"]["name"] for tool in agent.tools} == TOOLS
            agent.compression_enabled = agent.save_trajectories = agent._use_prompt_caching = False
            agent.client = MagicMock()
            completions = []

            def complete(**kwargs):
                completions.append(kwargs)
                return response("cairn_capture_memory", batch) if len(completions) == 1 else response()

            agent.client.chat.completions.create.side_effect = complete
            try:
                agent.run_conversation("Explicitly capture the submitted synthetic challenge.")
                assert len(completions) == 2
                results = [message for message in completions[1]["messages"] if message.get("role") == "tool"]
                assert len(results) == 1
                return value(results[0]["content"])
            finally:
                agent.close()

    monkeypatch.setenv("CAIRN_MEMORY_OPENAI_API_KEY", "synthetic-fake-only-key")
    try:
        yield home, manager, invoke, records, agent_capture, config, forbid, stall, completed
    finally:
        for agent in agents:
            agent.close()
        for instance in managers:
            instance.shutdown_all()
        assert all(provider._process is None for provider in providers)


def assert_graph(report, saved, challenged):
    assert report["status"] == ("reconfirmation-suggested" if challenged else "unassessed")
    assert report["coverage"] == "linked-evidence-only"
    assert len(report["sources"]) == (3 if challenged else 2)
    assert sorted(receipt["excerpt"] for source in report["sources"] for receipt in source["receipts"]) == sorted(
        [SOURCES["decision"], SOURCES["premise"]] + ([SOURCES["challenge"]] if challenged else []))
    edges = [(saved["premise"]["memory"]["id"], saved["decision"]["memory"]["id"], "supports-decision")]
    if challenged:
        edges.append((saved["challenge"]["memory"]["id"], saved["premise"]["memory"]["id"], "challenges-premise"))
    assert sorted((edge["from"], edge["to"], edge["relation"]) for edge in report["edges"]) == sorted(edges)
    for edge in report["edges"]:
        assert edge["interpretationStatus"] == "model-proposed"
        for side in ["from", "to"]:
            source = next(detail for detail in saved.values() if detail["memory"]["id"] == edge[side])
            assert edge[side + "Receipt"] == source["receipts"][0]["id"]


def assert_recall(recalled, records, saved, graph):
    assert [item["memory"]["id"] for item in recalled["memories"]] == [saved[key]["memory"]["id"] for key in ["decision", "backup"]]
    rank = [record["input"] for record in records if record["method"] == "rank" and record["route"].endswith("/responses")][-1]
    for key in ["decision", "backup"]:
        detail = saved[key]
        assert detail["memory"]["state"] == "active"
        item = next(item for item in recalled["memories"] if item["memory"]["id"] == detail["memory"]["id"])
        assert item["memory"] == {"id": detail["memory"]["id"], "revision": detail["memory"]["revision"], "currentness": "current"}
        assert item["receipts"] == [{field: receipt[field] for field in ["id", "role", "excerpt"]} for receipt in detail["receipts"]]
        assert next(candidate for candidate in rank["candidates"] if candidate["memory"]["id"] == item["memory"]["id"])["rationale"] == item["rationale"]
    assert recalled["memories"][0]["rationale"] == graph
    return rank


@pytest.mark.parametrize("action", ["correct", "forget"])
def test_native_premise_chain_cold_recall_and_invalidation(native_rationale, monkeypatch, action):
    home, manager, invoke, records, agent_capture, _, forbid, _, _ = native_rationale
    get = lambda host, identity: value(invoke(host, "inspect_memory", memoryId=identity, includeQualification=True))
    graph = lambda host, memory: value(invoke(host, "inspect_rationale", memoryId=memory["id"], revision=memory["revision"]))
    saved = {}
    warm = manager("synthetic-rationale-warm")
    assert records() == []
    for batch_id, content in SOURCES.items():
        batch = {"batchId": batch_id, "messages": [{"role": "user", "content": content}]}
        captured = agent_capture(batch) if batch_id == "challenge" else value(invoke(warm, "capture_memory", **batch))
        assert captured["classification"]["status"] == "applied" and captured["rationale"]["status"] == "reviewed"
        assert len(captured["admission"]["memories"]) == 1
        detail = saved[batch_id] = get(warm, captured["admission"]["memories"][0]["id"])
        assert detail["memory"]["content"] == content and detail["memory"]["state"] == "active"
        assert [(r["role"], r["excerpt"]) for r in detail["receipts"]] == [("user", content)]
        receipt = detail["receipts"][0]
        assert receipt["client"] == "cairn-local-mcp" and receipt["sessionId"] == "submitted-capture"
        event = json.dumps(["cairn.mcp.submitted-message.v1", batch_id, 0], separators=(",", ":"))
        assert receipt["eventId"] == hashlib.sha256(event.encode()).hexdigest()
    assert saved["decision"]["qualification"]["commitment"] == "adopted"
    before = graph(warm, saved["decision"]["memory"])
    assert_graph(before, saved, True)
    recalled = value(invoke(warm, "recall_memory", **QUERY))
    assert_recall(recalled, records(), saved, before)
    warm.shutdown_all()
    cold = manager("synthetic-rationale-cold")
    assert graph(cold, saved["decision"]["memory"]) == before
    cold_recall = value(invoke(cold, "recall_memory", **QUERY))
    assert cold_recall == recalled
    assert_recall(cold_recall, records(), saved, before)
    forbid.touch()
    monkeypatch.delenv("CAIRN_MEMORY_OPENAI_API_KEY")
    count = len(records())
    challenge = saved["challenge"]["memory"]

    def state():
        return {"listed": value(invoke(cold, "inspect_memory")),
                **{key: get(cold, saved[key]["memory"]["id"]) for key in ["decision", "premise", "backup"]},
                "rationale": graph(cold, saved["decision"]["memory"])}

    snapshot = state()
    assert snapshot["listed"]["exhausted"]
    assert sorted(item["id"] for item in snapshot["listed"]["memories"]) == sorted(detail["memory"]["id"] for detail in saved.values())
    for name, args in [("correct_memory", {"expectedRevision": challenge["revision"] + 1, "content": CORRECTION}),
                       ("forget_memory", {"expectedRevision": challenge["revision"] + 1}),
                       ("inspect_rationale", {"revision": challenge["revision"] + 1})]:
        rejected = invoke(cold, name, memoryId=challenge["id"], **args)
        assert not rejected["ok"] and rejected["error"]["code"] == "revision_conflict"
        assert state() == snapshot and get(cold, challenge["id"]) == saved["challenge"]
    if action == "correct":
        changed = value(invoke(cold, "correct_memory", memoryId=challenge["id"], expectedRevision=challenge["revision"], content=CORRECTION))
        assert changed["memory"]["revision"] == challenge["revision"] + 1
        corrected = get(cold, challenge["id"])
        assert corrected["memory"]["content"] == CORRECTION and corrected["memory"]["origin"] == "explicit"
        assert [(r["role"], r["excerpt"]) for r in corrected["receipts"]] == [("user", CORRECTION)]
    else:
        assert value(invoke(cold, "forget_memory", memoryId=challenge["id"], expectedRevision=challenge["revision"]))["forgotten"]
    after = state()
    for name, args in [("correct_memory", {"expectedRevision": challenge["revision"], "content": SOURCES["challenge"]}),
                       ("inspect_rationale", {"revision": challenge["revision"]})]:
        rejected = invoke(cold, name, memoryId=challenge["id"], **args)
        assert not rejected["ok"] and rejected["error"]["code"] == ("revision_conflict" if action == "correct" else "memory_not_found")
        assert state() == after
    repeated = invoke(cold, "forget_memory", memoryId=challenge["id"], expectedRevision=challenge["revision"])
    if action == "correct":
        assert not repeated["ok"] and repeated["error"]["code"] == "revision_conflict"
    else:
        assert value(repeated)["forgotten"] is False
    assert state() == after
    assert_graph(after["rationale"], saved, False)
    for key in ["decision", "premise", "backup"]:
        assert after[key] == saved[key]
    assert sorted(item["id"] for item in after["listed"]["memories"]) == sorted(
        detail["memory"]["id"] for key, detail in saved.items() if action == "correct" or key != "challenge")
    assert len(records()) == count
    cold.shutdown_all()
    final = manager("synthetic-rationale-final")
    assert graph(final, saved["decision"]["memory"]) == after["rationale"]
    if action == "correct":
        assert get(final, challenge["id"]) == corrected
    else:
        missing = invoke(final, "inspect_memory", memoryId=challenge["id"])
        assert not missing["ok"] and missing["error"]["code"] == "memory_not_found"
    assert len(records()) == count
    forbid.unlink()
    monkeypatch.setenv("CAIRN_MEMORY_OPENAI_API_KEY", "synthetic-fake-only-key")
    final_recall = value(invoke(final, "recall_memory", **QUERY))
    rank = assert_recall(final_recall, records(), saved, after["rationale"])
    for payload in [final_recall, rank]:
        text = json.dumps(payload)
        assert challenge["id"] not in text and SOURCES["challenge"] not in text
        assert all(receipt["id"] not in text for receipt in saved["challenge"]["receipts"])
    assert len(records()) == 44
    generations = [record["method"] for record in records() if record["route"].endswith("/responses")]
    assert generations == ["extract", "qualifyCandidates", "classify", "relate"] * 4 + ["select", "rank"] * 3


def test_native_rationale_expiry_preserves_admission_and_keyless_replay(native_rationale, monkeypatch):
    home, manager, invoke, records, _, config, forbid, stall, completed = native_rationale
    config["capture_deadline_ms"] = "3000"
    (home / "cairn.json").write_text(json.dumps(config))
    stall.touch()
    warm = manager("synthetic-rationale-expiry")
    batch = {"batchId": "rationale-expiry", "messages": [{"role": "user", "content": SOURCES["decision"]}]}
    partial = value(invoke(warm, "capture_memory", **batch))
    assert partial["classification"]["status"] == "applied"
    assert partial["rationale"]["status"] == "failed" and partial["rationale"]["error"]["code"] == "model_timeout"
    assert len(partial["admission"]["memories"]) == 1
    memory = partial["admission"]["memories"][0]
    before = value(invoke(warm, "inspect_memory", memoryId=memory["id"]))
    assert before["memory"]["content"] == SOURCES["decision"]
    assert [r["excerpt"] for r in before["receipts"]] == [SOURCES["decision"]]
    deadline = time.monotonic() + 10
    while not completed.exists() and time.monotonic() < deadline:
        time.sleep(0.03)
    assert completed.read_text() == "completed", "late fake result actually completed"
    warm.shutdown_all()
    assert len(records()) == 8
    forbid.touch()
    monkeypatch.delenv("CAIRN_MEMORY_OPENAI_API_KEY")
    cold = manager("synthetic-rationale-expiry-cold")
    assert value(invoke(cold, "inspect_memory", memoryId=memory["id"])) == before
    graph = value(invoke(cold, "inspect_rationale", memoryId=memory["id"], revision=memory["revision"]))
    assert graph["status"] == "unassessed" and graph["edges"] == []
    replay = value(invoke(cold, "capture_memory", **batch))
    assert replay["duplicate"] and replay["rationale"] == {
        "status": "not-run", "reason": "duplicate", "previousOutcome": "unavailable"}
    assert value(invoke(cold, "inspect_memory", memoryId=memory["id"])) == before
    assert len(records()) == 8
