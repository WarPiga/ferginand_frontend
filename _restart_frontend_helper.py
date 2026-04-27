from __future__ import annotations
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

project_root = Path(r'''C:\VSCode\ferginand_frontend''')
python_exe = Path(r'''C:\VSCode\ferginand_frontend\.venv\Scripts\python.exe''')
app_file = project_root / 'app.py'
host = '127.0.0.1'
port = 5050
log_path = Path(r'''C:\VSCode\ferginand_frontend\frontend_restart.log''')

def log(message: str) -> None:
    with log_path.open('a', encoding='utf-8') as f:
        f.write(f'[{time.strftime("%Y-%m-%d %H:%M:%S")}] {message}\n')

def port_is_free(host: str, port: int) -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.settimeout(0.25)
        return s.connect_ex((host, port)) != 0
    finally:
        s.close()

try:
    log('Restart helper started')
    deadline = time.time() + 20
    while time.time() < deadline:
        if port_is_free(host, port):
            log(f'Port {host}:{port} is free')
            break
        time.sleep(0.25)

    creationflags = 0
    if os.name == 'nt':
        creationflags = subprocess.CREATE_NO_WINDOW

    subprocess.Popen(
        [str(python_exe), str(app_file)],
        cwd=str(project_root),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        creationflags=creationflags,
        close_fds=True,
    )
    log('New frontend process started')
except Exception as exc:
    log(f'ERROR: {exc!r}')
    raise
