# filename: tests/test_app.py
from __future__ import annotations

import app as app_module
from app import create_app


def test_health_endpoint():
    client = create_app().test_client()
    response = client.get("/health")
    assert response.status_code == 200
    assert response.get_json()["ok"] is True


def test_index_serves_frontend():
    client = create_app().test_client()
    response = client.get("/")
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert "Ferginánd" in html
    assert "/static/app.js?v=" in html
    assert "/static/styles.css?v=" in html
    assert "Most played" in html


def test_client_config_from_env(monkeypatch):
    monkeypatch.setenv("FRONTEND_RELAY_URL", "wss://example.onrender.com/ws")
    monkeypatch.setenv("FRONTEND_USER_TOKEN", "friend-token")
    monkeypatch.setenv("FRONTEND_ROLE", "admin")
    monkeypatch.setenv("FRONTEND_CLIENT_NAME", "Gera PC")
    monkeypatch.setenv("FRONTEND_REQUESTED_BY", "Gera")
    monkeypatch.setenv("FRONTEND_SERVER_ID", "main")
    monkeypatch.setenv("FRONTEND_AUTO_CONNECT", "false")

    client = create_app().test_client()
    response = client.get("/api/client-config")
    assert response.status_code == 200
    data = response.get_json()
    assert data == {
        "relayUrl": "wss://example.onrender.com/ws",
        "token": "friend-token",
        "role": "admin",
        "clientName": "Gera PC",
        "requestedBy": "Gera",
        "serverId": "main",
        "autoConnect": False,
    }


def test_invalid_role_falls_back_to_user(monkeypatch):
    monkeypatch.setenv("FRONTEND_ROLE", "host")
    client = create_app().test_client()
    response = client.get("/api/client-config")
    assert response.status_code == 200
    assert response.get_json()["role"] == "user"


class FakeGitRoot:
    def __truediv__(self, name: str) -> "FakeGitRoot":
        return self

    def exists(self) -> bool:
        return True


def test_update_status_soft_fails_git_fetch(monkeypatch):
    calls: list[list[str]] = []

    monkeypatch.setattr(app_module.shutil, "which", lambda name: "git" if name == "git" else None)
    monkeypatch.setattr(app_module, "PROJECT_ROOT", FakeGitRoot())

    def fake_run_command(args: list[str], timeout: int = 90) -> tuple[int, str]:
        calls.append(args)
        if args[:2] == ["git", "fetch"]:
            return 128, "network unavailable"
        if args[:3] == ["git", "rev-parse", "--abbrev-ref"]:
            return 0, "origin/main\n"
        if args[:2] == ["git", "rev-list"]:
            return 0, "0\t0\n"
        if args[:3] == ["git", "rev-parse", "--short"]:
            return 0, "abc123\n"
        return 1, "unexpected command"

    monkeypatch.setattr(app_module, "_run_command", fake_run_command)

    payload, status_code = app_module._get_update_status(fetch=True, soft_fetch_error=True)

    assert status_code == 200
    assert payload["ok"] is True
    assert payload["fetchOk"] is False
    assert payload["updateAvailable"] is False
    assert payload["updateError"] == "git fetch failed"
    assert "network unavailable" in payload["log"]
    assert ["git", "fetch", "--quiet"] in calls


def test_update_status_strict_fetch_failure_still_errors(monkeypatch):
    monkeypatch.setattr(app_module.shutil, "which", lambda name: "git" if name == "git" else None)
    monkeypatch.setattr(app_module, "PROJECT_ROOT", FakeGitRoot())
    monkeypatch.setattr(app_module, "_run_command", lambda args, timeout=90: (128, "network unavailable"))

    payload, status_code = app_module._get_update_status(fetch=True)

    assert status_code == 500
    assert payload["ok"] is False
    assert payload["error"] == "git fetch failed"
