// filename: static/app.js
(() => {
  "use strict";

  const PROTOCOL_VERSION = 1;
  const MAX_RENDERED_ITEMS = 100;
  const $ = (id) => document.getElementById(id);

  const els = {
    relayBadge: $("relayBadge"),
    hostBadge: $("hostBadge"),
    roleBadge: $("roleBadge"),
    connState: $("connState"),
    lastAck: $("lastAck"),
    btnDisconnect: $("btnDisconnect"),
    q: $("q"),
    btnAdd: $("btnAdd"),
    btnPlayPause: $("btnPlayPause"),
    btnSkip: $("btnSkip"),
    btnStop: $("btnStop"),
    btnRefreshHistory: $("btnRefreshHistory"),
    btnRefreshMost: $("btnRefreshMost"),
    btnUpdateFrontend: $("btnUpdateFrontend"),
    btnRestartFrontend: $("btnRestartFrontend"),
    btnShutdownFrontend: $("btnShutdownFrontend"),
    queuePanel: $("queuePanel"),
    queue: $("queue"),
    history: $("history"),
    mostPlayed: $("mostPlayed"),
    stateLine: $("stateLine"),
    nowThumbLarge: $("nowThumbLarge"),
    nowTitle: $("nowTitle"),
    nowSub: $("nowSub"),
    playheadFill: $("playheadFill"),
    playheadText: $("playheadText"),
    toast: $("toast"),
  };

  const state = {
    ws: null,
    connected: false,
    manualDisconnect: false,
    reconnectAttempt: 0,
    reconnectTimer: null,
    heartbeatTimer: null,
    pending: new Map(),
    profile: {
      relayUrl: "",
      token: "",
      role: "user",
      requestedBy: "web-user",
      clientName: "web-client",
      serverId: "main",
    },
    relay: {
      hostConnected: false,
      connectedUsers: 0,
    },
    playback: {
      status: { state: "offline", hostConnected: false, voiceConnected: false },
      now: null,
      queue: [],
      history: [],
      mostPlayed: [],
    },
    frontend: {
      checkingUpdate: false,
      updateAvailable: false,
      updateError: "",
      ahead: 0,
      behind: 0,
      localSha: "",
      remoteSha: "",
    },
  };

  const playhead = {
    key: "",
    duration: 0,
    elapsed: 0,
    playing: false,
    lastTickMs: Date.now(),
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fmtDur(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return (h ? `${h}:` : "") + String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
  }

  function fmtDate(unix) {
    const n = Number(unix || 0);
    if (!Number.isFinite(n) || n <= 0) return "";
    return new Date(n * 1000).toLocaleString();
  }

  function newRequestId() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function getTrackUrl(t) {
    return String(t?.url || t?.webpage_url || t?.webpageUrl || t?.original_url || t?.originalUrl || "");
  }

  function getTrackTitle(t) {
    return String(t?.title || t?.name || "Track");
  }

  function getRequestedBy(t) {
    return String(t?.requestedBy || t?.requested_by || t?.who || "");
  }

  function getDuration(t) {
    return Number(t?.duration || t?.durationSeconds || 0) || 0;
  }

  function getPlayCount(t) {
    return Number(t?.play_count ?? t?.playCount ?? 0) || 0;
  }

  function getTrackKey(t) {
    return String(t?.itemId || t?.trackId || t?.track_id || t?.id || t?.sourceId || t?.source_id || getTrackUrl(t) || getTrackTitle(t));
  }

  function extractYouTubeId(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      if (host === "youtu.be") return u.pathname.replace(/^\//, "").split("/")[0] || "";
      if (host.includes("youtube.com")) {
        const v = u.searchParams.get("v");
        if (v) return v;
        const shorts = u.pathname.match(/\/shorts\/([^/?#]+)/i);
        if (shorts) return shorts[1];
        const embed = u.pathname.match(/\/embed\/([^/?#]+)/i);
        if (embed) return embed[1];
      }
    } catch (_) {}
    return "";
  }

  function getSourceLabel(t) {
    const explicit = String(t?.source || t?.platform || t?.extractor || "").toLowerCase();
    if (explicit.includes("soundcloud")) return "SC";
    if (explicit.includes("youtube") || explicit === "yt") return "YT";

    const url = getTrackUrl(t);
    if (!url) return "";

    try {
      const host = new URL(url).hostname.toLowerCase();
      if (host.includes("soundcloud.com")) return "SC";
      if (host.includes("youtube.com") || host.includes("youtu.be") || host.includes("music.youtube.com")) return "YT";
    } catch (_) {}

    return "";
  }

  function getThumb(t) {
    const direct = t?.thumbnail || t?.thumb || t?.artwork_url || t?.artworkUrl || "";
    if (direct) return direct;
    const ytid = extractYouTubeId(getTrackUrl(t));
    return ytid ? `https://i.ytimg.com/vi/${encodeURIComponent(ytid)}/mqdefault.jpg` : "";
  }

  function setBadge(el, ok, textOk, textNo) {
    if (!el) return;
    el.textContent = ok ? textOk : textNo;
    el.className = `badge ${ok ? "ok" : "no"}`;
  }

  function toast(message, ok = true) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.className = `toast ${ok ? "ok" : "err"}`;
    els.toast.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { els.toast.hidden = true; }, 4200);
  }

  function getActiveProfile() {
    return {
      relayUrl: state.profile.relayUrl || "",
      token: state.profile.token || "",
      role: state.profile.role || "user",
      requestedBy: state.profile.requestedBy || "web-user",
      clientName: state.profile.clientName || state.profile.requestedBy || "web-client",
      serverId: state.profile.serverId || "main",
      autoConnect: state.profile.autoConnect !== false,
    };
  }

  function buildWsUrl(profile) {
    const base = profile.relayUrl;
    const url = new URL(base);
    url.searchParams.set("role", profile.role);
    url.searchParams.set("token", profile.token);
    url.searchParams.set("serverId", profile.serverId || "main");
    url.searchParams.set("clientName", profile.clientName || "web-client");
    return url.toString();
  }

  function setControlsEnabled() {
    const canUse = state.connected && !!state.relay.hostConnected;
    const isAdmin = state.profile.role === "admin";
    [els.q, els.btnAdd, els.btnPlayPause, els.btnSkip, els.btnRefreshHistory, els.btnRefreshMost].forEach((el) => {
      if (el) el.disabled = !canUse;
    });
    if (els.btnStop) els.btnStop.disabled = !canUse || !isAdmin;
  }

  function renderConnection() {
    setBadge(els.relayBadge, state.connected, "Relay online", "Relay offline");
    setBadge(els.hostBadge, !!state.relay.hostConnected, "Host online", "Host offline");
    if (els.roleBadge) {
      els.roleBadge.textContent = state.profile.role || "user";
      els.roleBadge.className = "badge neutral";
    }
    if (els.connState) {
      const users = state.relay.connectedUsers ? ` • ${state.relay.connectedUsers} client(s)` : "";
      els.connState.textContent = state.connected ? `Connected${users}` : "Disconnected";
    }
    setControlsEnabled();
  }

  function setPlayheadUI(elapsed, duration) {
    const dur = Math.max(0, Number(duration) || 0);
    const el = Math.max(0, Math.min(dur || Number.MAX_SAFE_INTEGER, Number(elapsed) || 0));
    if (els.playheadFill) els.playheadFill.style.width = dur > 0 ? `${(el / dur) * 100}%` : "0%";
    if (els.playheadText) els.playheadText.textContent = dur > 0 ? `${fmtDur(el)} / ${fmtDur(dur)}` : "";
  }

  function syncPlayheadFromState() {
    const now = state.playback.now;
    const statusName = String(state.playback.status?.state || "idle").toLowerCase();
    const key = getTrackKey(now);
    const duration = getDuration(now);
    const paused = !!now?.paused || statusName === "paused";
    const playing = !!now && statusName === "playing" && !paused;
    const serverPosition = Number(now?.position || 0) || 0;
    const startedAt = Number(now?.startedAt || 0) || 0;
    const currentUnix = Date.now() / 1000;

    playhead.duration = duration;
    playhead.playing = playing;
    playhead.lastTickMs = Date.now();

    if (!now) {
      playhead.key = "";
      playhead.elapsed = 0;
      setPlayheadUI(0, 0);
      return;
    }

    const computedElapsed = playing && startedAt > 0
      ? Math.max(serverPosition, currentUnix - startedAt)
      : serverPosition;

    if (key !== playhead.key) {
      playhead.key = key;
      playhead.elapsed = computedElapsed;
    } else if (!playing || serverPosition > 0) {
      playhead.elapsed = computedElapsed;
    }

    setPlayheadUI(playhead.elapsed, playhead.duration);
  }

  function tickPlayhead() {
    const nowMs = Date.now();
    if (playhead.playing) {
      const dt = Math.max(0, (nowMs - playhead.lastTickMs) / 1000);
      playhead.elapsed += dt;
      if (playhead.duration > 0) playhead.elapsed = Math.min(playhead.elapsed, playhead.duration);
    }
    playhead.lastTickMs = nowMs;
    setPlayheadUI(playhead.elapsed, playhead.duration);
  }

  function getPlaceholderThumbnail() {
    return els.nowThumbLarge?.dataset?.placeholderThumbnail || "/static/ferg.png";
  }

  function setThumbImage(container, url, isPlaceholder = false) {
    if (!container) return;

    container.innerHTML = "";
    container.textContent = "";
    container.style.backgroundImage = "";
    container.classList.toggle("placeholder", isPlaceholder);

    const img = document.createElement("img");
    img.alt = "";
    img.loading = "eager";
    img.decoding = "async";
    img.src = url;

    img.onerror = () => {
      const placeholder = getPlaceholderThumbnail();
      if (img.src !== placeholder) {
        img.src = placeholder;
        container.classList.add("placeholder");
      }
    };

    container.appendChild(img);
  }

  function renderThumb(container, track) {
    if (!container) return;

    const placeholder = getPlaceholderThumbnail();
    const thumb = getThumb(track);

    setThumbImage(container, thumb || placeholder, !thumb);
  }

  function renderThumb(container, track) {
    if (!container) return;

    const placeholder = getPlaceholderThumbnail();
    const thumb = getThumb(track);
    setThumbImage(container, thumb || placeholder, !thumb);
  }

  function renderPlayer() {
    const now = state.playback.now;
    const statusName = String(state.playback.status?.state || (state.connected ? "idle" : "offline"));
    if (els.stateLine) els.stateLine.textContent = `State: ${statusName}`;

    if (!now) {
      if (els.nowTitle) els.nowTitle.textContent = "Nothing playing";
      if (els.nowSub) els.nowSub.textContent = "";
      renderThumb(els.nowThumbLarge, null);
      syncPlayheadFromState();
    } else {
      if (els.nowTitle) els.nowTitle.textContent = getTrackTitle(now);
      const bits = [];
      const source = getSourceLabel(now);
      if (source) bits.push(source);
      if (now.uploader) bits.push(String(now.uploader));
      if (getDuration(now)) bits.push(fmtDur(getDuration(now)));
      const requestedBy = getRequestedBy(now);
      if (requestedBy && !["web", "web-user"].includes(requestedBy.toLowerCase())) bits.push(requestedBy);
      if (els.nowSub) els.nowSub.textContent = bits.filter(Boolean).join(" • ");
      renderThumb(els.nowThumbLarge, now);
      syncPlayheadFromState();
    }

    if (els.btnPlayPause) {
      els.btnPlayPause.textContent = statusName.toLowerCase() === "playing" ? "⏸" : "▶";
    }
  }

  function itemMeta(track, mode) {
    const bits = [];
    const source = getSourceLabel(track);
    if (source) bits.push(source);
    if (track.uploader) bits.push(String(track.uploader));
    if (getDuration(track)) bits.push(fmtDur(getDuration(track)));

    if (mode === "history") {
      const when = fmtDate(track.ended_at || track.endedAt || track.started_at || track.startedAt || track.playedAt || track.last_played_at);
      if (when) bits.push(when);
      if (track.finish_reason || track.finishReason) bits.push(String(track.finish_reason || track.finishReason));
    }

    if (mode === "most") {
      bits.push(`${getPlayCount(track)} play(s)`);
    }

    return bits.filter(Boolean).join(" • ");
  }

  function renderItem(track, mode) {
    const url = getTrackUrl(track);
    const title = getTrackTitle(track);
    const thumb = getThumb(track);
    const draggable = mode === "history" || mode === "most";
    const dragAttrs = draggable
      ? `draggable="true" data-url="${encodeURIComponent(url)}"`
      : "";
    const thumbHtml = thumb
      ? `<img src="${escapeHtml(thumb)}" alt="">`
      : `<div class="thumb-fallback">♪</div>`;
    return `
      <div class="queue-item" ${dragAttrs}>
        ${thumbHtml}
        <div class="item-main">
          <div class="item-title">${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a>` : escapeHtml(title)}</div>
          <div class="meta">${escapeHtml(itemMeta(track, mode))}</div>
        </div>
      </div>`;
  }

  function renderList(el, items, mode, emptyText) {
    if (!el) return;
    const list = Array.isArray(items) ? items.slice(0, MAX_RENDERED_ITEMS) : [];
    el.innerHTML = list.length ? list.map((item) => renderItem(item, mode)).join("") : `<div class="meta">${escapeHtml(emptyText)}</div>`;
  }

  function renderAll() {
    renderConnection();
    renderPlayer();
    renderList(els.queue, state.playback.queue, "queue", "Empty");
    renderList(els.history, state.playback.history, "history", "Empty");
    renderList(els.mostPlayed, state.playback.mostPlayed, "most", "Empty");
    wireDynamicActions();
  }

  function applySnapshot(payload) {
    const p = payload || {};
    if (p.status) {
      state.playback.status = p.status;
      state.relay.hostConnected = !!p.status.hostConnected;
    }
    if (Object.prototype.hasOwnProperty.call(p, "now")) state.playback.now = p.now;
    if (Array.isArray(p.queue)) state.playback.queue = p.queue;
    if (Array.isArray(p.history)) state.playback.history = p.history;
    if (Array.isArray(p.mostPlayed)) state.playback.mostPlayed = p.mostPlayed;
    if (Array.isArray(p.most_played)) state.playback.mostPlayed = p.most_played;
    renderAll();
  }

  function handleMessage(message) {
    const type = message?.type;

    if (type === "welcome") {
      state.relay.hostConnected = !!message.hostConnected;
      state.relay.connectedUsers = Number(message.connectedUsers || 0) || 0;
      renderAll();
      sendCommand("cmd.get_snapshot", {}, { toastAck: false }).catch(() => {});
      sendCommand("cmd.get_history", { limit: MAX_RENDERED_ITEMS }, { toastAck: false }).catch(() => {});
      sendCommand("cmd.get_most_played", { limit: MAX_RENDERED_ITEMS }, { toastAck: false }).catch(() => {});
      return;
    }

    if (type === "snapshot") {
      applySnapshot(message.payload || {});
      return;
    }

    if (type === "status.updated") {
      state.playback.status = message.status || {};
      state.relay.hostConnected = !!state.playback.status.hostConnected;
      renderAll();
      return;
    }

    if (type === "now.updated") {
      state.playback.now = message.now || null;
      renderAll();
      return;
    }

    if (type === "queue.updated") {
      state.playback.queue = Array.isArray(message.queue) ? message.queue : [];
      renderAll();
      return;
    }

    if (type === "history.snapshot") {
      state.playback.history = Array.isArray(message.items) ? message.items : [];
      renderAll();
      return;
    }

    if (type === "most_played.snapshot") {
      state.playback.mostPlayed = Array.isArray(message.items) ? message.items : [];
      renderAll();
      return;
    }

    if (type === "ack") {
      const reqId = message.requestId;
      const pending = reqId ? state.pending.get(reqId) : null;
      if (pending) {
        clearTimeout(pending.timer);
        state.pending.delete(reqId);
        if (message.ok) pending.resolve(message);
        else pending.reject(new Error(message.error || "Command failed"));
      }
      if (els.lastAck) {
        els.lastAck.textContent = message.ok ? "Last command OK" : `Error: ${message.error || "command failed"}`;
      }
      return;
    }

    if (type === "ping") {
      sendRaw({ type: "pong", ts: message.ts || Math.floor(Date.now() / 1000) });
    }
  }

  function sendRaw(obj) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) throw new Error("WebSocket is not connected");
    state.ws.send(JSON.stringify(obj));
  }

  function sendCommand(type, payload = {}, options = {}) {
    const requestId = newRequestId();
    const message = { type, requestId, payload };
    sendRaw(message);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(requestId);
        reject(new Error(`Command timeout: ${type}`));
      }, options.timeoutMs || 15000);
      state.pending.set(requestId, { resolve, reject, timer, type });
    }).then((ack) => {
      if (options.toastAck !== false && type !== "cmd.get_snapshot") toast("Command accepted.");
      return ack;
    }).catch((err) => {
      if (options.toastAck !== false) toast(err.message, false);
      throw err;
    });
  }

  function startHeartbeat() {
    stopHeartbeat();
    state.heartbeatTimer = setInterval(() => {
      if (state.connected) {
        try { sendRaw({ type: "ping", ts: Math.floor(Date.now() / 1000) }); }
        catch (_) {}
      }
    }, 20000);
  }

  function stopHeartbeat() {
    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }

  function connect() {
    disconnect(false);
    const profile = getActiveProfile();
    if (!profile.relayUrl || !profile.token) {
      toast("Relay URL or token is missing. Check the local .env file.", false);
      return;
    }

    state.profile = profile;
    state.manualDisconnect = false;

    let url;
    try {
      url = buildWsUrl(profile);
    } catch (err) {
      toast(`Invalid relay URL: ${err.message}`, false);
      return;
    }

    try {
      const ws = new WebSocket(url);
      state.ws = ws;
      if (els.connState) els.connState.textContent = "Connecting…";

      ws.addEventListener("open", () => {
        state.connected = true;
        state.reconnectAttempt = 0;
        sendRaw({ type: "hello", role: profile.role, clientName: profile.clientName, serverId: profile.serverId, protocol: PROTOCOL_VERSION });
        startHeartbeat();
        renderAll();
        toast("Connected to relay.");
      });

      ws.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(event.data);
          handleMessage(message);
        } catch (err) {
          console.error("Invalid relay message", err, event.data);
        }
      });

      ws.addEventListener("close", () => {
        markDisconnected();
        scheduleReconnect();
      });

      ws.addEventListener("error", () => {
        // close will usually follow; keep this quiet to avoid duplicate noise
      });
    } catch (err) {
      markDisconnected();
      toast(`Connection failed: ${err.message}`, false);
      scheduleReconnect();
    }
  }

  function markDisconnected() {
    state.connected = false;
    state.relay.hostConnected = false;
    state.playback.status = { state: "offline", hostConnected: false, voiceConnected: false };
    stopHeartbeat();
    for (const [reqId, pending] of state.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Disconnected"));
      state.pending.delete(reqId);
    }
    renderAll();
  }

  function scheduleReconnect() {
    if (state.manualDisconnect) return;
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    const delay = Math.min(30000, 1000 * Math.pow(2, state.reconnectAttempt++));
    if (els.connState) els.connState.textContent = `Disconnected. Reconnecting in ${Math.round(delay / 1000)}s…`;
    state.reconnectTimer = setTimeout(connect, delay);
  }

  function disconnect(manual = true) {
    if (manual) state.manualDisconnect = true;
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    stopHeartbeat();
    if (state.ws) {
      try { state.ws.close(); } catch (_) {}
    }
    state.ws = null;
    markDisconnected();
  }

  async function enqueueUrl(url) {
    const cleaned = String(url || "").trim();
    if (!cleaned) return;
    await sendCommand("cmd.enqueue", {
      url: cleaned,
      requestedBy: state.profile.requestedBy || "web-user",
    });
    if (els.q && els.q.value.trim() === cleaned) els.q.value = "";
  }

  function wireDynamicActions() {
    document.querySelectorAll(".queue-item[draggable='true']").forEach((node) => {
      node.ondragstart = (event) => {
        const url = decodeURIComponent(node.getAttribute("data-url") || "");
        event.dataTransfer.setData("text/plain", url);
        event.dataTransfer.setData("application/json", JSON.stringify({ url }));
        event.dataTransfer.effectAllowed = "copy";
      };
    });
  }

  function wireDropTarget() {
    if (!els.queuePanel) return;
    els.queuePanel.addEventListener("dragover", (event) => {
      event.preventDefault();
      els.queuePanel.classList.add("drop-target");
    });
    els.queuePanel.addEventListener("dragleave", () => {
      els.queuePanel.classList.remove("drop-target");
    });
    els.queuePanel.addEventListener("drop", async (event) => {
      event.preventDefault();
      els.queuePanel.classList.remove("drop-target");
      let url = event.dataTransfer.getData("text/plain") || "";
      try {
        const obj = JSON.parse(event.dataTransfer.getData("application/json") || "{}");
        if (obj.url) url = obj.url;
      } catch (_) {}
      if (url) await enqueueUrl(url);
    });
  }

  async function getLocalJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `Request failed: ${response.status}`);
    }

    return data;
  }

  async function postLocalAction(url, confirmMessage) {
    if (confirmMessage && !window.confirm(confirmMessage)) {
      return null;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    let data = {};
    try {
      data = await response.json();
    } catch (_) {}

    if (!response.ok || data.ok === false) {
      const error = data.error || `Request failed: ${response.status}`;
      throw new Error(error);
    }

    return data;
  }

  function renderUpdateButton() {
    const btn = els.btnUpdateFrontend;
    if (!btn) return;

    btn.classList.toggle("update-ready", !!state.frontend.updateAvailable);

    if (state.frontend.checkingUpdate) {
      btn.disabled = true;
      btn.textContent = "⟳ Checking…";
      btn.title = "Checking GitHub for frontend updates";
      return;
    }

    if (state.frontend.updateAvailable) {
      btn.disabled = false;
      const count = state.frontend.behind || 1;
      btn.textContent = `⬇ Update UI (${count})`;
      btn.title = state.frontend.remoteSha
        ? `Update available: ${state.frontend.localSha} → ${state.frontend.remoteSha}`
        : "Frontend update available";
      return;
    }

    btn.disabled = true;
    btn.textContent = "✓ UI up to date";
    btn.title = state.frontend.updateError || "No frontend update available";
  }

  async function checkFrontendUpdate(showToast = false) {
    try {
      state.frontend.checkingUpdate = true;
      state.frontend.updateError = "";
      renderUpdateButton();

      const data = await getLocalJson("/api/frontend/update-status");

      state.frontend.updateAvailable = !!data.updateAvailable;
      state.frontend.ahead = Number(data.ahead || 0) || 0;
      state.frontend.behind = Number(data.behind || 0) || 0;
      state.frontend.localSha = data.localSha || "";
      state.frontend.remoteSha = data.remoteSha || "";

      if (showToast) {
        toast(state.frontend.updateAvailable ? "Frontend update available." : "Frontend is already up to date.");
      }
    } catch (err) {
      state.frontend.updateAvailable = false;
      state.frontend.updateError = err.message || "Could not check frontend update status.";
      if (showToast) toast(state.frontend.updateError, false);
    } finally {
      state.frontend.checkingUpdate = false;
      renderUpdateButton();
    }
  }

  async function updateFrontend() {
    if (!state.frontend.updateAvailable) {
      toast("No frontend update available.");
      return;
    }

    try {
      if (els.btnUpdateFrontend) els.btnUpdateFrontend.disabled = true;

      const data = await postLocalAction(
        "/api/frontend/update-and-restart",
        "Update frontend from Git and restart the local UI server?"
      );

      if (!data) return;

      toast(data.message || "Frontend update started. Reloading soon…");

      setTimeout(() => {
        window.location.reload();
      }, 5500);
    } catch (err) {
      toast(err.message || "Frontend update failed.", false);
      await checkFrontendUpdate(false);
    }
  }

  async function restartFrontend() {
    try {
      await postLocalAction(
        "/api/frontend/restart",
        "Restart the local Ferdinand frontend server?"
      );

      toast("Frontend server restarting…");

      setTimeout(() => {
        window.location.reload();
      }, 3000);
    } catch (err) {
      toast(err.message || "Restart failed.", false);
    }
  }

  async function shutdownFrontend() {
    try {
      const data = await postLocalAction(
        "/api/frontend/shutdown",
        "Shutdown the local Ferdinand frontend server on this PC?"
      );

      if (!data) return;

      toast("Frontend server shutting down…");

      setTimeout(() => {
        document.body.innerHTML = `
          <div style="padding:32px;font-family:system-ui;color:#e5e7eb;background:#0b1220;min-height:100vh">
            <h1>Ferginánd frontend stopped</h1>
            <p>The local frontend server has been shut down.</p>
            <p>You can start it again from Windows Startup on next login, or run <code>start_ferginand_frontend.bat</code>.</p>
          </div>
        `;
      }, 800);
    } catch (err) {
      toast(err.message || "Shutdown failed.", false);
    }
  }

  function wireStaticActions() {
    if (els.btnDisconnect) els.btnDisconnect.onclick = () => disconnect(true);
    els.btnAdd.onclick = () => enqueueUrl(els.q.value);
    els.q.addEventListener("keydown", (event) => {
      if (event.key === "Enter") enqueueUrl(els.q.value);
    });
    els.btnPlayPause.onclick = () => {
      const statusName = String(state.playback.status?.state || "idle").toLowerCase();
      if (statusName === "playing") sendCommand("cmd.pause");
      else sendCommand("cmd.resume");
    };
    els.btnSkip.onclick = () => sendCommand("cmd.skip");
    els.btnStop.onclick = () => sendCommand("cmd.stop");
    els.btnRefreshHistory.onclick = () => sendCommand("cmd.get_history", { limit: MAX_RENDERED_ITEMS }, { toastAck: false });
    els.btnRefreshMost.onclick = () => sendCommand("cmd.get_most_played", { limit: MAX_RENDERED_ITEMS }, { toastAck: false });

    if (els.btnUpdateFrontend) {
      els.btnUpdateFrontend.onclick = () => updateFrontend();
    }

    if (els.btnRestartFrontend) {
      els.btnRestartFrontend.onclick = () => restartFrontend();
    }

    if (els.btnShutdownFrontend) {
      els.btnShutdownFrontend.onclick = () => shutdownFrontend();
    }
  }

  async function loadServerConfig() {
    const response = await fetch("/api/client-config", { cache: "no-store" });
    if (!response.ok) throw new Error(`Config load failed: ${response.status}`);
    const cfg = await response.json();
    return {
      relayUrl: cfg.relayUrl || "",
      token: cfg.token || "",
      role: cfg.role || "user",
      requestedBy: cfg.requestedBy || "web-user",
      clientName: cfg.clientName || cfg.requestedBy || "web-client",
      serverId: cfg.serverId || "main",
      autoConnect: !!cfg.autoConnect,
    };
  }

  async function boot() {
    wireStaticActions();
    wireDropTarget();
    setInterval(tickPlayhead, 250);

    let cfg = { relayUrl: "", token: "", role: "user", requestedBy: "web-user", clientName: "web-client", serverId: "main", autoConnect: false };
    try { cfg = await loadServerConfig(); }
    catch (err) { console.warn(err); }

    state.profile = cfg;
    renderAll();
    checkFrontendUpdate(false);
    setInterval(() => checkFrontendUpdate(false), 5 * 60 * 1000);

    if (cfg.autoConnect !== false && cfg.relayUrl && cfg.token) connect();
  }

  window.FerginandFrontend = { connect, disconnect, sendCommand, state };
  boot();
})();