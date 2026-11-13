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


@pytest.mark.parametrize("failure", ["secret", "unreadable-secret", "activation"])
@pytest.mark.parametrize("previous_token", [None, "synthetic-existing-token"])
def test_failed_hosted_switch_restores_local_profile(install, cloud, monkeypatch, capsys,
                                                     failure, previous_token):
    import hermes_cli.config as core

    home, provider, _, hosted = install(configured=False)
    provider.save_config(local_paths(home), str(home))
    (home / ".env").write_text("SYNTHETIC_SETTING=unchanged\n")
    if previous_token is None:
        monkeypatch.delenv("CAIRN_MEMORY_TOKEN", raising=False)
    else:
        core.save_env_value("CAIRN_MEMORY_TOKEN", previous_token)
    (home / "config.yaml").write_bytes(b"memory:\n  provider: cairn\n")
    names = ("cairn.json", ".env", "config.yaml")
    before = {name: (home / name).read_bytes() for name in names}
    config = {"memory": {"provider": "cairn"}}
    answers(monkeypatch, hosted, ["hosted", cloud.endpoint])
    restored = []
    save_env = core.save_env_value

    def secret_write(key, value):
        restored.append((key, value))
        if failure == "secret":
            raise OSError(TOKEN)
        save_env(key, value)

    monkeypatch.setattr(core, "save_env_value", secret_write)
    if failure == "activation":
        def fail_activation(*args):
            raise OSError(TOKEN)
        monkeypatch.setattr(core, "save_config", fail_activation)
    elif failure == "unreadable-secret":
        (home / ".env").chmod(0)
    try:
        provider.post_setup(str(home), config)
    finally:
        (home / ".env").chmod(0o600)
    assert {name: (home / name).read_bytes() for name in names} == before
    assert config == {"memory": {"provider": "cairn"}}
    assert core.get_env_value("CAIRN_MEMORY_TOKEN") == previous_token
    if failure != "activation":
        assert restored == [("CAIRN_MEMORY_TOKEN", TOKEN)]
    captured = capsys.readouterr()
    assert "setup failed" in captured.out
    assert "could not be restored" not in captured.out
    assert TOKEN not in captured.out + captured.err
    try:
        provider.initialize("synthetic", hermes_home=str(home), platform="cli", agent_context="primary")
    except ValueError:
        pass
    if provider._hosted is not None and provider._hosted._ready:
        provider._hosted.prefetch("Synthetic message after failed setup", session_id="synthetic")
    assert len(cloud.requests_for("/api/memory/recall")) == 0


@pytest.mark.parametrize("existing_config", [False, True])
@pytest.mark.parametrize("memory", [None, {}, {"provider": "old"}])
def test_failed_activation_restores_absent_settings(install, cloud, monkeypatch, capsys,
                                                  existing_config, memory):
    import hermes_cli.config as core

    home, provider, _, hosted = install(configured=False)
    if existing_config:
        (home / "cairn.json").write_bytes(b'{ "old": true }\n')
    before = (home / "cairn.json").read_bytes() if existing_config else None
    (home / ".env").write_bytes(b"SYNTHETIC_SETTING=unchanged\n")
    monkeypatch.delenv("CAIRN_MEMORY_TOKEN", raising=False)
    config = {} if memory is None else {"memory": dict(memory)}
    original = json.loads(json.dumps(config))
    answers(monkeypatch, hosted, ["hosted", cloud.endpoint])
    activation_calls = []

    def fail_activation(values):
        activation_calls.append(True)
        raise OSError(TOKEN)

    monkeypatch.setattr(core, "save_config", fail_activation)
    provider.post_setup(str(home), config)
    assert activation_calls == [True]  # failed writes are never retried as restores
    assert config == original
    assert ((home / "cairn.json").read_bytes() if (home / "cairn.json").exists() else None) == before
    assert (home / ".env").read_bytes() == b"SYNTHETIC_SETTING=unchanged\n"
    assert not (home / "config.yaml").exists()
    assert core.get_env_value("CAIRN_MEMORY_TOKEN") is None
    captured = capsys.readouterr()
    assert "setup failed" in captured.out
    assert TOKEN not in captured.out + captured.err


@pytest.mark.parametrize("rollback_failure", [False, True])
def test_local_secret_failure_rolls_back_successful_writes_in_reverse(install, monkeypatch,
                                                                    capsys, rollback_failure):
    import hermes_cli.config as core

    home, provider, _, hosted = install(configured=False)
    paths = local_paths(home)
    provider.save_config(paths, str(home))
    (home / ".env").write_bytes(b"CAIRN_MEMORY_OPENAI_API_KEY=synthetic-old-key\n")
    monkeypatch.setenv("CAIRN_MEMORY_OPENAI_API_KEY", "synthetic-old-key")
    (home / "config.yaml").write_bytes(b"memory:\n  provider: old\n")
    names = ("cairn.json", ".env", "config.yaml")
    before = {name: (home / name).read_bytes() for name in names}
    schema = provider.get_config_schema() + [
        {"key": "second_secret", "secret": True, "env_var": "CAIRN_SYNTHETIC_SECOND"}]
    monkeypatch.setattr(provider, "get_config_schema", lambda: schema)
    answers(monkeypatch, hosted, ["local", *paths.values(), "", "guarded-v1", ""])
    save_env = core.save_env_value
    calls = []

    def secret_write(key, value):
        calls.append((key, value))
        if key == "CAIRN_SYNTHETIC_SECOND" or (rollback_failure and value == "synthetic-old-key"):
            raise OSError(TOKEN)
        save_env(key, value)

    original_replace = Path.replace

    def replace(path, target):
        if Path(target) == home / "cairn.json":
            calls.append("config")
        return original_replace(path, target)

    monkeypatch.setattr(core, "save_env_value", secret_write)
    monkeypatch.setattr(Path, "replace", replace)
    config = {"memory": {"provider": "old"}}
    provider.post_setup(str(home), config)
    assert calls == ["config", ("CAIRN_MEMORY_OPENAI_API_KEY", TOKEN),
                     ("CAIRN_SYNTHETIC_SECOND", TOKEN),
                     ("CAIRN_MEMORY_OPENAI_API_KEY", "synthetic-old-key"), "config"]
    assert config == {"memory": {"provider": "old"}}
    assert (home / "cairn.json").read_bytes() == before["cairn.json"]
    assert (home / "config.yaml").read_bytes() == before["config.yaml"]
    if not rollback_failure:
        assert (home / ".env").read_bytes() == before[".env"]
    captured = capsys.readouterr()
    assert "setup failed" in captured.out
    assert TOKEN not in captured.out + captured.err
    if rollback_failure:
        assert captured.out.count("could not be restored") == 1
        assert captured.out.index("setup failed") < captured.out.index("could not be restored")
        assert "hermes memory setup" in captured.out
    else:
        assert "could not be restored" not in captured.out


def test_config_restore_failure_reports_after_setup_failure(install, cloud, monkeypatch, capsys):
    import hermes_cli.config as core

    home, provider, _, hosted = install(configured=False)
    provider.save_config(local_paths(home), str(home))
    answers(monkeypatch, hosted, ["hosted", cloud.endpoint])
    original_replace = Path.replace
    writes = []

    def replace(path, target):
        if Path(target) == home / "cairn.json":
            writes.append(path)
            if len(writes) == 2:
                raise OSError(TOKEN)
        return original_replace(path, target)

    def fail_secret(*args):
        raise OSError(TOKEN)

    monkeypatch.setattr(Path, "replace", replace)
    monkeypatch.setattr(core, "save_env_value", fail_secret)
    provider.post_setup(str(home), {})
    captured = capsys.readouterr()
    assert len(writes) == 2
    assert captured.out.count("could not be restored") == 1
    assert captured.out.index("setup failed") < captured.out.index("could not be restored")
    assert "hermes memory setup" in captured.out
    assert TOKEN not in captured.out + captured.err
    assert all(not path.exists() for path in writes)


def test_failure_after_activation_restores_activation_first(install, cloud, monkeypatch, capsys):
    import builtins
    import hermes_cli.config as core

    home, provider, _, hosted = install(configured=False)
    config = {"memory": {"provider": "old"}}
    core.save_config(config)
    before = (home / "config.yaml").read_bytes()
    (home / ".env").write_bytes(b"SYNTHETIC_SETTING=unchanged\n")
    monkeypatch.delenv("CAIRN_MEMORY_TOKEN", raising=False)
    answers(monkeypatch, hosted, ["hosted", cloud.endpoint])
    save_config, remove_env, print_line = core.save_config, core.remove_env_value, builtins.print
    calls = []

    def activation(values):
        calls.append(values["memory"]["provider"])
        save_config(values)

    def remove(key):
        calls.append(key)
        return remove_env(key)

    def fail_success_message(message):
        if message.startswith("Cairn activated"):
            raise OSError(TOKEN)
        print_line(message)

    monkeypatch.setattr(core, "save_config", activation)
    monkeypatch.setattr(core, "remove_env_value", remove)
    monkeypatch.setattr(builtins, "print", fail_success_message)
    provider.post_setup(str(home), config)
    assert calls == ["cairn", "old", "CAIRN_MEMORY_TOKEN"]
    assert config == {"memory": {"provider": "old"}}
    assert (home / "config.yaml").read_bytes() == before
    assert (home / ".env").read_bytes() == b"SYNTHETIC_SETTING=unchanged\n"
    assert not (home / "cairn.json").exists()
    captured = capsys.readouterr()
    assert "setup failed" in captured.out
    assert "could not be restored" not in captured.out
    assert TOKEN not in captured.out + captured.err
