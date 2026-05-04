# Browser WebSocket Relay Schematic

This document describes the WebSocket contract used by the local browser UI.
It is extracted from `static/app.js` and is intended as a relay/backend bug
fixing checklist.

## Scope

- The Flask app does not proxy music commands. It only serves the frontend and
  exposes `/api/client-config`.
- The browser opens the relay directly with raw `WebSocket`.
- The configured relay URL normally points at `/ws`.

## Connection Setup

Client config comes from `/api/client-config`:

```json
{
  "relayUrl": "wss://.../ws",
  "token": "user-or-admin-token",
  "role": "user",
  "clientName": "browser/client name",
  "requestedBy": "display requester",
  "serverId": "main",
  "autoConnect": true
}
```

The browser appends these query parameters to the WebSocket URL:

```text
role=<role>
token=<token>
serverId=<serverId>
clientName=<clientName>
```

Immediately after `open`, the browser sends:

```json
{
  "type": "hello",
  "role": "user",
  "clientName": "browser/client name",
  "serverId": "main",
  "protocol": 1
}
```

Then it immediately requests a playback snapshot with `cmd.get_snapshot`.

## Shared Command Envelope

Most browser-to-relay commands use:

```json
{
  "type": "cmd.some_command",
  "requestId": "uuid-or-playhead-reconnect-N",
  "payload": {}
}
```

The browser expects command acknowledgements:

```json
{
  "type": "ack",
  "requestId": "same requestId",
  "ok": true,
  "error": "optional error text"
}
```

Default command timeout is `15000` ms. Search uses `10000` ms. Seek uses
`2500` ms.

## Browser-To-Relay Messages

### `hello`

Sent once after socket open.

```json
{
  "type": "hello",
  "role": "user|admin",
  "clientName": "string",
  "serverId": "string",
  "protocol": 1
}
```

### `ping`

Sent every 20 seconds while connected.

```json
{
  "type": "ping",
  "ts": 1777900000
}
```

### `pong`

Sent in response to relay `ping`. It echoes relay `ts` if present.

```json
{
  "type": "pong",
  "ts": 1777900000
}
```

### `cmd.enqueue`

Triggered by add button, Enter in the URL input, double-clicking a history or
search item, or dropping a track URL into the queue panel.

```json
{
  "type": "cmd.enqueue",
  "requestId": "uuid",
  "payload": {
    "url": "https://...",
    "requestedBy": "web-user"
  }
}
```

### `cmd.pause`

Triggered by the play/pause button when current status state is `playing`.

```json
{
  "type": "cmd.pause",
  "requestId": "uuid",
  "payload": {}
}
```

### `cmd.resume`

Triggered by the play/pause button when current status state is not `playing`.

```json
{
  "type": "cmd.resume",
  "requestId": "uuid",
  "payload": {}
}
```

### `cmd.skip`

Triggered by the skip button.

```json
{
  "type": "cmd.skip",
  "requestId": "uuid",
  "payload": {}
}
```

### `cmd.stop`

Triggered by the stop button. The UI only enables this for `admin`, but the
relay should still enforce permissions server-side.

```json
{
  "type": "cmd.stop",
  "requestId": "uuid",
  "payload": {}
}
```

### `cmd.get_snapshot`

Requested after connect, after `welcome`, when host reconnects, after seek
reset, and during resync retries.

```json
{
  "type": "cmd.get_snapshot",
  "requestId": "playhead-reconnect-1",
  "payload": {}
}
```

Expected result is usually a separate inbound `snapshot` message, plus an
`ack` for the command request.

### Legacy/Fallback `snapshot` Request

If `cmd.get_snapshot` times out or fails, the browser currently falls back to
sending this raw message:

```json
{
  "type": "snapshot",
  "requestId": "playhead-reconnect-2"
}
```

This is client-to-relay despite `snapshot` also being a relay-to-browser update
type.

### `cmd.get_history`

Requested after welcome/host reconnection/resync and by the refresh history
button.

```json
{
  "type": "cmd.get_history",
  "requestId": "uuid",
  "payload": {
    "limit": 100
  }
}
```

Expected result is `history.snapshot`, plus `ack`.

### `cmd.get_most_played`

Requested after welcome/host reconnection/resync and by the refresh most-played
button.

```json
{
  "type": "cmd.get_most_played",
  "requestId": "uuid",
  "payload": {
    "limit": 100
  }
}
```

Expected result is `most_played.snapshot`, plus `ack`.

### `cmd.search_tracks`

Triggered by track search input after 2+ characters. Debounced by 240 ms and
client-rate-limited to 7 sends per 2 seconds.

```json
{
  "type": "cmd.search_tracks",
  "requestId": "uuid",
  "payload": {
    "query": "search text",
    "limit": 24,
    "clientId": "browser/client name"
  }
}
```

Expected result is `track_search.snapshot`, preferably with the same
`requestId`, plus `ack`.

### `cmd.seek`

Triggered by the playback range input. Payload `position` is seconds, rounded
to an integer.

```json
{
  "type": "cmd.seek",
  "requestId": "uuid",
  "payload": {
    "position": 123
  }
}
```

Expected result is `ack`. A follow-up `now.updated` or `snapshot` should include
the new position anchor.

## Relay-To-Browser Messages

### `welcome`

```json
{
  "type": "welcome",
  "hostConnected": true,
  "connectedUsers": 3
}
```

Effects:

- Updates relay/host badges.
- Schedules fresh state requests: immediate snapshot, then retries after
  1 second, 3 seconds, and 7 seconds.

### `snapshot`

The browser accepts either `payload` or `snapshot` as the snapshot object.

```json
{
  "type": "snapshot",
  "payload": {
    "status": {
      "state": "playing",
      "hostConnected": true,
      "voiceConnected": true
    },
    "now": {
      "title": "Track title",
      "url": "https://...",
      "duration": 240,
      "position": 12,
      "positionUpdatedAt": 1777900000,
      "paused": false
    },
    "queue": [],
    "history": [],
    "mostPlayed": []
  }
}
```

Also accepted:

- `most_played` instead of `mostPlayed`.
- `now: null` for no current track.
- `queue: []` for empty queue.

### `status.updated`

Accepted shapes:

```json
{ "type": "status.updated", "status": { "state": "playing", "hostConnected": true } }
```

```json
{ "type": "status.updated", "payload": { "status": { "state": "playing", "hostConnected": true } } }
```

```json
{ "type": "status.updated", "payload": { "state": "playing", "hostConnected": true } }
```

Effects:

- Updates playback status.
- Updates relay host state only when `hostConnected` is present.
- When host changes from offline to online, schedules fresh state requests.

### `now.updated`

Accepted shapes:

```json
{ "type": "now.updated", "now": { "title": "Track title" } }
```

```json
{ "type": "now.updated", "payload": { "now": { "title": "Track title" } } }
```

```json
{ "type": "now.updated", "payload": { "title": "Track title", "position": 12 } }
```

The direct payload form is accepted if the object has at least one of:

- `position`
- `positionMs`
- `positionUpdatedAt`
- `paused`
- `trackStartedAt`
- `title`

Important track fields the UI understands:

- Identity/title: `itemId`, `trackId`, `track_id`, `id`, `sourceId`,
  `source_id`, `url`, `webpage_url`, `webpageUrl`, `original_url`,
  `originalUrl`, `title`, `name`.
- Duration: `durationMs`, `lengthMs`, `duration`, `durationSeconds`.
- Position: `positionMs`, `position`, `positionSeconds`.
- Position timestamp: `positionUpdatedAt`, `position_updated_at`, `updatedAt`,
  `updated_at`.
- Playback: `paused`; playing is inferred when `paused === false`.
- Metadata/thumbs: `thumbnail`, `thumb`, `artwork_url`, `artworkUrl`,
  `uploader`, `artist`, `channel`, `source`, `provider`, `platform`,
  `extractor`, `sourceType`, `source_type`.

### `queue.updated`

Accepted shapes:

```json
{ "type": "queue.updated", "queue": [] }
```

```json
{ "type": "queue.updated", "payload": { "queue": [] } }
```

```json
{ "type": "queue.updated", "payload": { "items": [] } }
```

### `history.snapshot`

```json
{
  "type": "history.snapshot",
  "items": []
}
```

Only top-level `items` is currently read.

### `most_played.snapshot`

```json
{
  "type": "most_played.snapshot",
  "items": []
}
```

Only top-level `items` is currently read.

### `track_search.snapshot`

Accepted item shapes are the same as normal track items.

```json
{
  "type": "track_search.snapshot",
  "requestId": "same requestId from cmd.search_tracks",
  "query": "search text",
  "items": []
}
```

Also accepted:

```json
{
  "type": "track_search.snapshot",
  "requestId": "same requestId from cmd.search_tracks",
  "payload": {
    "query": "search text",
    "items": []
  }
}
```

If `requestId` is present and differs from the active search request, the
browser ignores the message. If `query` is present and differs from the current
input text, the browser ignores the message.

### `ack`

```json
{
  "type": "ack",
  "requestId": "same requestId from command",
  "ok": true
}
```

Failure shape:

```json
{
  "type": "ack",
  "requestId": "same requestId from command",
  "ok": false,
  "error": "permission denied"
}
```

The browser uses this to resolve or reject pending command promises.

### `ping`

Relay may send:

```json
{
  "type": "ping",
  "ts": 1777900000
}
```

Browser replies with `pong`.

## Resync Behavior

The browser aggressively asks for fresh state:

1. On socket open: sends `hello`, then `cmd.get_snapshot`.
2. On `welcome`: immediately asks for snapshot, then schedules retries at
   1 second, 3 seconds, and 7 seconds.
3. When `status.updated` changes host from disconnected to connected: repeats
   the fresh-state schedule.
4. A fresh-state retry sends `cmd.get_snapshot`, `cmd.get_history`, and
   `cmd.get_most_played`.

## Known Integration Issues / Bug-Finding Checklist

- `cmd.get_snapshot` should produce both an `ack` and a `snapshot`. Without an
  `ack`, the command promise times out and the browser sends the legacy
  client-to-relay `{ "type": "snapshot" }` fallback.
- `cmd.get_history`, `cmd.get_most_played`, `cmd.search_tracks`, and `cmd.seek`
  also expect `ack`. Snapshot-style result messages alone are not enough to
  clear the pending command.
- `history.snapshot` and `most_played.snapshot` only read top-level `items`.
  A payload-wrapped `{ payload: { items: [] } }` shape is not handled for these
  two messages.
- `track_search.snapshot` should include the original `requestId`. If omitted,
  the UI may still accept it, but stale results are harder to reject.
- `track_search.snapshot` should include the current query if available. If it
  includes a query that differs from the input, the browser ignores it.
- Seek works in seconds through `payload.position`; the playhead UI resets after
  2500 ms if no successful `ack` arrives.
- For smooth playhead updates, `now.updated` or `snapshot.now` should include
  `position` or `positionMs`, `positionUpdatedAt`, and `paused`. The browser no
  longer derives progress from `startedAt`.
- If the relay sends `hostConnected: false` with empty `now`/`queue`, the UI
  intentionally preserves the previous visible track/queue while marking the
  host offline. Send a later connected snapshot to refresh it.
- `README.md` is stale: it lists the older command/message set and omits
  `cmd.search_tracks`, `cmd.seek`, `track_search.snapshot`, `ping`, and `pong`.

## Source Pointers

- WebSocket URL/query setup: `static/app.js`, `buildWsUrl`.
- Socket lifecycle and initial `hello`: `static/app.js`, `connect`.
- Outbound command envelope: `static/app.js`, `sendCommand`.
- Inbound handlers: `static/app.js`, `handleMessage`.
- Snapshot parsing: `static/app.js`, `applySnapshot`, `getMessageStatus`,
  `getMessageNow`, `getMessageQueue`.
- Search flow: `static/app.js`, `runTrackSearch`, `applySearchSnapshot`.
- Seek flow: `static/app.js`, `seekToPosition`, `wirePlayheadSeek`.
- Static contract tests: `tests/test_static_contract.py`.
