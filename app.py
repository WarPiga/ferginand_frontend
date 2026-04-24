# filename: app.py
from __future__ import annotations

import os
import sys
import time
import shutil
import socket
import subprocess
import threading
from pathlib import Path
from flask import jsonify, request
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

# ------------------------------------------------------------
# Local frontend management endpoints
# ------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent
PYTHON_EXE = Path(sys.executable).resolve()
REQUIREMENTS_FILE = PROJECT_ROOT / "requirements.txt"


def _is_local_request() -> bool:
    remote_addr = request.remote_addr or ""
    return remote_addr in {"127.0.0.1", "::1", "localhost"}


def _run_command(args: list[str], timeout: int = 90) -> tuple[int, str]:
    completed = subprocess.run(
        args,
        cwd=str(PROJECT_ROOT),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=timeout,
        shell=False,
    )
    return completed.returncode, completed.stdout or ""


def _restart_process_after_delay(delay_seconds: float = 0.8) -> None:
    """
    Restart the local frontend safely.

    This writes and launches a small helper script. The helper waits until
    port 5050 is free, then starts app.py again. Logs go to
    frontend_restart.log so restart failures are visible.
    """
    def worker() -> None:
        time.sleep(delay_seconds)

        host = os.getenv("FRONTEND_HOST", "127.0.0.1")
        port = int(os.getenv("FRONTEND_PORT", "5050"))

        helper_path = PROJECT_ROOT / "_restart_frontend_helper.py"
        log_path = PROJECT_ROOT / "frontend_restart.log"

        helper_code = "\n".join([
            "from __future__ import annotations",
            "import os",
            "import socket",
            "import subprocess",
            "import sys",
            "import time",
            "from pathlib import Path",
            "",
            f"project_root = Path(r'''{str(PROJECT_ROOT)}''')",
            f"python_exe = Path(r'''{str(PYTHON_EXE)}''')",
            "app_file = project_root / 'app.py'",
            f"host = {host!r}",
            f"port = {port!r}",
            f"log_path = Path(r'''{str(log_path)}''')",
            "",
            "def log(message: str) -> None:",
            "    with log_path.open('a', encoding='utf-8') as f:",
            "        f.write(f'[{time.strftime(\"%Y-%m-%d %H:%M:%S\")}] {message}\\n')",
            "",
            "def port_is_free(host: str, port: int) -> bool:",
            "    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)",
            "    try:",
            "        s.settimeout(0.25)",
            "        return s.connect_ex((host, port)) != 0",
            "    finally:",
            "        s.close()",
            "",
            "try:",
            "    log('Restart helper started')",
            "    deadline = time.time() + 20",
            "    while time.time() < deadline:",
            "        if port_is_free(host, port):",
            "            log(f'Port {host}:{port} is free')",
            "            break",
            "        time.sleep(0.25)",
            "",
            "    creationflags = 0",
            "    if os.name == 'nt':",
            "        creationflags = subprocess.CREATE_NO_WINDOW",
            "",
            "    subprocess.Popen(",
            "        [str(python_exe), str(app_file)],",
            "        cwd=str(project_root),",
            "        stdout=subprocess.DEVNULL,",
            "        stderr=subprocess.DEVNULL,",
            "        stdin=subprocess.DEVNULL,",
            "        creationflags=creationflags,",
            "        close_fds=True,",
            "    )",
            "    log('New frontend process started')",
            "except Exception as exc:",
            "    log(f'ERROR: {exc!r}')",
            "    raise",
            "",
        ])

        helper_path.write_text(helper_code, encoding="utf-8")

        creationflags = 0
        if os.name == "nt":
            creationflags = subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS

        with log_path.open("a", encoding="utf-8") as log_file:
            log_file.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Launching restart helper\n")
            log_file.flush()

            subprocess.Popen(
                [str(PYTHON_EXE), str(helper_path)],
                cwd=str(PROJECT_ROOT),
                stdout=log_file,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                creationflags=creationflags,
                close_fds=True,
            )

        time.sleep(0.5)
        os._exit(0)

    threading.Thread(target=worker, daemon=True).start()


def _shutdown_after_delay(delay_seconds: float = 0.8) -> None:
    def worker() -> None:
        time.sleep(delay_seconds)
        os._exit(0)

    threading.Thread(target=worker, daemon=True).start()


def _get_update_status(fetch: bool = True) -> tuple[dict, int]:
    if not shutil.which("git"):
        return {"ok": False, "error": "Git was not found on PATH"}, 500

    if not (PROJECT_ROOT / ".git").exists():
        return {"ok": False, "error": "Project folder is not a Git repository"}, 500

    if fetch:
        code, output = _run_command(["git", "fetch", "--quiet"], timeout=120)
        if code != 0:
            return {
                "ok": False,
                "error": "git fetch failed",
                "log": output[-4000:],
            }, 500

    code, upstream = _run_command(["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], timeout=30)
    if code != 0:
        return {
            "ok": False,
            "error": "No upstream branch configured for this repo",
            "log": upstream[-4000:],
        }, 500

    code, counts = _run_command(["git", "rev-list", "--left-right", "--count", "HEAD...@{u}"], timeout=30)
    if code != 0:
        return {
            "ok": False,
            "error": "Could not compare local branch with upstream",
            "log": counts[-4000:],
        }, 500

    parts = counts.strip().split()
    ahead = int(parts[0]) if len(parts) >= 1 and parts[0].isdigit() else 0
    behind = int(parts[1]) if len(parts) >= 2 and parts[1].isdigit() else 0

    code, local_sha = _run_command(["git", "rev-parse", "--short", "HEAD"], timeout=30)
    if code != 0:
        local_sha = ""

    code, remote_sha = _run_command(["git", "rev-parse", "--short", "@{u}"], timeout=30)
    if code != 0:
        remote_sha = ""

    return {
        "ok": True,
        "updateAvailable": behind > 0,
        "ahead": ahead,
        "behind": behind,
        "upstream": upstream.strip(),
        "localSha": local_sha.strip(),
        "remoteSha": remote_sha.strip(),
    }, 200


@app.get("/api/frontend/update-status")
def api_frontend_update_status():
    if not _is_local_request():
        return jsonify({"ok": False, "error": "Local requests only"}), 403

    payload, status_code = _get_update_status(fetch=True)
    return jsonify(payload), status_code


@app.post("/api/frontend/restart")
def api_frontend_restart():
    if not _is_local_request():
        return jsonify({"ok": False, "error": "Local requests only"}), 403

    _restart_process_after_delay()
    return jsonify({"ok": True, "message": "Frontend server restarting"})


@app.post("/api/frontend/shutdown")
def api_frontend_shutdown():
    if not _is_local_request():
        return jsonify({"ok": False, "error": "Local requests only"}), 403

    _shutdown_after_delay()
    return jsonify({"ok": True, "message": "Frontend server shutting down"})


@app.post("/api/frontend/update-and-restart")
def api_frontend_update_and_restart():
    if not _is_local_request():
        return jsonify({"ok": False, "error": "Local requests only"}), 403

    if not shutil.which("git"):
        return jsonify({"ok": False, "error": "Git was not found on PATH"}), 500

    if not (PROJECT_ROOT / ".git").exists():
        return jsonify({"ok": False, "error": "Project folder is not a Git repository"}), 500

    status_payload, status_code = _get_update_status(fetch=True)
    if status_code != 200:
        return jsonify(status_payload), status_code

    if not status_payload.get("updateAvailable"):
        return jsonify({
            "ok": True,
            "message": "No frontend update available.",
            "updated": False,
            **status_payload,
        })

    logs: list[str] = []

    # Client machines should follow GitHub exactly.
    # This intentionally overwrites local source changes, but keeps .env because .env is gitignored.
    code, output = _run_command(["git", "fetch", "--quiet"], timeout=120)
    logs.append("$ git fetch --quiet\n" + output)

    if code != 0:
        return jsonify({
            "ok": False,
            "error": "git fetch failed",
            "log": "\n".join(logs)[-4000:],
        }), 500

    code, output = _run_command(["git", "reset", "--hard", "@{u}"], timeout=120)
    logs.append("$ git reset --hard @{u}\n" + output)

    if code != 0:
        return jsonify({
            "ok": False,
            "error": "git reset failed",
            "log": "\n".join(logs)[-4000:],
        }), 500

    if REQUIREMENTS_FILE.exists():
        code, output = _run_command(
            [str(PYTHON_EXE), "-m", "pip", "install", "-r", str(REQUIREMENTS_FILE)],
            timeout=180,
        )
        logs.append("$ pip install -r requirements.txt\n" + output)

        if code != 0:
            return jsonify({
                "ok": False,
                "error": "requirements install failed",
                "log": "\n".join(logs)[-4000:],
            }), 500

    _restart_process_after_delay()

    return jsonify({
        "ok": True,
        "message": "Frontend updated. Restarting local server…",
        "updated": True,
        "log": "\n".join(logs)[-4000:],
    })

if __name__ == "__main__":
    host = os.getenv("FRONTEND_HOST", "127.0.0.1")
    port = int(os.getenv("FRONTEND_PORT", "5050"))
    debug = _env_bool("FRONTEND_DEBUG", False)
    app.run(host=host, port=port, debug=debug, use_reloader=False)
