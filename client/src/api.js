const BASE = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/$/, "");

async function request(path, { method = "GET", body } = {}) {
  // "Offline only" mode: the app makes no network calls at all (login/logout excluded)
  if (typeof window !== "undefined" && window.__hmOffline && !path.startsWith("/api/auth")) {
    const err = new Error("Offline mode is on");
    err.status = 0;
    err.offline = true;
    throw err;
  }
  const token = localStorage.getItem("hm_token");
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    if (res.status === 401 && token && !path.startsWith("/api/auth/")) window.dispatchEvent(new Event("hm-unauthorized"));
    const err = new Error(data.error || "Request failed");
    err.status = res.status;
    err.retryAfter = data.retryAfter;
    throw err;
  }
  return data;
}

export const API_BASE = BASE;
const enc = encodeURIComponent;

export const api = {
  register: (b) => request("/api/auth/register", { method: "POST", body: b }),
  login: (b) => request("/api/auth/login", { method: "POST", body: b }),
  verify: (b) => request("/api/auth/verify", { method: "POST", body: b }),
  resend: (b) => request("/api/auth/resend", { method: "POST", body: b }),
  forgot: (b) => request("/api/auth/forgot", { method: "POST", body: b }),
  reset: (b) => request("/api/auth/reset", { method: "POST", body: b }),

  search: (q) => request(`/api/music/search?q=${enc(q)}`),
  artists: (q) => request(`/api/music/artists?q=${enc(q)}`),
  suggest: (q) => request(`/api/music/suggest?q=${enc(q)}`),
  home: (artist) => request(`/api/music/home${artist ? `?artist=${enc(artist)}` : ""}`),
  stream: (id, q = "normal", song) =>
    request(`/api/music/stream/${id}?q=${q}${song?.title ? `&t=${enc(song.title)}&a=${enc(song.artist || "")}` : ""}`),
  related: (song, exclude = []) =>
    request(`/api/music/related?title=${enc(song.title || "")}&artist=${enc(song.artist || "")}&exclude=${enc(exclude.slice(-40).join(","))}`),
  lyrics: (s) =>
    request(`/api/music/lyrics?title=${enc(s.title || "")}&artist=${enc(s.artist || "")}&duration=${Math.round(s.duration || 0)}`),

  // sharing, shared playlists, import, wrapped
  sharePlaylist: (body) => request("/api/social/share", { method: "POST", body }),
  sharedPlaylist: (code) => request(`/api/social/share/${enc(code)}`),
  importPreview: (url) => request(`/api/social/import/preview?url=${enc(url)}`),
  bulkAdd: (pid, songs) => request(`/api/library/playlists/${pid}/songs/bulk`, { method: "POST", body: { songs } }),
  collabs: () => request("/api/social/collab"),
  collab: (id) => request(`/api/social/collab/${id}`),
  createCollab: (name) => request("/api/social/collab", { method: "POST", body: { name } }),
  joinCollab: (code) => request("/api/social/collab/join", { method: "POST", body: { code } }),
  collabAdd: (id, song) => request(`/api/social/collab/${id}/songs`, { method: "POST", body: song }),
  collabRemove: (id, sid) => request(`/api/social/collab/${id}/songs/${sid}`, { method: "DELETE" }),
  collabLeave: (id) => request(`/api/social/collab/${id}/leave`, { method: "POST" }),
  playStat: (song, secs) => request("/api/social/stats/play", { method: "POST", body: { ...song, secs } }),
  wrapped: (year) => request(`/api/social/stats/wrapped?year=${year}`),

  library: () => request("/api/library"),
  like: (song) => request("/api/library/like", { method: "POST", body: song }),
  addHistory: (song) => request("/api/library/history", { method: "POST", body: song }),
  createPlaylist: (name, cover = "") =>
    request("/api/library/playlists", { method: "POST", body: { name, cover } }),
  updatePlaylist: (id, patch) => request(`/api/library/playlists/${id}`, { method: "PATCH", body: patch }),
  deletePlaylist: (id) => request(`/api/library/playlists/${id}`, { method: "DELETE" }),
  addToPlaylist: (id, song) => request(`/api/library/playlists/${id}/songs`, { method: "POST", body: song }),
  removeFromPlaylist: (id, sid) => request(`/api/library/playlists/${id}/songs/${sid}`, { method: "DELETE" }),
};
