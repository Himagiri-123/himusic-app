const BASE = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/$/, "");

async function request(path, { method = "GET", body } = {}) {
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
  stream: (id) => request(`/api/music/stream/${id}`),
  lyrics: (s) =>
    request(`/api/music/lyrics?title=${enc(s.title || "")}&artist=${enc(s.artist || "")}&duration=${Math.round(s.duration || 0)}`),

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
