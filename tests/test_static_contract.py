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
        "cmd.reorder_queue",
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
        "historyMostPanel",
        "favsPanel",
        "hostBadge",
        "relayBadge",
        "trackSearchBox",
        "trackSearchInput",
        "trackSearchPanel",
        "trackSearchResults",
        "trackSearchStatus",
        "tabMostPlayed",
        "tabHistory",
        "favs",
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
    assert "getPlayheadAnchorSignature" in source
    assert "setPlaybackNowFromHost" in source
    assert "anchorSignature" in source
    assert "anchorUpdatedAt" in source
    assert "positionMs" in source
    assert "positionUpdatedAt" in source
    assert "now?.paused !== false" in source
    assert "startedAt" not in source


def test_reconnect_requests_playhead_snapshot_immediately():
    source = APP_JS.read_text(encoding="utf-8")

    assert "function requestPlaybackSnapshot" in source
    assert "newPlayheadSnapshotRequestId" in source
    assert "playhead-reconnect-" in source
    assert '"cmd.get_snapshot"' in source
    assert 'sendRaw({ type: "snapshot", requestId: newPlayheadSnapshotRequestId() })' in source
    assert 'sendRaw({ type: "hello", role: profile.role, clientName: profile.clientName, serverId: profile.serverId, protocol: PROTOCOL_VERSION });\n        requestPlaybackSnapshot();' in source
    assert "requestPlaybackSnapshot();\n    state.resyncTimers" in source
    assert "const RESYNC_RETRY_DELAYS_MS = [1000, 3000, 7000]" in source


def test_relay_update_handlers_accept_payload_wrapped_messages():
    source = APP_JS.read_text(encoding="utf-8")

    assert "getMessageStatus" in source
    assert "getMessageNow" in source
    assert "getMessageQueue" in source
    assert "getMessageItems" in source
    assert 'ownProp(payload, "now")' in source
    assert 'ownProp(p.status, "hostConnected")' in source
    assert 'ownProp(nextStatus, "hostConnected")' in source
    assert "messageLooksLikeNowPayload(payload)" in source
    assert "Array.isArray(payload.queue)" in source
    assert "Array.isArray(payload.items)" in source
    assert 'getMessageItems(message, ["items", "history", "tracks"])' in source
    assert 'getMessageItems(message, ["items", "mostPlayed", "most_played", "tracks"])' in source


def test_enqueue_payload_includes_url_and_query_aliases():
    source = APP_JS.read_text(encoding="utf-8")

    assert 'sendCommand("cmd.enqueue", {' in source
    assert "url: cleaned" in source
    assert "query: cleaned" in source
    assert "clientId: state.profile.clientName" in source


def test_now_playing_metadata_does_not_duplicate_duration():
    source = APP_JS.read_text(encoding="utf-8")

    assert "bits.push(fmtDur(getDuration(now)))" not in source


def test_player_queue_remaining_counter_contract():
    source = APP_JS.read_text(encoding="utf-8")
    html = INDEX_HTML.read_text(encoding="utf-8")

    assert 'id="queueRemaining"' in html
    assert "fmtClockDur" in source
    assert "getQueueRemaining" in source
    assert "updateQueueRemainingUI(el)" in source
    assert "Queue finishes around" in source


def test_queue_reorder_ui_contract():
    source = APP_JS.read_text(encoding="utf-8")

    assert "QUEUE_REORDER_DRAG_MIME" in source
    assert "canReorderQueue" in source
    assert "wireQueueReorderActions" in source
    assert 'data-queue-index="${index}"' in source
    assert 'data-reorderable="${canMove ? "true" : "false"}"' in source
    assert 'sendCommand(\n        "cmd.reorder_queue"' in source
    assert "{ oldIndex: from, newIndex: to }" in source
    assert "state.reorder.rollbackQueue" in source
    assert "Queue reorder denied by relay permissions." in source


def test_favourites_ui_contract():
    source = APP_JS.read_text(encoding="utf-8")
    html = INDEX_HTML.read_text(encoding="utf-8")

    assert 'id="favsPanel"' in html
    assert 'id="favs"' in html
    assert 'id="tabMostPlayed"' in html
    assert 'id="tabHistory"' in html
    assert "favorite-toggle" in source
    assert "favouriteButtonHtml" in source
    assert 'fetch("/api/favourites"' in source
    assert "state.favourites.items" in source
