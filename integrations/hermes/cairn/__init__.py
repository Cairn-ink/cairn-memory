"""Third-party Hermes MemoryProvider; the installed MCP owns every memory operation."""

import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import uuid

import psutil

from agent.memory_provider import MemoryProvider
from hermes_constants import get_hermes_home

TOOLS = frozenset({"remember_memory", "recall_memory", "inspect_memory", "correct_memory", "forget_memory"})
TIMEOUT_SECONDS = 45


def stop_process(process):
    # The SDK creates a separate session for Node; killing only our group leaks it.
    try:
        parent = psutil.Process(process.pid)
        parent.suspend()
        children = parent.children(recursive=True)
        for child in children:
            try:
                child.kill()
            except psutil.NoSuchProcess:
                continue
        parent.kill()
        psutil.wait_procs(children, timeout=2)
    except psutil.NoSuchProcess:
        pass
    process.wait(timeout=5)


def error(code):
    return json.dumps({"ok": False, "error": {"code": code, "retryable": False}})


def configuration(home):
    try:
        value = json.loads((home / "cairn.json").read_text(encoding="utf-8"))
        return validate_config(value)
    except (OSError, ValueError, TypeError):
        raise ValueError("cairn_invalid_configuration") from None


def validate_config(value):
    if not isinstance(value, dict) or set(value) != {"node_path", "executable_path"}:
        raise ValueError("cairn_invalid_configuration")
    for key, raw in value.items():
        if not isinstance(raw, str) or not Path(raw).is_absolute() or "\0" in raw:
            raise ValueError("cairn_invalid_configuration")
        path = Path(raw)
        if not path.is_file() or (key == "node_path" and not os.access(path, os.X_OK)):
            raise ValueError("cairn_invalid_configuration")
    return dict(value)


def profile_owner(directory):
    target = directory / "owner-id"
    if target.is_symlink():
        raise ValueError("cairn_invalid_identity")
    if not target.exists():
        if (directory / "memory.sqlite").exists():
            raise ValueError("cairn_missing_identity")
        # Publish a complete identity without overwriting a concurrent creator.
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=directory, delete=False) as file:
            temporary = Path(file.name)
            file.write(str(uuid.uuid4()))
        try:
            try:
                os.link(temporary, target)
            except FileExistsError:
                pass
        finally:
            temporary.unlink()
    try:
        if target.is_symlink():
            raise ValueError("cairn_invalid_identity")
        identity = target.read_text(encoding="utf-8")
        if str(uuid.UUID(identity)) != identity:
            raise ValueError("cairn_invalid_identity")
        return "hermes-" + identity
    except (ValueError, OSError):
        raise ValueError("cairn_invalid_identity") from None


class CairnMemoryProvider(MemoryProvider):
    def __init__(self):
        self._home = None
        self._config = None
        self._schemas = None
        self._ready = False
        self._closed = False
        self._lock = threading.Lock()
        self._process = None

    @property
    def name(self):
        return "cairn"

    def is_available(self):
        if sys.platform != "linux" or importlib.util.find_spec("mcp") is None:
            return False
        try:
            configuration(get_hermes_home().resolve())
            return True
        except ValueError:
            return False

    def unavailable_reason(self):
        return "Cairn requires Linux, the host MCP SDK and explicit installed Node/Cairn paths; run hermes memory setup."

    def get_config_schema(self):
        paths = [{"key": key, "description": description, "required": True}
                for key, description in [("node_path", "Absolute Node >=22.16 executable path"),
                                         ("executable_path", "Absolute installed cairn-memory JavaScript executable path")]]
        return paths + [{"key": "api_key", "description": "Optional Cairn recall OpenAI key (paid; selected memory evidence leaves this device)",
                         "secret": True, "required": False, "env_var": "CAIRN_MEMORY_OPENAI_API_KEY"}]

    def save_config(self, values, hermes_home):
        validated = validate_config(values)
        home = Path(hermes_home).resolve()
        home.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=home, delete=False) as file:
            temporary = Path(file.name)
            json.dump(validated, file)
        temporary.replace(home / "cairn.json")

    def get_tool_schemas(self):
        if self._closed:
            return []
        if self._schemas is None:
            # Hermes registers routing before initialize: discovery must never open real memory.
            self._home = get_hermes_home().resolve()
            self._config = configuration(self._home)
            with tempfile.TemporaryDirectory(prefix="cairn-hermes-schema-") as directory:
                result = self._request("list", Path(directory) / "memory.sqlite", "synthetic-schema-owner")
            if not isinstance(result, list) or {item.get("name") for item in result} != TOOLS or len(result) != len(TOOLS):
                raise ValueError("cairn_invalid_tool_listing")
            self._schemas = [{"name": "cairn_" + item["name"],
                              "description": item.get("description", ""),
                              "parameters": item["inputSchema"]} for item in result]
        return copy.deepcopy(self._schemas)

    def initialize(self, session_id, **kwargs):
        self._ready = False
        if self._closed or kwargs.get("platform") != "cli" or kwargs.get("agent_context") != "primary":
            raise ValueError("cairn_unsupported_context")
        home = Path(kwargs["hermes_home"]).resolve()
        if self._home is None or home != self._home or configuration(home) != self._config:
            raise ValueError("cairn_profile_binding_changed")
        self._ready = True

    def handle_tool_call(self, tool_name, args, **kwargs):
        if not self._ready or self._closed:
            return error("cairn_not_initialized")
        if kwargs.get("platform", "cli") != "cli" or kwargs.get("agent_context", "primary") != "primary":
            return error("cairn_unsupported_context")
        name = tool_name.removeprefix("cairn_")
        if tool_name != "cairn_" + name or name not in TOOLS or not isinstance(args, dict):
            return error("invalid_input")
        try:
            if len(json.dumps(args)) > 60000:
                return error("invalid_input")
            directory = self._home / "cairn"
            directory.mkdir(mode=0o700, exist_ok=True)
            if directory.is_symlink() or (directory / "memory.sqlite").is_symlink():
                return error("cairn_invalid_configuration")
            owner = profile_owner(directory)
            return json.dumps(self._request("call", directory / "memory.sqlite", owner,
                                            name=name, arguments=args))
        except (ValueError, OSError, TypeError):
            return error("cairn_transport_failed")

    def _request(self, operation, database, owner, **fields):
        # Isolate SDK diagnostics and its inherited environment from the Hermes process.
        with self._lock:
            if self._closed or self._process is not None:
                raise ValueError("cairn_unavailable")
            request = {"operation": operation, "database": str(database), "owner": owner,
                       **self._config, **fields}
            environment = {"LANG": "C.UTF-8", "PATH": "/usr/bin:/bin"}
            if operation == "call" and fields.get("name") == "recall_memory":
                environment["OPENAI_API_KEY"] = os.environ.get("CAIRN_MEMORY_OPENAI_API_KEY", "")
            process = subprocess.Popen([sys.executable, "-I", str(Path(__file__).with_name("bridge.py"))],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                       env=environment, start_new_session=True)
            self._process = process
        try:
            output, _ = process.communicate(json.dumps(request).encode(), timeout=TIMEOUT_SECONDS)
            if process.returncode or len(output) > 262144:
                raise ValueError("cairn_transport_failed")
            return json.loads(output)
        except (subprocess.TimeoutExpired, ValueError, OSError):
            raise ValueError("cairn_transport_failed") from None
        finally:
            with self._lock:
                if process.poll() is None:
                    stop_process(process)
                self._process = None

    def shutdown(self):
        with self._lock:
            self._closed = True
            self._ready = False
            if self._process is not None and self._process.poll() is None:
                stop_process(self._process)


def register(ctx):
    ctx.register_memory_provider(CairnMemoryProvider())
