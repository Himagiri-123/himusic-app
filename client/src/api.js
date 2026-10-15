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
    const err = new Error(data.error || "Request failed");
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  register: (b) => request("/api/auth/register", { method: "POST", body: b }),
  login: (b) => request("/api/auth/login", { method: "POST", body: b }),
  search: (q) => request(`/api/music/search?q=${encodeURIComponent(q)}`),
  stream: (id) => request(`/api/music/stream/${id}`),
  library: () => request("/api/library"),
  like: (song) => request("/api/library/like", { method: "POST", body: song }),
  addHistory: (song) => request("/api/library/history", { method: "POST", body: song }),
  createPlaylist: (name) => request("/api/library/playlists", { method: "POST", body: { name } }),
  deletePlaylist: (id) => request(`/api/library/playlists/${id}`, { method: "DELETE" }),
  addToPlaylist: (id, song) =>
    request(`/api/library/playlists/${id}/songs`, { method: "POST", body: song }),
  removeFromPlaylist: (id, sid) =>
    request(`/api/library/playlists/${id}/songs/${sid}`, { method: "DELETE" }),
};
