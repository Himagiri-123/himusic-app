import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api";

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const slim = (s) => ({
  id: s.id,
  title: s.title,
  artist: s.artist,
  thumbnail: s.thumbnail,
  duration: s.duration,
});

const EMPTY = { liked: [], history: [], playlists: [] };
const readLib = (uid) => {
  try {
    return JSON.parse(localStorage.getItem("hm_lib_" + uid)) || EMPTY;
  } catch {
    return EMPTY;
  }
};

export function AppProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("hm_user") || "null");
    } catch {
      return null;
    }
  });
  const [lib, setLib] = useState(() => {
    try {
      const u = JSON.parse(localStorage.getItem("hm_user") || "null");
      return u ? readLib(u.id) : EMPTY;
    } catch {
      return EMPTY;
    }
  });
  const [libLoaded, setLibLoaded] = useState(false);
  const [menu, setMenu] = useState(null); // { song, onRemove }
  const [picker, setPicker] = useState(null); // song to add to a playlist
  const [editor, setEditor] = useState(null); // {} = new playlist, { playlist } = edit
  const [toast, setToast] = useState("");
  const [collabs, setCollabs] = useState([]); // shared playlists I'm part of
  const [importOpen, setImportOpen] = useState(false);
  const [wrappedOpen, setWrappedOpen] = useState(false);
  const toastTimer = useRef();

  const showToast = useCallback((m) => {
    setToast(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2200);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("hm_token");
    localStorage.removeItem("hm_user");
    setUser(null);
    setLib(EMPTY);
    setLibLoaded(false);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLib(await api.library());
    } catch (e) {
      if (e.status === 401) return logout();
    }
    setLibLoaded(true);
  }, [logout]);

  const refreshCollabs = useCallback(async () => {
    try {
      setCollabs((await api.collabs()).collabs);
    } catch {}
  }, []);

  useEffect(() => {
    if (user) {
      refresh();
      refreshCollabs();
    } else setCollabs([]);
  }, [user, refresh, refreshCollabs]);

  const upsertCollab = (c) => setCollabs((l) => (l.some((x) => x.id === c.id) ? l.map((x) => (x.id === c.id ? c : x)) : [c, ...l]));
  const createCollab = async (name) => {
    const c = await api.createCollab(name);
    upsertCollab(c);
    showToast("Shared playlist created");
    return c;
  };
  const joinCollab = async (code) => {
    const c = await api.joinCollab(code);
    upsertCollab(c);
    return c;
  };
  const addToCollab = async (id, song) => {
    upsertCollab(await api.collabAdd(id, slim(song)));
    showToast("Added to shared playlist");
  };
  const removeFromCollab = async (id, sid) => upsertCollab(await api.collabRemove(id, sid));
  const leaveCollab = async (id) => {
    await api.collabLeave(id);
    setCollabs((l) => l.filter((x) => x.id !== id));
  };

  // keep a copy for offline use
  useEffect(() => {
    if (!user || !libLoaded) return;
    try {
      localStorage.setItem("hm_lib_" + user.id, JSON.stringify(lib));
    } catch {}
  }, [lib, libLoaded, user]);

  useEffect(() => {
    const h = () => logout();
    window.addEventListener("hm-unauthorized", h);
    return () => window.removeEventListener("hm-unauthorized", h);
  }, [logout]);

  // call with the {token,user} reply of login / verify / reset / (unverified) register
  const acceptAuth = (data) => {
    localStorage.setItem("hm_token", data.token);
    localStorage.setItem("hm_user", JSON.stringify(data.user));
    setUser(data.user);
    setLib(readLib(data.user.id));
  };
  const authenticate = async (mode, form) => {
    const data = await api[mode](form);
    if (data.token) acceptAuth(data);
    return data;
  };

  const isLiked = (id) => lib.liked.some((s) => s.id === id);

  const toggleLike = async (song) => {
    const was = isLiked(song.id);
    const s = slim(song);
    setLib((l) => ({ ...l, liked: was ? l.liked.filter((x) => x.id !== s.id) : [s, ...l.liked] }));
    showToast(was ? "Removed from Liked Songs" : "Added to Liked Songs");
    try {
      const r = await api.like(s);
      setLib((l) => ({ ...l, liked: r.liked }));
    } catch {
      refresh();
    }
  };

  const addHistory = useCallback(async (song) => {
    const s = slim(song);
    setLib((l) => ({ ...l, history: [s, ...l.history.filter((x) => x.id !== s.id)].slice(0, 50) }));
    try {
      const r = await api.addHistory(s);
      setLib((l) => ({ ...l, history: r.history }));
    } catch {}
  }, []);

  const setPlaylists = (r) => setLib((l) => ({ ...l, playlists: r.playlists }));

  const createPlaylist = async (name, cover = "") => {
    const r = await api.createPlaylist(name, cover);
    setPlaylists(r);
    showToast("Playlist created");
    return r.playlists[r.playlists.length - 1];
  };
  const updatePlaylist = async (id, patch) => {
    setPlaylists(await api.updatePlaylist(id, patch));
    showToast("Playlist updated");
  };
  const deletePlaylist = async (id) => {
    setPlaylists(await api.deletePlaylist(id));
    showToast("Playlist deleted");
  };
  const addToPlaylist = async (pid, song) => {
    setPlaylists(await api.addToPlaylist(pid, slim(song)));
    showToast("Added to playlist");
  };
  const removeFromPlaylist = async (pid, sid) => {
    setPlaylists(await api.removeFromPlaylist(pid, sid));
    showToast("Removed from playlist");
  };

  return (
    <Ctx.Provider
      value={{
        user, lib, libLoaded, menu, setMenu, picker, setPicker, editor, setEditor, toast, showToast,
        logout, authenticate, acceptAuth, isLiked, toggleLike, addHistory,
        collabs, upsertCollab, createCollab, joinCollab, addToCollab, removeFromCollab, leaveCollab, importOpen, setImportOpen, wrappedOpen, setWrappedOpen, refresh,
        createPlaylist, updatePlaylist, deletePlaylist, addToPlaylist, removeFromPlaylist,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
