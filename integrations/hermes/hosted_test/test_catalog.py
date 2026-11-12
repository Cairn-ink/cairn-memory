"""Catalog credential routes, exercised with real Hermes and loopback only."""

import getpass
import json
from pathlib import Path
import stat
import warnings

import pytest
from agent.secret_scope import reset_secret_scope, set_secret_scope
from hermes_constants import reset_hermes_home_override, set_hermes_home_override


TOKEN = "synthetic-catalog-token"


def answers(monkeypatch, hosted, values, secret=TOKEN):
    values = iter(values)
    monkeypatch.setattr("builtins.input", lambda prompt: next(values))
    monkeypatch.setattr(hosted.getpass, "getpass", lambda prompt: secret)


def test_install_does_not_prompt_for_secrets(tmp_path, monkeypatch):
    from hermes_cli.plugins_cmd import _missing_env_specs
    from pm.plugin_declarations import read_native_manifest

    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("CAIRN_MEMORY_TOKEN", "")
    monkeypatch.setenv("CAIRN_MEMORY_OPENAI_API_KEY", "")
    manifest = read_native_manifest(Path(__file__).parents[1] / "cairn" / "plugin.yaml")
    missing = _missing_env_specs(manifest)
    assert "requires_env" not in manifest
    assert missing == []


def test_hosted_config_failure_preserves_secret_and_activation(install, cloud, monkeypatch, capsys):
    home, provider, _, hosted = install(configured=False)
    originals = {".env": b"CAIRN_MEMORY_TOKEN=synthetic-existing-token\n",
                 "cairn.json": b'{"old":true}\n', "config.yaml": b"memory:\n  provider: old\n"}
    for name, data in originals.items():
        (home / name).write_bytes(data)
    config = {"memory": {"provider": "old"}}
    answers(monkeypatch, hosted, ["hosted", cloud.endpoint])
    attempted = []

    def fail_save(values, hermes_home):
        attempted.append((values, hermes_home))
        raise OSError("Synthetic config write failure")

    monkeypatch.setattr(provider, "save_config", fail_save)
    provider.post_setup(str(home), config)
    assert attempted == [({"mode": "hosted", "api_endpoint": cloud.endpoint}, str(home))]
    assert len(cloud.requests_for("/api/cli-auth/v1/credential")) == 1
    assert {name: (home / name).read_bytes() for name in originals} == originals
    assert config == {"memory": {"provider": "old"}}
    captured = capsys.readouterr()
    assert "setup failed" in captured.out
    assert TOKEN not in captured.out + captured.err


def test_secret_setup_uses_hermes_profile_env(install, cloud, monkeypatch, capsys):
    home, provider, _, hosted = install(configured=False)
    answers(monkeypatch, hosted, ["hosted", cloud.endpoint])
    provider.post_setup(str(home), {})
    assert (home / ".env").read_text() == f"CAIRN_MEMORY_TOKEN={TOKEN}\n"
    assert stat.S_IMODE((home / ".env").stat().st_mode) == 0o600
    assert not (home / "cairn" / "hosted-credential.json").exists()
    assert provider.is_available()
    provider.initialize("catalog", hermes_home=str(home), platform="cli", agent_context="primary")
    results = [provider.handle_tool_call(name, args) for name, args in [
        ("cairn_remember_memory", {"content": "Synthetic catalog note"}),
        ("cairn_recall_memory", {"query": "Synthetic catalog note"}),
        ("cairn_forget_memory", {"memory_id": "00000000-0000-4000-8000-000000000000"}),
    ]]
    captured = capsys.readouterr()
    assert TOKEN not in captured.out + captured.err + "".join(results)
    for name in ("config.yaml", "cairn.json"):
        assert TOKEN not in (home / name).read_text()


@pytest.mark.parametrize("refusal", ["full", "invalid", "transport", "terminal", "endpoint"])
def test_refusal_preserves_existing_files(install, cloud, monkeypatch, capsys, refusal):
    home, provider, _, hosted = install(configured=False)
    originals = {".env": b"SYNTHETIC_EXISTING=value\n", "cairn.json": b'{"old":true}\n',
                 "config.yaml": b"memory:\n  provider: old\n"}
    for name, data in originals.items():
        (home / name).write_bytes(data)
    answers(monkeypatch, hosted, ["hosted", cloud.endpoint if refusal != "endpoint" else "http://example.invalid"])
    if refusal == "full":
        cloud.credential_value["scopes"] = None
    elif refusal == "invalid":
        cloud.credential_status = 401
    elif refusal == "transport":
        def failed_request(*args, **kwargs):
            raise OSError(TOKEN)
        monkeypatch.setattr(hosted.DeadlineClient, "request", failed_request)
    elif refusal == "terminal":
        def visible_prompt(prompt):
            warnings.warn("Synthetic terminal cannot hide input", getpass.GetPassWarning)
            pytest.fail("setup continued after GetPassWarning")
        monkeypatch.setattr(hosted.getpass, "getpass", visible_prompt)
    provider.post_setup(str(home), {})
    assert {name: (home / name).read_bytes() for name in originals} == originals
    assert not (home / "cairn").exists()
    captured = capsys.readouterr()
    assert TOKEN not in captured.out + captured.err
    if refusal in ("terminal", "endpoint"):
        assert not cloud.requests


def test_profiles_bind_scoped_tokens_at_initialize(install, cloud, monkeypatch):
    profiles = []
    for name in ("one", "two"):
        home, provider, _, _ = install(name, configured=False)
        provider.save_config({"mode": "hosted", "api_endpoint": cloud.endpoint}, str(home))
        home_scope = set_hermes_home_override(home)
        secret_scope = set_secret_scope({"CAIRN_MEMORY_TOKEN": TOKEN + name}, profile_home=str(home))
        try:
            assert provider.is_available()
            provider.initialize(name, hermes_home=str(home), platform="cli", agent_context="primary")
        finally:
            reset_secret_scope(secret_scope)
            reset_hermes_home_override(home_scope)
        profiles.append((home, provider, TOKEN + name))
    # Calls retain the initialize binding even under the other profile's current scope.
    scope = set_secret_scope({"CAIRN_MEMORY_TOKEN": "synthetic-unrelated"})
    try:
        for home, provider, token in profiles:
            assert json.loads(provider.handle_tool_call("cairn_remember_memory", {"content": "Synthetic note"}))["ok"]
            assert cloud.requests_for("/api/mcp")[-1][2]["Authorization"] == "Bearer " + token
    finally:
        reset_secret_scope(scope)
    assert profiles[0][1]._hosted._token != profiles[1][1]._hosted._token


def test_legacy_file_is_never_opened_or_changed(install, cloud, monkeypatch):
    home, provider, _, _ = install(configured=False)
    provider.save_config({"mode": "hosted", "api_endpoint": cloud.endpoint}, str(home))
    target = home / "cairn" / "hosted-credential.json"
    target.parent.mkdir()
    original = json.dumps({"endpoint": cloud.endpoint, "token": TOKEN,
                           "token_id": "synthetic-id", "expires_at": None}).encode()
    target.write_bytes(original)
    before = target.stat()
    scope = set_secret_scope({}, profile_home=str(home / "routed"))
    original_open = Path.open
    def guarded_open(path, *args, **kwargs):
        assert path != target, "plugin opened legacy credential"
        return original_open(path, *args, **kwargs)
    with monkeypatch.context() as guard:
        guard.setattr(Path, "open", guarded_open)
        try:
            assert not provider.is_available()
            assert "hermes memory setup" in provider.unavailable_reason()
            with pytest.raises(ValueError):
                provider.initialize("legacy", hermes_home=str(home), platform="cli", agent_context="primary")
        finally:
            reset_secret_scope(scope)
    assert target.read_bytes() == original
    assert target.stat().st_mtime_ns == before.st_mtime_ns
    assert not cloud.requests


def local_paths(home):
    node, script = home / "synthetic-node", home / "synthetic-cairn.mjs"
    node.write_text("synthetic")
    node.chmod(0o700)
    script.touch()
    return {"node_path": str(node), "executable_path": str(script)}


def test_local_setup_owned_prompts_and_defaults(install, monkeypatch, capsys):
    home, provider, _, hosted = install(configured=False)
    paths = local_paths(home)
    answers(monkeypatch, hosted, ["local", *paths.values(), "source-bound-v2", "1500", "guarded-v1", "source-evidence"],
            secret="synthetic-local-key")
    provider.post_setup(str(home), {})
    expected = {**paths, "capture_qualification": "source-bound-v2", "capture_deadline_ms": "1500",
                "classification_recovery": "guarded-v1", "recall_context": "source-evidence"}
    assert json.loads((home / "cairn.json").read_text()) == expected
    assert (home / ".env").read_text() == "CAIRN_MEMORY_OPENAI_API_KEY=synthetic-local-key\n"
    assert stat.S_IMODE((home / ".env").stat().st_mode) == 0o600
    before = (home / ".env").read_bytes()
    answers(monkeypatch, hosted, ["local", "", "", "", "", "", ""], secret="")
    provider.post_setup(str(home), {})
    assert json.loads((home / "cairn.json").read_text()) == expected
    assert (home / ".env").read_bytes() == before
    captured = capsys.readouterr()
    assert "synthetic-local-key" not in captured.out + captured.err


def test_local_nonhidden_input_writes_nothing(install, monkeypatch):
    home, provider, _, hosted = install(configured=False)
    paths = local_paths(home)
    answers(monkeypatch, hosted, ["local", *paths.values(), "", "", ""])
    def visible_prompt(prompt):
        warnings.warn("Synthetic terminal cannot hide input", getpass.GetPassWarning)
    monkeypatch.setattr(hosted.getpass, "getpass", visible_prompt)
    provider.post_setup(str(home), {})
    assert not any((home / name).exists() for name in (".env", "cairn.json", "config.yaml"))
