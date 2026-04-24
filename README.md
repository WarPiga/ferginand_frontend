# Ferginánd Frontend

Local browser UI for controlling the Ferginánd Discord music bot through the Render WSS relay.

This project is intentionally a **local Flask runner + static frontend**. Each friend can run it on their own PC and use their own personal token. The frontend talks directly to the public Render WebSocket relay; Flask only serves the UI and injects local config from `.env`.

## What this does

- Connects to the Render `/ws` endpoint using raw WebSocket.
- Authenticates as `user` or `admin` with a personal token.
- Sends:
  - `cmd.enqueue`
  - `cmd.pause`
  - `cmd.resume`
  - `cmd.skip`
  - `cmd.stop` admin only in UI
  - `cmd.get_snapshot`
  - `cmd.get_history`
  - `cmd.get_most_played`
- Receives:
  - `welcome`
  - `snapshot`
  - `status.updated`
  - `now.updated`
  - `queue.updated`
  - `history.snapshot`
  - `most_played.snapshot`
  - `ack`
- Shows queue, player, history, most-played, relay status, host status, and command feedback.

## Setup

```bash
cd ferginand_frontend
python -m venv .venv
```

Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
notepad .env
python app.py
```

Linux/macOS:

```bash
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
nano .env
python app.py
```

Open:

```text
http://127.0.0.1:5050
```

## Per-friend token setup

Each friend should have their own `.env`:

```env
FRONTEND_RELAY_URL=wss://your-render-service.onrender.com/ws
FRONTEND_USER_TOKEN=friend_personal_token_here
FRONTEND_ROLE=user
FRONTEND_CLIENT_NAME=Friend Laptop
FRONTEND_REQUESTED_BY=FriendName
FRONTEND_SERVER_ID=main
FRONTEND_AUTO_CONNECT=true
```

For you/admin:

```env
FRONTEND_ROLE=admin
FRONTEND_USER_TOKEN=your_admin_token_here
```

Do not commit real `.env` files.

## Tests

```bash
pytest
```

## Notes

The token is sent to the browser because the browser itself must open the WSS connection. That is acceptable for this local-client model: every friend already has their own token. The important part is that friends only receive `user` tokens, never `admin`, `host`, or Discord bot tokens.

If a token leaks, revoke it on the Render relay by removing/changing it from `USER_TOKENS` or `ADMIN_TOKENS`.
