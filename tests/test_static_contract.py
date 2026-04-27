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
        "cmd.search_tracks",
        "cmd.seek",
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
        "track_search.snapshot",
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
        "trackSearchBox",
        "trackSearchInput",
        "trackSearchPanel",
        "trackSearchResults",
        "trackSearchStatus",
    ]:
        assert f'id="{element_id}"' in html


def test_track_search_ui_contract():
    source = APP_JS.read_text(encoding="utf-8")
    html = INDEX_HTML.read_text(encoding="utf-8")

    assert "SEARCH_DEBOUNCE_MS" in source
    assert "SEARCH_RATE_WINDOW_MS" in source
    assert "SEARCH_RATE_MAX" in source
    assert "scheduleTrackSearch" in source
    assert "applySearchSnapshot" in source
    assert "requestId = options.requestId" in source
    assert 'draggable="true" data-url' in source
    assert "ondblclick" in source
    assert "Search saved tracks or artists" in html


def test_playhead_seek_ui_contract():
    source = APP_JS.read_text(encoding="utf-8")
    html = INDEX_HTML.read_text(encoding="utf-8")

    assert 'id="playheadSeek"' in html
    assert 'type="range"' in html
    assert 'aria-label="Seek playback position"' in html
    assert "SEEK_RESET_MS" in source
    assert "wirePlayheadSeek" in source
    assert "seekToPosition" in source
    assert "resetPlayheadToServerEstimate" in source
    assert 'sendCommand("cmd.seek", { position: target }' in source
    assert "{ requestId, toastAck: false, timeoutMs: SEEK_RESET_MS }" in source
    assert 'addEventListener("input", updateSeekPreview)' in source
    assert 'addEventListener("pointerup"' in source


def test_playhead_uses_host_position_anchor_not_started_at():
    source = APP_JS.read_text(encoding="utf-8")

    assert "getHostPosition" in source
    assert "positionMs" in source
    assert "positionUpdatedAt" in source
    assert "now?.paused !== false" in source
    assert "startedAt" not in source
