# filename: app.py
from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template

load_dotenv()


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


@dataclass(frozen=True)
class FrontendConfig:
    relay_url: str
    user_token: str
    role: str
    client_name: str
    requested_by: str
    server_id: str
    auto_connect: bool

    @classmethod
    def from_env(cls) -> "FrontendConfig":
        role = os.getenv("FRONTEND_ROLE", "user").strip().lower() or "user"
        if role not in {"user", "admin"}:
            role = "user"

        requested_by = os.getenv("FRONTEND_REQUESTED_BY", "web-user").strip() or "web-user"
        return cls(
            relay_url=os.getenv("FRONTEND_RELAY_URL", "").strip(),
            user_token=os.getenv("FRONTEND_USER_TOKEN", "").strip(),
            role=role,
            client_name=os.getenv("FRONTEND_CLIENT_NAME", requested_by).strip() or requested_by,
            requested_by=requested_by,
            server_id=os.getenv("FRONTEND_SERVER_ID", "main").strip() or "main",
            auto_connect=_env_bool("FRONTEND_AUTO_CONNECT", True),
        )


def create_app() -> Flask:
    app = Flask(__name__)

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/health")
    def health():
        return jsonify({"ok": True, "service": "ferginand_frontend"})

    @app.get("/api/client-config")
    def client_config():
        cfg = FrontendConfig.from_env()
        return jsonify(
            {
                "relayUrl": cfg.relay_url,
                "token": cfg.user_token,
                "role": cfg.role,
                "clientName": cfg.client_name,
                "requestedBy": cfg.requested_by,
                "serverId": cfg.server_id,
                "autoConnect": cfg.auto_connect,
            }
        )

    return app


app = create_app()


if __name__ == "__main__":
    host = os.getenv("FRONTEND_HOST", "127.0.0.1")
    port = int(os.getenv("FRONTEND_PORT", "5050"))
    debug = _env_bool("FRONTEND_DEBUG", False)
    app.run(host=host, port=port, debug=debug)
