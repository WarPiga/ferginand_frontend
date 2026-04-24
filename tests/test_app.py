# filename: tests/test_app.py
from __future__ import annotations

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
    assert "/static/app.js" in html
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
