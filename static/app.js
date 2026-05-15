// filename: static/app.js
(() => {
  "use strict";

  const PROTOCOL_VERSION = 1;
  const MAX_RENDERED_ITEMS = 100;
  const SEARCH_MIN_QUERY = 2;
  const SEARCH_LIMIT = 24;
  const SEARCH_DEBOUNCE_MS = 240;
  const SEARCH_RATE_WINDOW_MS = 2000;
  const SEARCH_RATE_MAX = 7;
  const RESYNC_RETRY_DELAYS_MS = [1000, 3000, 7000];
  const FRONTEND_UPDATE_CHECK_MS = 5 * 60 * 1000;
  const SEEK_RESET_MS = 2500;
  const QUEUE_REORDER_DRAG_MIME = "application/x-ferginand-queue-index";
  const SOURCE_FAVICONS = {
    YT: { name: "YouTube", url: "https://www.youtube.com/favicon.ico" },
    SC: { name: "SoundCloud", url: "https://soundcloud.com/favicon.ico" },
  };
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
    btnUpdateFrontend: $("btnUpdateFrontend"),
    btnRestartFrontend: $("btnRestartFrontend"),
    btnShutdownFrontend: $("btnShutdownFrontend"),
    trackSearchBox: $("trackSearchBox"),
    trackSearchInput: $("trackSearchInput"),
    trackSearchClear: $("trackSearchClear"),
    trackSearchPanel: $("trackSearchPanel"),
    trackSearchResults: $("trackSearchResults"),
    trackSearchStatus: $("trackSearchStatus"),
    queuePanel: $("queuePanel"),
    queue: $("queue"),
    history: $("history"),
    mostPlayed: $("mostPlayed"),
    favs: $("favs"),
    tabMostPlayed: $("tabMostPlayed"),
    tabHistory: $("tabHistory"),
    stateLine: $("stateLine"),
    nowThumbLarge: $("nowThumbLarge"),
    nowTitle: $("nowTitle"),
    nowSub: $("nowSub"),
    playhead: $("playhead"),
    playheadFill: $("playheadFill"),
    playheadSeek: $("playheadSeek"),
    playheadText: $("playheadText"),
    toast: $("toast"),
  };

  const state = {
    ws: null,
    connected: false,
    manualDisconnect: false,
    connectionSeq: 0,
    reconnectAttempt: 0,
    playheadReconnectSeq: 0,
    reconnectTimer: null,
    heartbeatTimer: null,
    playheadTimer: null,
    frontendUpdateTimer: null,
    resyncTimers: [],
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
    favourites: {
      items: [],
      keys: new Set(),
      saving: new Set(),
    },
    view: {
      historyMostTab: "most",
    },
    reorder: {
      pending: false,
      dragFromIndex: null,
      rollbackQueue: [],
      lastServerQueue: [],
      lastServerQueueKnown: false,
    },
    search: {
      query: "",
      items: [],
      loading: false,
      visible: false,
      activeRequestId: "",
      debounceTimer: null,
      sentAt: [],
      error: "",
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
    page: {
      visible: document.visibilityState !== "hidden",
      renderPending: false,
      needsFreshPlaybackState: false,
      needsFrontendUpdateCheck: false,
    },
  };

  const playhead = {
    key: "",
    duration: 0,
    elapsed: 0,
    previewElapsed: 0,
    playing: false,
    seeking: false,
    pointerSeeking: false,
    ignoreNextSeekChange: false,
    lastCommittedSeek: null,
    pendingSeekRequestId: "",
    pendingSeekTimer: null,
    anchorSignature: "",
    anchorUpdatedAt: 0,
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

  function newPlayheadSnapshotRequestId() {
    state.playheadReconnectSeq += 1;
    return `playhead-reconnect-${state.playheadReconnectSeq}`;
  }

  function getTrackUrl(t) {
    return String(t?.url || t?.webpage_url || t?.webpageUrl || t?.original_url || t?.originalUrl || "");
  }

  function getTrackTitle(t) {
    return String(t?.title || t?.name || "Track");
  }

  function getRequestedBy(t) {
    return String(t?.requestedBy || t?.requested_by || t?.who || "web");
  }

  function getTrackSourceLabel(t) {
    const raw = String(
      t?.source ||
      t?.provider ||
      t?.platform ||
      t?.extractor ||
      t?.sourceType ||
      t?.source_type ||
      ""
    ).toLowerCase();

    const url = getTrackUrl(t).toLowerCase();

    if (
      raw.includes("youtube") ||
      raw === "yt" ||
      url.includes("youtube.com") ||
      url.includes("youtu.be") ||
      url.startsWith("y:")
    ) {
      return "YT";
    }

    if (
      raw.includes("soundcloud") ||
      raw === "sc" ||
      url.includes("soundcloud.com") ||
      url.startsWith("s:")
    ) {
      return "SC";
    }

    return "";
  }

  function sourcePart(label) {
    return label ? { sourceLabel: label } : "";
  }

  function sourceBadgeHtml(label) {
    const info = SOURCE_FAVICONS[label];
    if (!info) return escapeHtml(label);

    return `<span class="source-mark" title="${escapeHtml(info.name)}">
      <img src="${escapeHtml(info.url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">
    </span>`;
  }

  function metaHtml(parts) {
    return parts
      .filter(Boolean)
      .map((part) => part?.sourceLabel ? sourceBadgeHtml(part.sourceLabel) : escapeHtml(part))
      .join('<span class="meta-sep"> • </span>');
  }

  function wireSourceIconFallbacks(root = document) {
    root.querySelectorAll(".source-mark img").forEach((img) => {
      img.onerror = () => { img.hidden = true; };
      if (img.complete && img.naturalWidth === 0) img.hidden = true;
    });
  }

  function secondsFromTimestamp(value) {
    if (value === null || value === undefined || value === "") return 0;
    if (typeof value === "string" && Number.isNaN(Number(value))) {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed / 1000 : 0;
    }

    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n > 100000000000 ? n / 1000 : n;
  }

  function getDuration(t) {
    const durationMs = Number(t?.durationMs ?? t?.lengthMs);
    if (Number.isFinite(durationMs) && durationMs > 0) return durationMs / 1000;
    return Number(t?.duration || t?.durationSeconds || 0) || 0;
  }

  function getHostPosition(t) {
    const positionMs = Number(t?.positionMs);
    if (Number.isFinite(positionMs) && positionMs >= 0) return positionMs / 1000;

    const position = Number(t?.position ?? t?.positionSeconds ?? 0);
    return Number.isFinite(position) && position >= 0 ? position : 0;
  }

  function getPositionUpdatedAt(t) {
    return secondsFromTimestamp(t?.positionUpdatedAt ?? t?.position_updated_at ?? t?.updatedAt ?? t?.updated_at);
  }

  function getPlayheadAnchorSignature(t, key) {
    if (!t) return "";
    return [
      key,
      t?.positionMs ?? "",
      t?.position ?? t?.positionSeconds ?? "",
      t?.positionUpdatedAt ?? t?.position_updated_at ?? t?.updatedAt ?? t?.updated_at ?? "",
      t?.paused === false ? "playing" : "paused",
    ].join("|");
  }

  function getPlayCount(t) {
    return Number(t?.play_count ?? t?.playCount ?? 0) || 0;
  }

  function getTrackKey(t) {
    return String(t?.itemId || t?.trackId || t?.track_id || t?.id || t?.sourceId || t?.source_id || getTrackUrl(t) || getTrackTitle(t));
  }

  function getFavouriteKey(t) {
    for (const field of [
      "itemId",
      "trackId",
      "track_id",
      "id",
      "sourceId",
      "source_id",
      "url",
      "webpage_url",
      "webpageUrl",
      "original_url",
      "originalUrl",
    ]) {
      const value = t?.[field];
      if (value) return String(value).trim();
    }

    const title = getTrackTitle(t).trim();
    const uploader = String(t?.uploader || t?.artist || t?.channel || "").trim();
    return `${title}|${uploader}`.replace(/^\|+|\|+$/g, "");
  }

  function isFavourited(track) {
    const key = getFavouriteKey(track);
    return !!key && state.favourites.keys.has(key);
  }

  function favouriteButtonHtml(track, mode, index = 0) {
    const key = getFavouriteKey(track);
    if (!key) return "";

    const active = isFavourited(track);
    const saving = state.favourites.saving.has(key);
    const label = active ? "Remove from favourites" : "Add to favourites";
    return `<button
      class="favorite-toggle${active ? " active" : ""}"
      type="button"
      data-favourite-mode="${escapeHtml(mode)}"
      data-favourite-index="${index}"
      aria-label="${label}"
      aria-pressed="${active ? "true" : "false"}"
      title="${label}"
      ${saving ? "disabled" : ""}
    >${active ? "&#9829;" : "&#9825;"}</button>`;
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
    [
      els.q,
      els.btnAdd,
      els.btnPlayPause,
      els.btnSkip,
      els.trackSearchInput,
    ].forEach((el) => {
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

  function clampPlayheadPosition(value, duration = playhead.duration) {
    const dur = Math.max(0, Number(duration) || 0);
    return Math.max(0, Math.min(dur || Number.MAX_SAFE_INTEGER, Number(value) || 0));
  }

  function canSeekPlayback(duration = playhead.duration) {
    return state.connected &&
      !!state.relay.hostConnected &&
      !!state.playback.now &&
      Number(duration) > 0;
  }

  function setPlayheadUI(elapsed, duration) {
    const dur = Math.max(0, Number(duration) || 0);
    const displayElapsed = playhead.seeking ? playhead.previewElapsed : elapsed;
    const el = clampPlayheadPosition(displayElapsed, dur);
    const canSeek = canSeekPlayback(dur);
    if (els.playheadFill) els.playheadFill.style.width = dur > 0 ? `${(el / dur) * 100}%` : "0%";
    if (els.playheadText) els.playheadText.textContent = dur > 0 ? `${fmtDur(el)} / ${fmtDur(dur)}` : "";
    if (els.playhead) {
      els.playhead.classList.toggle("seek-disabled", !canSeek);
      els.playhead.title = canSeek ? "Drag to seek" : "Seek is available while a track is loaded";
    }
    if (els.playheadSeek) {
      const max = dur > 0 ? Math.max(1, Math.round(dur)) : 0;
      els.playheadSeek.max = String(max);
      els.playheadSeek.value = String(Math.round(clampPlayheadPosition(el, max)));
      els.playheadSeek.disabled = !canSeek;
      els.playheadSeek.setAttribute("aria-valuemax", String(max));
      els.playheadSeek.setAttribute("aria-valuenow", String(Math.round(el)));
      els.playheadSeek.setAttribute("aria-valuetext", dur > 0 ? `${fmtDur(el)} of ${fmtDur(dur)}` : "No track loaded");
    }
  }

  function syncPlayheadFromState() {
    const now = state.playback.now;
    const key = getTrackKey(now);
    const duration = getDuration(now);
    const paused = now?.paused !== false;
    const playing = !!now && !paused;
    const hostPosition = getHostPosition(now);
    const positionUpdatedAt = getPositionUpdatedAt(now);
    const currentUnix = Date.now() / 1000;

    playhead.duration = duration;
    playhead.playing = playing;
    playhead.lastTickMs = Date.now();

    if (!now) {
      playhead.key = "";
      playhead.elapsed = 0;
      playhead.previewElapsed = 0;
      playhead.seeking = false;
      playhead.pointerSeeking = false;
      playhead.anchorSignature = "";
      playhead.anchorUpdatedAt = 0;
      setPlayheadUI(0, 0);
      return;
    }

    const anchorSignature = getPlayheadAnchorSignature(now, key);
    const hasNewHostAnchor = anchorSignature !== playhead.anchorSignature;
    const computedElapsed = playing && positionUpdatedAt > 0
      ? hostPosition + Math.max(0, currentUnix - positionUpdatedAt)
      : hostPosition;

    if (key !== playhead.key) {
      playhead.key = key;
      playhead.anchorSignature = anchorSignature;
      playhead.anchorUpdatedAt = positionUpdatedAt;
      playhead.elapsed = computedElapsed;
      playhead.previewElapsed = computedElapsed;
      playhead.seeking = false;
      playhead.pointerSeeking = false;
    } else if (hasNewHostAnchor && (
      !playing ||
      positionUpdatedAt <= 0 ||
      playhead.anchorUpdatedAt <= 0 ||
      positionUpdatedAt >= playhead.anchorUpdatedAt
    )) {
      playhead.anchorSignature = anchorSignature;
      playhead.anchorUpdatedAt = positionUpdatedAt;
      playhead.elapsed = computedElapsed;
      if (!playhead.seeking) playhead.previewElapsed = computedElapsed;
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
    img.onload = () => fitThumbImage(img);

    img.onerror = () => {
      const placeholder = getPlaceholderThumbnail();
      if (img.src !== placeholder) {
        img.src = placeholder;
        container.classList.add("placeholder");
      }
    };
    img.src = url;

    container.appendChild(img);
    if (img.complete) fitThumbImage(img);
  }

  function fitThumbImage(img) {
    const frame = img?.parentElement;
    if (!img || !frame) return;

    const frameRatio = frame.clientWidth && frame.clientHeight
      ? frame.clientWidth / frame.clientHeight
      : 1;
    const imageRatio = img.naturalWidth && img.naturalHeight
      ? img.naturalWidth / img.naturalHeight
      : frameRatio;

    if (imageRatio >= frameRatio) {
      img.style.width = "100%";
      img.style.height = "auto";
    } else {
      img.style.width = "auto";
      img.style.height = "100%";
    }
  }

  function fitRenderedThumbs(root = document) {
    root.querySelectorAll(".thumb-frame img, .player-thumb img").forEach((img) => {
      if (img.complete) fitThumbImage(img);
      else img.addEventListener("load", () => fitThumbImage(img), { once: true });
    });
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
      if (els.nowTitle) {
        const title = getTrackTitle(now);
        const url = getTrackUrl(now);
        const titleHtml = url
          ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a>`
          : escapeHtml(title);
        els.nowTitle.innerHTML = `<span class="title-text">${titleHtml}</span>${favouriteButtonHtml(now, "now", 0)}`;
      }
      const bits = [];
      const source = getSourceLabel(now);
      if (source) bits.push(sourcePart(source));
      if (now.uploader) bits.push(String(now.uploader));
      const requestedBy = getRequestedBy(now);
      if (requestedBy && !["web", "web-user"].includes(requestedBy.toLowerCase())) bits.push(requestedBy);
      if (els.nowSub) els.nowSub.innerHTML = metaHtml(bits);
      renderThumb(els.nowThumbLarge, now);
      syncPlayheadFromState();
    }

    if (els.btnPlayPause) {
      els.btnPlayPause.textContent = statusName.toLowerCase() === "playing" ? "⏸" : "▶";
    }
  }

  function itemMeta(track, mode) {
    const bits = [];

    const source = getTrackSourceLabel(track);
    if (source) bits.push(sourcePart(source));

    if (track.uploader) bits.push(String(track.uploader));
    if (getDuration(track)) bits.push(fmtDur(getDuration(track)));

    // History intentionally does not show:
    // - who added it
    // - played datetime
    // - completion / skipped / stopped status
    if (mode === "history") {
      return metaHtml(bits);
    }

    // Most played intentionally does not show:
    // - who added it
    // - last played datetime
    if (mode === "most") {
      bits.push(`${getPlayCount(track)} play(s)`);
    }

    return metaHtml(bits);
  }

  function searchMeta(track) {
    const bits = [];
    const source = getTrackSourceLabel(track);
    const uploader = track?.uploader || track?.artist || track?.channel || "";

    if (source) bits.push(sourcePart(source));
    if (uploader) bits.push(String(uploader));
    if (getDuration(track)) bits.push(fmtDur(getDuration(track)));
    if (getPlayCount(track)) bits.push(`${getPlayCount(track)} play(s)`);

    return metaHtml(bits);
  }

  function renderSearchResult(track, index = 0) {
    const url = getTrackUrl(track);
    const title = getTrackTitle(track);
    const thumb = getThumb(track);
    const draggable = !!url;
    const dragAttrs = draggable
      ? `draggable="true" data-url="${encodeURIComponent(url)}"`
      : "";
    const thumbHtml = thumb
      ? `<span class="thumb-frame"><img src="${escapeHtml(thumb)}" alt=""></span>`
      : `<span class="thumb-frame"><span class="thumb-fallback">♪</span></span>`;
    const linkHtml = url
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a>`
      : escapeHtml(title);

    return `
      <div class="queue-item search-result" ${dragAttrs} tabindex="0" title="Drag this track into the Queue panel, or double-click it to queue instantly.">
        ${thumbHtml}
        <div class="item-main">
          <div class="item-title">${linkHtml}</div>
          <div class="meta">${searchMeta(track)}</div>
        </div>
        <div class="item-actions">
          ${favouriteButtonHtml(track, "search", index)}
          ${draggable ? '<span class="drag-pill">Drag</span>' : ''}
        </div>
      </div>`;
  }

  function isAdmin() {
    return state.profile.role === "admin";
  }

  function canReorderQueue() {
    return isAdmin() &&
      state.connected &&
      !!state.relay.hostConnected &&
      !state.reorder.pending &&
      state.playback.queue.length > 1;
  }

  function moveQueueItem(items, fromIndex, toIndex) {
    const next = Array.isArray(items) ? items.slice() : [];
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= next.length ||
      toIndex >= next.length
    ) {
      return next;
    }

    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    return next;
  }

  function rememberServerQueue(queue) {
    const nextQueue = Array.isArray(queue) ? queue : [];
    state.reorder.lastServerQueue = nextQueue.slice();
    state.reorder.lastServerQueueKnown = true;
    state.playback.queue = nextQueue;
  }

  async function reorderQueue(fromIndex, toIndex) {
    const queue = state.playback.queue;
    const from = Number(fromIndex);
    const to = Number(toIndex);

    if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return;
    if (!canReorderQueue()) {
      if (!isAdmin()) toast("Only admins can reorder the queue.", false);
      return;
    }
    if (from < 0 || to < 0 || from >= queue.length || to >= queue.length) return;

    const previousQueue = queue.slice();
    const rollbackQueue = state.reorder.lastServerQueueKnown
      ? state.reorder.lastServerQueue.slice()
      : previousQueue;

    state.reorder.pending = true;
    state.reorder.rollbackQueue = rollbackQueue;
    state.reorder.dragFromIndex = null;
    state.playback.queue = moveQueueItem(previousQueue, from, to);
    renderAll();

    try {
      await sendCommand(
        "cmd.reorder_queue",
        { oldIndex: from, newIndex: to },
        { toastAck: false }
      );
      toast("Queue order updated.");
    } catch (err) {
      const latestServerQueue = state.reorder.lastServerQueueKnown
        ? state.reorder.lastServerQueue
        : state.reorder.rollbackQueue;
      state.playback.queue = latestServerQueue.slice();
      const message = String(err?.message || "");
      toast(message.toLowerCase().includes("permission")
        ? "Queue reorder denied by relay permissions."
        : message || "Queue reorder failed.", false);
    } finally {
      state.reorder.pending = false;
      state.reorder.dragFromIndex = null;
      state.reorder.rollbackQueue = [];
      renderAll();
    }
  }

  function getSearchQuery() {
    return String(els.trackSearchInput?.value || "").trim();
  }

  function renderSearchPanel() {
    if (!els.trackSearchInput || !els.trackSearchPanel || !els.trackSearchResults) return;

    const query = getSearchQuery();
    const usable = state.connected && !!state.relay.hostConnected;
    els.trackSearchInput.disabled = !usable;
    if (els.trackSearchClear) els.trackSearchClear.hidden = !query;

    if (!state.search.visible) {
      els.trackSearchPanel.hidden = true;
      return;
    }

    els.trackSearchPanel.hidden = false;

    if (!usable) {
      if (els.trackSearchStatus) els.trackSearchStatus.textContent = "Connect to host first";
      els.trackSearchResults.innerHTML = '<div class="search-empty">Search becomes available after the host is online.</div>';
      return;
    }

    if (query.length < SEARCH_MIN_QUERY) {
      if (els.trackSearchStatus) els.trackSearchStatus.textContent = `Type at least ${SEARCH_MIN_QUERY} characters`;
      els.trackSearchResults.innerHTML = '<div class="search-empty">Start typing a title or artist. Results can be dragged into Queue.</div>';
      return;
    }

    if (state.search.error) {
      if (els.trackSearchStatus) els.trackSearchStatus.textContent = "Search blocked";
      els.trackSearchResults.innerHTML = `<div class="search-empty error">${escapeHtml(state.search.error)}</div>`;
      return;
    }

    const items = Array.isArray(state.search.items) ? state.search.items : [];

    if (state.search.loading && !items.length) {
      if (els.trackSearchStatus) els.trackSearchStatus.textContent = "Searching…";
      els.trackSearchResults.innerHTML = `
        <div class="search-skeleton"></div>
        <div class="search-skeleton short"></div>
        <div class="search-skeleton"></div>`;
      return;
    }

    if (els.trackSearchStatus) {
      const suffix = state.search.loading ? " • updating…" : "";
      els.trackSearchStatus.textContent = `${items.length} result${items.length === 1 ? "" : "s"}${suffix}`;
    }

    els.trackSearchResults.innerHTML = items.length
      ? items.map((item, index) => renderSearchResult(item, index)).join("")
      : '<div class="search-empty">No saved tracks matched that search.</div>';
    wireDynamicActions();
    fitRenderedThumbs(els.trackSearchResults);
    wireSourceIconFallbacks(els.trackSearchResults);
  }

  function resetSearchResults(message = "") {
    state.search.items = [];
    state.search.loading = false;
    state.search.error = message;
    state.search.activeRequestId = "";
    renderSearchPanel();
  }

  function canSendSearchNow() {
    const now = Date.now();
    state.search.sentAt = state.search.sentAt.filter((ts) => now - ts < SEARCH_RATE_WINDOW_MS);
    if (state.search.sentAt.length >= SEARCH_RATE_MAX) return false;
    state.search.sentAt.push(now);
    return true;
  }

  async function runTrackSearch() {
    const query = getSearchQuery();
    if (query.length < SEARCH_MIN_QUERY) {
      resetSearchResults("");
      return;
    }

    if (!state.connected || !state.relay.hostConnected) {
      resetSearchResults("Connect to the host before searching.");
      return;
    }

    if (!canSendSearchNow()) {
      resetSearchResults("Slow down a bit. Search is rate-limited to protect the host.");
      return;
    }

    const requestId = newRequestId();
    state.search.query = query;
    state.search.loading = true;
    state.search.visible = true;
    state.search.activeRequestId = requestId;
    state.search.error = "";
    renderSearchPanel();

    try {
      await sendCommand(
        "cmd.search_tracks",
        {
          query,
          limit: SEARCH_LIMIT,
          clientId: state.profile.clientName || state.profile.requestedBy || "web-client",
        },
        { requestId, toastAck: false, timeoutMs: 10000 }
      );
      if (state.search.activeRequestId === requestId) {
        state.search.loading = false;
        renderSearchPanel();
      }
    } catch (err) {
      if (state.search.activeRequestId === requestId) {
        state.search.loading = false;
        state.search.error = err.message || "Search failed.";
        renderSearchPanel();
      }
    }
  }

  function scheduleTrackSearch() {
    if (!els.trackSearchInput) return;

    const query = getSearchQuery();
    state.search.visible = true;
    state.search.query = query;
    state.search.error = "";

    if (state.search.debounceTimer) clearTimeout(state.search.debounceTimer);

    if (query.length < SEARCH_MIN_QUERY) {
      resetSearchResults("");
      return;
    }

    state.search.loading = true;
    renderSearchPanel();
    state.search.debounceTimer = setTimeout(runTrackSearch, SEARCH_DEBOUNCE_MS);
  }

  function applySearchSnapshot(message) {
    const requestId = message?.requestId || "";
    const query = String(message?.query || message?.payload?.query || state.search.query || "");

    if (state.search.activeRequestId && requestId && requestId !== state.search.activeRequestId) {
      return;
    }

    if (query && query !== getSearchQuery()) {
      return;
    }

    state.search.items = Array.isArray(message?.items)
      ? message.items
      : Array.isArray(message?.payload?.items)
        ? message.payload.items
        : [];
    state.search.query = query;
    state.search.loading = false;
    state.search.visible = true;
    state.search.error = "";
    renderSearchPanel();
  }

  function renderItem(track, mode, index = 0, listLength = 0) {
    const url = getTrackUrl(track);
    const title = getTrackTitle(track);
    const thumb = getThumb(track);
    const isQueue = mode === "queue";
    const canMove = isQueue && canReorderQueue();
    const draggable = canMove || mode === "history" || mode === "most" || mode === "favs";
    const dragAttrs = canMove
      ? `draggable="true" aria-grabbed="false"`
      : draggable
        ? `draggable="true" data-url="${encodeURIComponent(url)}"`
        : "";
    const queueAttrs = isQueue
      ? `data-queue-index="${index}" data-reorderable="${canMove ? "true" : "false"}"`
      : "";
    const queueClass = isQueue
      ? ` queue-row${canMove ? " reorderable" : " reorder-disabled"}${state.reorder.pending ? " reorder-pending" : ""}`
      : "";
    const queueTitle = isQueue
      ? canMove
        ? "Drag to reorder queued tracks."
        : state.reorder.pending
          ? "Queue reorder is pending."
          : isAdmin()
            ? listLength > 1 ? "Connect to the host to reorder." : ""
            : "Only admins can reorder the queue."
      : "";
    const thumbHtml = thumb
      ? `<span class="thumb-frame"><img src="${escapeHtml(thumb)}" alt=""></span>`
      : `<span class="thumb-frame"><span class="thumb-fallback">♪</span></span>`;
    const handleHtml = isQueue
      ? `<span class="queue-drag-handle" aria-hidden="true">${canMove ? "Move" : ""}</span>`
      : "";
    return `
      <div class="queue-item${queueClass}" ${dragAttrs} ${queueAttrs} title="${escapeHtml(queueTitle)}">
        ${thumbHtml}
        <div class="item-main">
          <div class="item-title">${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a>` : escapeHtml(title)}</div>
          <div class="meta">${itemMeta(track, mode)}</div>
        </div>
        <div class="item-actions">
          ${favouriteButtonHtml(track, mode, index)}
        </div>
        ${handleHtml}
      </div>`;
  }

  function renderList(el, items, mode, emptyText) {
    if (!el) return;
    const list = Array.isArray(items) ? items.slice(0, MAX_RENDERED_ITEMS) : [];
    el.innerHTML = list.length ? list.map((item, index) => renderItem(item, mode, index, list.length)).join("") : `<div class="meta">${escapeHtml(emptyText)}</div>`;
  }

  function renderHistoryMostTabs() {
    const activeTab = state.view.historyMostTab === "history" ? "history" : "most";
    if (els.tabMostPlayed) {
      const active = activeTab === "most";
      els.tabMostPlayed.classList.toggle("active", active);
      els.tabMostPlayed.setAttribute("aria-selected", active ? "true" : "false");
    }
    if (els.tabHistory) {
      const active = activeTab === "history";
      els.tabHistory.classList.toggle("active", active);
      els.tabHistory.setAttribute("aria-selected", active ? "true" : "false");
    }
    if (els.mostPlayed) {
      els.mostPlayed.hidden = activeTab !== "most";
      els.mostPlayed.classList.toggle("active", activeTab === "most");
    }
    if (els.history) {
      els.history.hidden = activeTab !== "history";
      els.history.classList.toggle("active", activeTab === "history");
    }
  }

  function isPageForeground() {
    return document.visibilityState !== "hidden";
  }

  function renderAll(force = false) {
    if (!force && !isPageForeground()) {
      state.page.renderPending = true;
      return;
    }
    state.page.renderPending = false;
    renderConnection();
    renderPlayer();
    renderList(els.queue, state.playback.queue, "queue", "Empty");
    renderList(els.history, state.playback.history, "history", "Empty");
    renderList(els.mostPlayed, state.playback.mostPlayed, "most", "Empty");
    renderList(els.favs, state.favourites.items, "favs", "No favourites yet");
    renderHistoryMostTabs();
    renderSearchPanel();
    wireDynamicActions();
    fitRenderedThumbs();
    wireSourceIconFallbacks();
  }

  function clearResyncTimers() {
    state.resyncTimers.forEach((timer) => clearTimeout(timer));
    state.resyncTimers = [];
  }

  function requestPlaybackSnapshot(options = {}) {
    if (!state.connected) return;
    if (!options.force && !isPageForeground()) {
      state.page.needsFreshPlaybackState = true;
      return;
    }
    sendCommand(
      "cmd.get_snapshot",
      {},
      { requestId: newPlayheadSnapshotRequestId(), toastAck: false, timeoutMs: 5000 }
    ).catch(() => {
      if (!state.connected) return;
      try {
        sendRaw({ type: "snapshot", requestId: newPlayheadSnapshotRequestId() });
      } catch (_) {}
    });
  }

  function requestFreshPlaybackState(options = {}) {
    if (!state.connected) return;
    if (!options.force && !isPageForeground()) {
      state.page.needsFreshPlaybackState = true;
      return;
    }
    state.page.needsFreshPlaybackState = false;
    requestPlaybackSnapshot({ force: options.force });
    sendCommand("cmd.get_history", { limit: MAX_RENDERED_ITEMS }, { toastAck: false }).catch(() => {});
    sendCommand("cmd.get_most_played", { limit: MAX_RENDERED_ITEMS }, { toastAck: false }).catch(() => {});
  }

  function clearPendingSeekReset(requestId = "") {
    if (requestId && playhead.pendingSeekRequestId !== requestId) return;
    if (playhead.pendingSeekTimer) clearTimeout(playhead.pendingSeekTimer);
    playhead.pendingSeekTimer = null;
    if (!requestId || playhead.pendingSeekRequestId === requestId) {
      playhead.pendingSeekRequestId = "";
    }
  }

  function resetPlayheadToServerEstimate() {
    playhead.seeking = false;
    playhead.pointerSeeking = false;
    syncPlayheadFromState();
    requestFreshPlaybackState();
  }

  function scheduleFreshPlaybackStateRequests() {
    clearResyncTimers();
    if (!isPageForeground()) {
      state.page.needsFreshPlaybackState = true;
      return;
    }
    requestPlaybackSnapshot();
    state.resyncTimers = RESYNC_RETRY_DELAYS_MS.map((delay) => setTimeout(requestFreshPlaybackState, delay));
  }

  function setPlaybackNowFromHost(now) {
    state.playback.now = now;
    playhead.anchorSignature = "";
    playhead.anchorUpdatedAt = 0;
  }

  function ownProp(obj, key) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  }

  function objectPayload(message) {
    return message?.payload && typeof message.payload === "object" ? message.payload : {};
  }

  function messageLooksLikeNowPayload(value) {
    return !!value && typeof value === "object" && (
      ownProp(value, "position") ||
      ownProp(value, "positionMs") ||
      ownProp(value, "positionUpdatedAt") ||
      ownProp(value, "paused") ||
      ownProp(value, "trackStartedAt") ||
      ownProp(value, "title")
    );
  }

  function getMessageStatus(message) {
    const payload = objectPayload(message);
    if (message?.status) return message.status;
    if (payload.status) return payload.status;
    if (ownProp(payload, "state") || ownProp(payload, "hostConnected")) return payload;
    return {};
  }

  function getMessageNow(message) {
    const payload = objectPayload(message);
    if (ownProp(message, "now")) return message.now;
    if (ownProp(payload, "now")) return payload.now;
    if (messageLooksLikeNowPayload(payload)) return payload;
    return null;
  }

  function getMessageQueue(message) {
    const payload = objectPayload(message);
    if (Array.isArray(message?.queue)) return message.queue;
    if (Array.isArray(payload.queue)) return payload.queue;
    if (Array.isArray(payload.items)) return payload.items;
    return [];
  }

  function getMessageItems(message, keys = ["items"]) {
    const payload = objectPayload(message);
    for (const key of keys) {
      if (Array.isArray(message?.[key])) return message[key];
      if (Array.isArray(payload[key])) return payload[key];
    }
    return [];
  }

  function applySnapshot(payload) {
    const p = payload || {};
    const hasStatus = !!p.status;
    const statusHasHostConnected = hasStatus && ownProp(p.status, "hostConnected");
    const snapshotHostConnected = hasStatus
      ? (statusHasHostConnected ? !!p.status.hostConnected : !!state.relay.hostConnected)
      : !!state.relay.hostConnected;
    const hasNow = ownProp(p, "now");
    const hasQueue = Array.isArray(p.queue);
    const snapshotLooksLikeHostGap = !snapshotHostConnected &&
      hasNow &&
      !p.now &&
      hasQueue &&
      p.queue.length === 0 &&
      (!!state.playback.now || state.playback.queue.length > 0);

    if (p.status) {
      state.playback.status = snapshotLooksLikeHostGap
        ? { ...state.playback.status, hostConnected: false, voiceConnected: !!p.status.voiceConnected }
        : p.status;
      if (statusHasHostConnected) state.relay.hostConnected = !!p.status.hostConnected;
    }
    if (hasNow && !snapshotLooksLikeHostGap) setPlaybackNowFromHost(p.now);
    if (hasQueue && !snapshotLooksLikeHostGap) rememberServerQueue(p.queue);
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
      scheduleFreshPlaybackStateRequests();
      return;
    }

    if (type === "snapshot") {
      applySnapshot(message.payload || message.snapshot || {});
      return;
    }

    if (type === "status.updated") {
      const wasHostConnected = !!state.relay.hostConnected;
      const nextStatus = getMessageStatus(message);
      const statusHasHostConnected = ownProp(nextStatus, "hostConnected");
      const hostConnected = statusHasHostConnected ? !!nextStatus.hostConnected : wasHostConnected;
      const preservePlaybackStatus = statusHasHostConnected &&
        !hostConnected &&
        (!!state.playback.now || state.playback.queue.length > 0);
      state.playback.status = preservePlaybackStatus
        ? { ...state.playback.status, hostConnected: false, voiceConnected: !!nextStatus.voiceConnected }
        : nextStatus;
      if (statusHasHostConnected) state.relay.hostConnected = hostConnected;
      renderAll();
      if (!wasHostConnected && state.relay.hostConnected) {
        scheduleFreshPlaybackStateRequests();
      }
      return;
    }

    if (type === "now.updated") {
      const nextNow = getMessageNow(message);
      if (!state.relay.hostConnected && !nextNow && state.playback.now) {
        renderAll();
        return;
      }
      setPlaybackNowFromHost(nextNow);
      renderAll();
      return;
    }

    if (type === "queue.updated") {
      const nextQueue = getMessageQueue(message);
      if (!state.relay.hostConnected && nextQueue.length === 0 && state.playback.queue.length > 0) {
        renderAll();
        return;
      }
      rememberServerQueue(nextQueue);
      renderAll();
      return;
    }

    if (type === "history.snapshot") {
      state.playback.history = getMessageItems(message, ["items", "history", "tracks"]);
      renderAll();
      return;
    }

    if (type === "most_played.snapshot") {
      state.playback.mostPlayed = getMessageItems(message, ["items", "mostPlayed", "most_played", "tracks"]);
      renderAll();
      return;
    }

    if (type === "track_search.snapshot") {
      applySearchSnapshot(message);
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
    const requestId = options.requestId || newRequestId();
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

  function closeCurrentSocket() {
    const ws = state.ws;
    state.ws = null;
    if (ws) {
      try { ws.close(); } catch (_) {}
    }
  }

  function connect() {
    clearResyncTimers();
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    closeCurrentSocket();
    markDisconnected({ preservePlayback: true });
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
      const connectionSeq = ++state.connectionSeq;
      state.ws = ws;
      if (els.connState) els.connState.textContent = "Connecting…";

      ws.addEventListener("open", () => {
        if (ws !== state.ws || connectionSeq !== state.connectionSeq) {
          try { ws.close(); } catch (_) {}
          return;
        }
        state.connected = true;
        state.reconnectAttempt = 0;
        state.reconnectTimer = null;
        sendRaw({ type: "hello", role: profile.role, clientName: profile.clientName, serverId: profile.serverId, protocol: PROTOCOL_VERSION });
        requestPlaybackSnapshot();
        startHeartbeat();
        renderAll();
        toast("Connected to relay.");
      });

      ws.addEventListener("message", (event) => {
        if (ws !== state.ws || connectionSeq !== state.connectionSeq) return;
        try {
          const message = JSON.parse(event.data);
          handleMessage(message);
        } catch (err) {
          console.error("Invalid relay message", err, event.data);
        }
      });

      ws.addEventListener("close", () => {
        if (ws !== state.ws || connectionSeq !== state.connectionSeq) return;
        state.ws = null;
        markDisconnected({ preservePlayback: true });
        scheduleReconnect();
      });

      ws.addEventListener("error", () => {
        // close will usually follow; keep this quiet to avoid duplicate noise
      });
    } catch (err) {
      markDisconnected({ preservePlayback: true });
      toast(`Connection failed: ${err.message}`, false);
      scheduleReconnect();
    }
  }

  function markDisconnected(options = {}) {
    const preservePlayback = !!options.preservePlayback;
    state.connected = false;
    state.relay.hostConnected = false;
    state.playback.status = preservePlayback
      ? { ...state.playback.status, hostConnected: false, voiceConnected: false }
      : { state: "offline", hostConnected: false, voiceConnected: false };
    stopHeartbeat();
    for (const [reqId, pending] of state.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Disconnected"));
      state.pending.delete(reqId);
    }
    state.search.loading = false;
    state.search.activeRequestId = "";
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
    clearResyncTimers();
    stopHeartbeat();
    closeCurrentSocket();
    if (manual) state.connectionSeq += 1;
    markDisconnected({ preservePlayback: !manual });
  }

  async function enqueueUrl(url) {
    const cleaned = String(url || "").trim();
    if (!cleaned) return;
    await sendCommand("cmd.enqueue", {
      url: cleaned,
      query: cleaned,
      requestedBy: state.profile.requestedBy || "web-user",
      clientId: state.profile.clientName || state.profile.requestedBy || "web-client",
    });
    if (els.q && els.q.value.trim() === cleaned) els.q.value = "";
  }

  function getSeekInputPosition() {
    return clampPlayheadPosition(Number(els.playheadSeek?.value || 0), playhead.duration);
  }

  async function seekToPosition(position) {
    if (!canSeekPlayback()) return;

    const target = Math.round(clampPlayheadPosition(position));
    const requestId = newRequestId();
    clearPendingSeekReset();

    playhead.elapsed = target;
    playhead.previewElapsed = target;
    playhead.lastCommittedSeek = target;
    playhead.pendingSeekRequestId = requestId;
    setPlayheadUI(target, playhead.duration);

    playhead.pendingSeekTimer = setTimeout(() => {
      if (playhead.pendingSeekRequestId !== requestId) return;
      clearPendingSeekReset(requestId);
      resetPlayheadToServerEstimate();
    }, SEEK_RESET_MS);

    try {
      await sendCommand("cmd.seek", { position: target }, { requestId, toastAck: false, timeoutMs: SEEK_RESET_MS });
      clearPendingSeekReset(requestId);
    } catch (err) {
      clearPendingSeekReset(requestId);
      const message = String(err?.message || "");
      toast(message.toLowerCase().includes("permission")
        ? "Seek denied by relay permissions. Allow cmd.seek on the backend."
        : message || "Seek failed.", false);
      resetPlayheadToServerEstimate();
    }
  }

  function beginSeekPreview() {
    if (!canSeekPlayback()) return false;
    playhead.seeking = true;
    playhead.previewElapsed = getSeekInputPosition();
    setPlayheadUI(playhead.previewElapsed, playhead.duration);
    return true;
  }

  function updateSeekPreview() {
    if (!playhead.seeking && !beginSeekPreview()) return;
    playhead.previewElapsed = getSeekInputPosition();
    setPlayheadUI(playhead.previewElapsed, playhead.duration);
  }

  function finishSeekPreview(commit = true) {
    if (!playhead.seeking) return;
    const target = getSeekInputPosition();
    playhead.seeking = false;
    playhead.pointerSeeking = false;
    setPlayheadUI(commit ? target : playhead.elapsed, playhead.duration);
    if (commit) seekToPosition(target);
  }

  function wirePlayheadSeek() {
    if (!els.playheadSeek) return;

    els.playheadSeek.addEventListener("pointerdown", (event) => {
      if (!beginSeekPreview()) return;
      playhead.pointerSeeking = true;
      try { els.playheadSeek.setPointerCapture(event.pointerId); } catch (_) {}
    });

    els.playheadSeek.addEventListener("input", updateSeekPreview);

    els.playheadSeek.addEventListener("pointerup", () => {
      if (!playhead.pointerSeeking) return;
      playhead.ignoreNextSeekChange = true;
      finishSeekPreview(true);
    });

    els.playheadSeek.addEventListener("pointercancel", () => {
      finishSeekPreview(false);
    });

    els.playheadSeek.addEventListener("change", () => {
      const target = Math.round(getSeekInputPosition());
      if (playhead.ignoreNextSeekChange && target === playhead.lastCommittedSeek) {
        playhead.ignoreNextSeekChange = false;
        return;
      }
      playhead.ignoreNextSeekChange = false;
      playhead.seeking = false;
      playhead.pointerSeeking = false;
      seekToPosition(target);
    });
  }

  function wireDynamicActions() {
    document.querySelectorAll(".favorite-toggle").forEach((node) => {
      node.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleFavouriteFromButton(node);
      };
      node.ondragstart = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };
    });

    document.querySelectorAll(".queue-item[draggable='true'][data-url]").forEach((node) => {
      const getNodeUrl = () => decodeURIComponent(node.getAttribute("data-url") || "");

      node.ondragstart = (event) => {
        const url = getNodeUrl();
        event.dataTransfer.setData("text/plain", url);
        event.dataTransfer.setData("application/json", JSON.stringify({ url }));
        event.dataTransfer.effectAllowed = "copy";
      };

      node.ondblclick = async () => {
        const url = getNodeUrl();
        if (url) await enqueueUrl(url);
      };

      node.onkeydown = async (event) => {
        if (event.key === "Enter") {
          const url = getNodeUrl();
          if (url) await enqueueUrl(url);
        }
      };
    });
    wireQueueReorderActions();
  }

  function getQueueDragIndex(event) {
    const raw = event.dataTransfer?.getData(QUEUE_REORDER_DRAG_MIME) || "";
    if (!raw && state.reorder.dragFromIndex === null) return null;
    const index = Number(raw || state.reorder.dragFromIndex);
    return Number.isInteger(index) ? index : null;
  }

  function isQueueReorderDrag(event) {
    return Array.from(event.dataTransfer?.types || []).includes(QUEUE_REORDER_DRAG_MIME);
  }

  function clearQueueDropIndicators() {
    document.querySelectorAll(".queue-row.drop-before, .queue-row.drop-after").forEach((node) => {
      node.classList.remove("drop-before", "drop-after");
    });
  }

  function getQueueDropIndex(node, event, fromIndex) {
    const targetIndex = Number(node.getAttribute("data-queue-index"));
    if (!Number.isInteger(targetIndex)) return fromIndex;

    const rect = node.getBoundingClientRect();
    const afterTarget = event.clientY > rect.top + (rect.height / 2);
    const targetPosition = targetIndex + (afterTarget ? 1 : 0);
    const adjusted = fromIndex < targetPosition ? targetPosition - 1 : targetPosition;
    return Math.max(0, Math.min(state.playback.queue.length - 1, adjusted));
  }

  function showQueueDropIndicator(node, event) {
    clearQueueDropIndicators();
    const rect = node.getBoundingClientRect();
    const afterTarget = event.clientY > rect.top + (rect.height / 2);
    node.classList.add(afterTarget ? "drop-after" : "drop-before");
  }

  function wireQueueReorderActions() {
    document.querySelectorAll(".queue-row").forEach((node) => {
      if (node.getAttribute("data-reorderable") !== "true") return;

      node.ondragstart = (event) => {
        if (!canReorderQueue()) {
          event.preventDefault();
          return;
        }
        const index = Number(node.getAttribute("data-queue-index"));
        if (!Number.isInteger(index)) {
          event.preventDefault();
          return;
        }

        state.reorder.dragFromIndex = index;
        node.classList.add("dragging");
        node.setAttribute("aria-grabbed", "true");
        event.dataTransfer.setData(QUEUE_REORDER_DRAG_MIME, String(index));
        event.dataTransfer.effectAllowed = "move";
      };

      node.ondragover = (event) => {
        const fromIndex = getQueueDragIndex(event);
        if (!canReorderQueue() || fromIndex === null) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        showQueueDropIndicator(node, event);
      };

      node.ondragleave = () => {
        node.classList.remove("drop-before", "drop-after");
      };

      node.ondrop = (event) => {
        const fromIndex = getQueueDragIndex(event);
        if (!canReorderQueue() || fromIndex === null) return;
        event.preventDefault();
        event.stopPropagation();
        const toIndex = getQueueDropIndex(node, event, fromIndex);
        clearQueueDropIndicators();
        reorderQueue(fromIndex, toIndex);
      };

      node.ondragend = () => {
        node.classList.remove("dragging");
        node.setAttribute("aria-grabbed", "false");
        state.reorder.dragFromIndex = null;
        clearQueueDropIndicators();
      };
    });
  }

  function wireDropTarget() {
    if (!els.queuePanel) return;
    els.queuePanel.addEventListener("dragover", (event) => {
      if (isQueueReorderDrag(event)) return;
      event.preventDefault();
      els.queuePanel.classList.add("drop-target");
    });
    els.queuePanel.addEventListener("dragleave", () => {
      els.queuePanel.classList.remove("drop-target");
    });
    els.queuePanel.addEventListener("drop", async (event) => {
      if (isQueueReorderDrag(event)) return;
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

  function setFavourites(items, keys = null) {
    const nextItems = Array.isArray(items) ? items.filter((item) => !!getFavouriteKey(item)) : [];
    state.favourites.items = nextItems;
    state.favourites.keys = new Set(Array.isArray(keys) && keys.length ? keys.map(String) : nextItems.map(getFavouriteKey));
  }

  async function loadFavourites() {
    try {
      const data = await getLocalJson("/api/favourites");
      setFavourites(data.items, data.keys);
      renderAll(true);
    } catch (err) {
      toast(err.message || "Could not load favourites.", false);
    }
  }

  async function updateFavourite(track, favourited) {
    const key = getFavouriteKey(track);
    if (!key || state.favourites.saving.has(key)) return;

    state.favourites.saving.add(key);
    renderAll();

    try {
      const response = await fetch("/api/favourites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track, favourited }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || `Request failed: ${response.status}`);
      }
      setFavourites(data.items, data.keys);
    } catch (err) {
      toast(err.message || "Could not update favourites.", false);
    } finally {
      state.favourites.saving.delete(key);
      renderAll();
    }
  }

  function getFavouriteTrack(mode, index) {
    if (mode === "now") return state.playback.now;
    if (mode === "search") return state.search.items[index];
    if (mode === "queue") return state.playback.queue[index];
    if (mode === "history") return state.playback.history[index];
    if (mode === "most") return state.playback.mostPlayed[index];
    if (mode === "favs") return state.favourites.items[index];
    return null;
  }

  async function toggleFavouriteFromButton(button) {
    const mode = button.getAttribute("data-favourite-mode") || "";
    const index = Number(button.getAttribute("data-favourite-index") || 0);
    const track = getFavouriteTrack(mode, Number.isInteger(index) ? index : 0);
    if (!track) return;
    await updateFavourite(track, !isFavourited(track));
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

  async function checkFrontendUpdate(showToast = false, options = {}) {
    if (!options.force && !showToast && !isPageForeground()) {
      state.page.needsFrontendUpdateCheck = true;
      return;
    }

    try {
      state.page.needsFrontendUpdateCheck = false;
      state.frontend.checkingUpdate = true;
      state.frontend.updateError = "";
      renderUpdateButton();

      const data = await getLocalJson("/api/frontend/update-status");

      state.frontend.updateAvailable = !!data.updateAvailable;
      state.frontend.ahead = Number(data.ahead || 0) || 0;
      state.frontend.behind = Number(data.behind || 0) || 0;
      state.frontend.localSha = data.localSha || "";
      state.frontend.remoteSha = data.remoteSha || "";
      state.frontend.updateError = data.updateError || "";

      if (showToast) {
        toast(state.frontend.updateError || (state.frontend.updateAvailable ? "Frontend update available." : "Frontend is already up to date."), !state.frontend.updateError);
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

    if (els.trackSearchInput) {
      els.trackSearchInput.addEventListener("input", scheduleTrackSearch);
      els.trackSearchInput.addEventListener("focus", () => {
        state.search.visible = true;
        renderSearchPanel();
        if (getSearchQuery().length >= SEARCH_MIN_QUERY && !state.search.items.length) {
          scheduleTrackSearch();
        }
      });
      els.trackSearchInput.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          state.search.visible = false;
          renderSearchPanel();
          els.trackSearchInput.blur();
        }
      });
    }

    if (els.trackSearchClear) {
      els.trackSearchClear.onclick = () => {
        if (state.search.debounceTimer) clearTimeout(state.search.debounceTimer);
        if (els.trackSearchInput) {
          els.trackSearchInput.value = "";
          els.trackSearchInput.focus();
        }
        state.search.visible = true;
        resetSearchResults("");
      };
    }

    document.addEventListener("pointerdown", (event) => {
      if (!state.search.visible || !els.trackSearchBox) return;
      if (!els.trackSearchBox.contains(event.target)) {
        state.search.visible = false;
        renderSearchPanel();
      }
    });
    els.btnPlayPause.onclick = () => {
      const statusName = String(state.playback.status?.state || "idle").toLowerCase();
      if (statusName === "playing") sendCommand("cmd.pause");
      else sendCommand("cmd.resume");
    };
    els.btnSkip.onclick = () => sendCommand("cmd.skip");
    els.btnStop.onclick = () => sendCommand("cmd.stop");

    if (els.btnUpdateFrontend) {
      els.btnUpdateFrontend.onclick = () => updateFrontend();
    }

    if (els.btnRestartFrontend) {
      els.btnRestartFrontend.onclick = () => restartFrontend();
    }

    if (els.btnShutdownFrontend) {
      els.btnShutdownFrontend.onclick = () => shutdownFrontend();
    }

    if (els.tabMostPlayed) {
      els.tabMostPlayed.onclick = () => {
        state.view.historyMostTab = "most";
        renderHistoryMostTabs();
      };
    }

    if (els.tabHistory) {
      els.tabHistory.onclick = () => {
        state.view.historyMostTab = "history";
        renderHistoryMostTabs();
      };
    }
  }

  function startForegroundTimers() {
    if (!isPageForeground()) return;
    if (!state.playheadTimer) {
      playhead.lastTickMs = Date.now();
      state.playheadTimer = setInterval(tickPlayhead, 250);
    }
    if (!state.frontendUpdateTimer) {
      state.frontendUpdateTimer = setInterval(() => checkFrontendUpdate(false), FRONTEND_UPDATE_CHECK_MS);
    }
  }

  function stopForegroundTimers() {
    if (state.playheadTimer) clearInterval(state.playheadTimer);
    if (state.frontendUpdateTimer) clearInterval(state.frontendUpdateTimer);
    state.playheadTimer = null;
    state.frontendUpdateTimer = null;
  }

  function handleVisibilityChange() {
    const visible = isPageForeground();
    state.page.visible = visible;

    if (!visible) {
      stopForegroundTimers();
      clearResyncTimers();
      state.page.needsFreshPlaybackState = true;
      return;
    }

    startForegroundTimers();
    playhead.lastTickMs = Date.now();
    renderAll(true);
    requestFreshPlaybackState({ force: true });
    checkFrontendUpdate(false, { force: true });
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
    wirePlayheadSeek();
    window.addEventListener("resize", () => fitRenderedThumbs());
    document.addEventListener("visibilitychange", handleVisibilityChange);
    startForegroundTimers();

    let cfg = { relayUrl: "", token: "", role: "user", requestedBy: "web-user", clientName: "web-client", serverId: "main", autoConnect: false };
    try { cfg = await loadServerConfig(); }
    catch (err) { console.warn(err); }

    state.profile = cfg;
    await loadFavourites();
    renderAll(true);
    checkFrontendUpdate(false);

    if (cfg.autoConnect !== false && cfg.relayUrl && cfg.token) connect();
  }

  window.FerginandFrontend = { connect, disconnect, sendCommand, state };
  boot();
})();
