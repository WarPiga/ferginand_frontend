# filename: tests/test_static_contract.py
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_JS = ROOT / "static" / "app.js"
INDEX_HTML = ROOT / "templates" / "index.html"


def test_frontend_uses_raw_websocket_not_socketio_or_rest_commands():
    source = APP_JS.read_text(encoding="utf-8")
    assert "new WebSocket" in source
    assert "socket.io" not in source.lower()
    assert "/api/enqueue" not in source
    assert "/api/skip" not in source
    assert "/api/pause" not in source
    assert "/api/resume" not in source


def test_frontend_sends_required_phase6_commands():
    source = APP_JS.read_text(encoding="utf-8")
    for command in [
        "cmd.enqueue",
        "cmd.pause",
        "cmd.resume",
        "cmd.skip",
        "cmd.stop",
        "cmd.get_snapshot",
        "cmd.get_history",
        "cmd.get_most_played",
    ]:
        assert command in source


def test_frontend_handles_required_relay_messages():
    source = APP_JS.read_text(encoding="utf-8")
    for message_type in [
        "welcome",
        "snapshot",
        "status.updated",
        "now.updated",
        "queue.updated",
        "history.snapshot",
        "most_played.snapshot",
        "ack",
    ]:
        assert message_type in source


def test_index_has_phase6_panels():
    html = INDEX_HTML.read_text(encoding="utf-8")
    for element_id in [
        "queuePanel",
        "playerPanel",
        "historyPanel",
        "mostPlayedPanel",
        "hostBadge",
        "relayBadge",
    ]:
        assert f'id="{element_id}"' in html
