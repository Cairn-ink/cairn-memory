"""Independent loopback harness; no local engine executable or model needed."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib
import json
from pathlib import Path
import shutil
import threading
import time
import uuid

import pytest

from agent.memory_manager import MemoryManager
from plugins.memory import load_memory_provider


class FakeCloud:
    def __init__(self):
        self.credential_status = 200
        self.credential_value = {"valid": True, "token_id": "synthetic-token-id",
                                 "scopes": ["memory:capture", "memory:recall"], "expires_at": None}
        self.credential_delay = 0
        self.recall_status = 200
        self.recall_delay = 0
        self.recall_value = {"memories": [{"id": str(uuid.uuid4()), "content": "Synthetic note: prefer small examples.",
                                            "kind": "preference"}]}
        self.partial = False
        self.invalid_json = False
        self.mcp_status = 200
        self.mcp_type = "application/json"
        self.protocol = "2025-06-18"
        self.missing_tool = False
        self.tool_error = None
        self.text_result = None
        self.memories = {}
        self.requests = []
        self.completed_recalls = 0
        self.lock = threading.Lock()
        self.trickle_response = None
        self.oversize_response = None
        self.stop_streams = threading.Event()

    def requests_for(self, path):
        with self.lock:
            return [r for r in self.requests if r[0] == path]

    def wait_recalls(self, count, timeout=2):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            with self.lock:
                if self.completed_recalls >= count:
                    return
            time.sleep(0.005)
        pytest.fail("fake recall did not finish")


@pytest.fixture
def cloud():
    state = FakeCloud()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def respond(self, status, value, content_type="application/json", partial=False, operation=None):
            data = value if isinstance(value, bytes) else json.dumps(value).encode()
            key = operation or self.path
            trickle = state.trickle_response == key
            if trickle:
                data = b" " * 40 + data
            if state.oversize_response == key:
                data += b" " * (1024 * 1024 + 1 - len(data))
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            if partial:
                self.send_header("X-Cairn-Memory-Partial", "true")
            if 300 <= status < 400:
                self.send_header("Location", state.endpoint + "/redirect-target")
            self.end_headers()
            try:
                if trickle:
                    for byte in data[:40]:
                        self.wfile.write(bytes([byte]))
                        self.wfile.flush()
                        if state.stop_streams.wait(0.05):
                            return
                    self.wfile.write(data[40:])
                else:
                    self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            with state.lock:
                state.requests.append((self.path, None, dict(self.headers)))
            if self.path == "/api/cli-auth/v1/credential":
                time.sleep(state.credential_delay)
                self.respond(state.credential_status, state.credential_value)
            else:
                self.respond(404, {})

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            with state.lock:
                state.requests.append((self.path, body, dict(self.headers)))
            if self.path == "/api/memory/recall":
                delay, status, value, partial, invalid = (state.recall_delay, state.recall_status,
                    state.recall_value, state.partial, state.invalid_json)
                time.sleep(delay)
                self.respond(status, b"invalid json" if invalid else value, partial=partial)
                with state.lock:
                    state.completed_recalls += 1
                return
            if self.path != "/api/mcp":
                self.respond(404, {})
                return
            result = {"jsonrpc": "2.0", "id": body["id"]}
            if body["method"] == "initialize":
                result["result"] = {"protocolVersion": state.protocol, "capabilities": {},
                                     "serverInfo": {"name": "synthetic-cloud", "version": "1"}}
            elif state.missing_tool:
                result["error"] = {"code": -32602, "message": "synthetic server diagnostic"}
            else:
                params = body["params"]
                name, args = params["name"], params["arguments"]
                if state.tool_error is not None:
                    result["result"] = {"isError": True, "structuredContent": state.tool_error,
                                         "content": [{"type": "text", "text": "synthetic server diagnostic"}]}
                elif state.text_result is not None:
                    result["result"] = {"isError": False, "content": [{"type": "text", "text": state.text_result}]}
                elif name == "remember_memory":
                    memory = {"id": str(uuid.uuid4()), "content": args["content"], "kind": args.get("kind", "fact")}
                    state.memories[memory["id"]] = memory
                    result["result"] = {"isError": False, "structuredContent": memory}
                elif name == "recall_memory":
                    result["result"] = {"isError": False, "structuredContent": {"memories": list(state.memories.values())}}
                elif name == "forget_memory":
                    forgotten = state.memories.pop(args["memory_id"], None) is not None
                    result["result"] = {"isError": not forgotten,
                                         "structuredContent": {"memory_id": args["memory_id"], "forgotten": forgotten}}
                else:
                    result["error"] = {"code": -32602, "message": "synthetic server diagnostic"}
            self.respond(state.mcp_status, result, state.mcp_type, operation=body["method"])

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    state.endpoint = f"http://127.0.0.1:{server.server_port}"
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    yield state
    state.stop_streams.set()
    server.shutdown()
    server.server_close()
    thread.join(2)
    assert not thread.is_alive()


@pytest.fixture
def install(tmp_path, monkeypatch, cloud):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    managers = []
    providers = []

    def make(name="profile", *, configured=True, initialize=True, cap="250"):
        home = tmp_path / name
        shutil.copytree(Path(__file__).parents[1] / "cairn", home / "plugins" / "cairn",
                        ignore=shutil.ignore_patterns("__pycache__"))
        monkeypatch.setenv("HERMES_HOME", str(home))
        provider = load_memory_provider("cairn")
        assert provider is not None
        providers.append(provider)
        module = importlib.import_module(provider.__class__.__module__)
        hosted = module.hosted
        if not configured:
            return home, provider, None, hosted
        provider.save_config({"mode": "hosted", "api_endpoint": cloud.endpoint,
                              "prefetch_timeout_ms": cap}, str(home))
        hosted.write_credential(home, {"endpoint": cloud.endpoint, "token": "synthetic-memory-token",
                                      "token_id": "synthetic-token-id", "expires_at": None})
        (home / "config.yaml").write_text("memory:\n  provider: cairn\n")
        assert provider.is_available()
        manager = MemoryManager()
        managers.append(manager)
        manager.add_provider(provider)
        if initialize:
            manager.initialize_all(session_id="conversation", hermes_home=str(home),
                                   platform="cli", agent_context="primary")
        return home, provider, manager, hosted

    yield make
    for manager in managers:
        manager.shutdown_all()
    for provider in providers:
        provider.shutdown()
