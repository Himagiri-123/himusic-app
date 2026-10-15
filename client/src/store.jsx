import { createContext, useCallback, useContext, useEffect, useState } from "react";
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

export function AppProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("hm_user") || "null");
    } catch {
      return null;
    }
  });
  const [lib, setLib] = useState({ liked: [], history: [], playlists: [] });
  const [picker, setPicker] = useState(null); // song to add to a playlist

  const logout = useCallback(() => {
    localStorage.removeItem("hm_token");
    localStorage.removeItem("hm_user");
    setUser(null);
    setLib({ liked: [], history: [], playlists: [] });
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLib(await api.library());
    } catch (e) {
      if (e.status === 401) logout();
    }
  }, [logout]);

  useEffect(() => {
    if (user) refresh();
  }, [user, refresh]);

  const authenticate = async (mode, form) => {
    const data = await api[mode](form);
    localStorage.setItem("hm_token", data.token);
    localStorage.setItem("hm_user", JSON.stringify(data.user));
    setUser(data.user);
  };

  const isLiked = (id) => lib.liked.some((s) => s.id === id);

  const toggleLike = async (song) => {
    const r = await api.like(slim(song));
    setLib((l) => ({ ...l, liked: r.liked }));
  };

  const addHistory = async (song) => {
    try {
      const r = await api.addHistory(slim(song));
      setLib((l) => ({ ...l, history: r.history }));
    } catch {}
  };

  const createPlaylist = async (name) => {
    const r = await api.createPlaylist(name);
    setLib((l) => ({ ...l, playlists: r.playlists }));
  };
  const deletePlaylist = async (id) => {
    const r = await api.deletePlaylist(id);
    setLib((l) => ({ ...l, playlists: r.playlists }));
  };
  const addToPlaylist = async (pid, song) => {
    const r = await api.addToPlaylist(pid, slim(song));
    setLib((l) => ({ ...l, playlists: r.playlists }));
  };
  const removeFromPlaylist = async (pid, sid) => {
    const r = await api.removeFromPlaylist(pid, sid);
    setLib((l) => ({ ...l, playlists: r.playlists }));
  };

  return (
    <Ctx.Provider
      value={{
        user,
        lib,
        picker,
        setPicker,
        logout,
        authenticate,
        isLiked,
        toggleLike,
        addHistory,
        createPlaylist,
        deletePlaylist,
        addToPlaylist,
        removeFromPlaylist,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
