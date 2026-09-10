#!/usr/bin/env python3
"""Run one isolated, real Hermes AIAgent turn and emit a bounded trace."""

from __future__ import annotations

import contextlib
import json
import os
from pathlib import Path
import socket
import sys
from urllib.parse import urlparse


MODEL = "gpt-4.1-mini-2025-04-14"
MEMORY_TOOLS = {
    "cairn_remember_memory",
    "cairn_recall_memory",
    "cairn_inspect_memory",
    "cairn_correct_memory",
    "cairn_forget_memory",
}
MAX_INPUT_BYTES = 32_768
MAX_TEXT_BYTES = 262_144


def fail(code: str) -> None:
    raise ValueError(code)


def exact(value, keys: set[str]) -> None:
    if not isinstance(value, dict) or set(value) != keys:
        fail("invalid_stage_request")


def bounded_text(value, maximum: int = MAX_TEXT_BYTES) -> str:
    if not isinstance(value, str) or len(value.encode("utf-8")) > maximum:
        fail("invalid_stage_output")
    return value


def install_network_fence(proxy_url: str) -> None:
    parsed = urlparse(proxy_url)
    if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or not parsed.port:
        fail("invalid_proxy")
    allowed = (parsed.hostname, parsed.port)
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex

    def permitted(sock, address):
        if sock.family in (socket.AF_INET, socket.AF_INET6):
            return isinstance(address, tuple) and address[:2] == allowed
        return True

    def connect(sock, address):
        if not permitted(sock, address):
            raise OSError("network_route_blocked")
        return original_connect(sock, address)

    def connect_ex(sock, address):
        if not permitted(sock, address):
            return 13
        return original_connect_ex(sock, address)

    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex


def safe_tools(tools) -> list[dict]:
    output = []
    for tool in tools:
        exact(tool, {"type", "function"})
        function = tool["function"]
        if not isinstance(function, dict):
            fail("invalid_tool_schema")
        output.append(json.loads(json.dumps(tool)))
    encoded = json.dumps(output, sort_keys=True, separators=(",", ":"))
    bounded_text(encoded)
    return output


def trace_messages(messages) -> tuple[list[dict], str | None]:
    calls: dict[str, dict] = {}
    events: list[dict] = []
    final_response = None
    for message in messages:
        if not isinstance(message, dict):
            continue
        if message.get("role") == "assistant":
            tool_calls = message.get("tool_calls") or []
            if tool_calls:
                for call in tool_calls:
                    call_id = bounded_text(call.get("id", ""), 512)
                    function = call.get("function") or {}
                    raw_arguments = bounded_text(function.get("arguments", ""), 65_536)
                    try:
                        arguments = json.loads(raw_arguments)
                    except Exception:
                        arguments = {"unparseable": True}
                    event = {
                        "callId": call_id,
                        "name": bounded_text(function.get("name", ""), 512),
                        "arguments": arguments,
                        "result": None,
                    }
                    calls[call_id] = event
                    events.append(event)
            elif isinstance(message.get("content"), str) and message["content"]:
                final_response = bounded_text(message["content"], 32_768)
        elif message.get("role") == "tool":
            call_id = bounded_text(message.get("tool_call_id", ""), 512)
            content = bounded_text(message.get("content", ""))
            try:
                result = json.loads(content)
            except Exception:
                result = {"unparseable": True}
            if call_id in calls:
                calls[call_id]["result"] = result
            else:
                events.append({"callId": call_id, "name": None, "arguments": None, "result": result})
    return events, final_response


def run(request: dict) -> dict:
    exact(request, {
        "operation", "stage", "prompt", "sessionId", "hermesCheckout", "profileDirectory",
        "proxyUrl", "proxyToken", "control", "maxIterations", "maxOutputTokens",
    })
    if request["operation"] not in {"discover", "turn"} or request["control"] not in {True, False}:
        fail("invalid_stage_request")
    if request["maxIterations"] != 4 or request["maxOutputTokens"] != 1024:
        fail("invalid_stage_request")
    hermes = Path(request["hermesCheckout"]).resolve(strict=True)
    profile = Path(request["profileDirectory"]).resolve(strict=True)
    if not profile.is_dir() or not (hermes / "run_agent.py").is_file():
        fail("invalid_stage_request")
    proxy_url = bounded_text(request["proxyUrl"], 2_048)
    proxy_token = bounded_text(request["proxyToken"], 8_192)
    if request["operation"] == "turn":
        if not proxy_token:
            fail("invalid_stage_request")
        install_network_fence(proxy_url)

    preserved = {key: os.environ[key] for key in ("PATH", "LANG", "LC_ALL", "TZ", "PYTHONHASHSEED") if key in os.environ}
    os.environ.clear()
    os.environ.update(preserved)
    os.environ.update({"HOME": str(profile), "HERMES_HOME": str(profile)})
    if request["operation"] == "turn" and not request["control"]:
        # The native provider forwards this only for recall. It is a loopback
        # capability, never the provider credential.
        os.environ["CAIRN_MEMORY_OPENAI_API_KEY"] = proxy_token
    sys.path.insert(0, str(hermes))

    with open(os.devnull, "w", encoding="utf-8") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        from run_agent import AIAgent

        agent = AIAgent(
            api_key=proxy_token or "offline-discovery",
            base_url=(proxy_url.rstrip("/") + "/v1") if proxy_url else "http://127.0.0.1:1/v1",
            provider="custom",
            model=MODEL,
            platform="cli",
            session_id=bounded_text(request["sessionId"], 256),
            enabled_toolsets=[] if request["control"] else ["memory"],
            skip_context_files=True,
            skip_memory=request["control"],
            skip_background_review=True,
            quiet_mode=True,
            max_iterations=4,
            max_tokens=1024,
            request_overrides={"store": False, "stream": False, "n": 1},
        )
        try:
            agent._api_max_retries = 1
            agent._disable_streaming = True
            agent.compression_enabled = False
            agent.save_trajectories = False
            agent._use_prompt_caching = False
            tools = safe_tools(agent.tools)
            names = {tool["function"]["name"] for tool in tools}
            expected = set() if request["control"] else MEMORY_TOOLS
            if names != expected:
                fail("unexpected_tool_set")
            if request["operation"] == "discover":
                return {"ok": True, "stage": request["stage"], "model": MODEL, "tools": tools}
            result = agent.run_conversation(bounded_text(request["prompt"], 8_192))
            events, final_response = trace_messages(result.get("messages") or [])
            return {
                "ok": True,
                "stage": request["stage"],
                "sessionId": request["sessionId"],
                "model": MODEL,
                "completed": bool(result.get("completed")),
                "apiCalls": result.get("api_calls"),
                "finalResponse": final_response,
                "toolEvents": events,
                "toolNames": sorted(names),
            }
        finally:
            agent.close()


def main() -> int:
    original_stdout = sys.stdout
    try:
        raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
        if len(raw) > MAX_INPUT_BYTES:
            fail("invalid_stage_request")
        request = json.loads(raw.decode("utf-8"))
        output = run(request)
        status = 0
    except Exception as error:
        output = {"ok": False, "error": {"code": "hermes_stage_failed", "type": type(error).__name__}}
        status = 1
    encoded = json.dumps(output, sort_keys=True, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > MAX_TEXT_BYTES:
        encoded = '{"error":{"code":"hermes_stage_output_too_large"},"ok":false}'
        status = 1
    original_stdout.write(encoded + "\n")
    original_stdout.flush()
    return status


if __name__ == "__main__":
    raise SystemExit(main())
