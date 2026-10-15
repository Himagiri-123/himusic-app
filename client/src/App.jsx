import { useState } from "react";
import { AppProvider, useApp } from "./store.jsx";
import { PlayerProvider } from "./PlayerContext.jsx";
import Auth from "./components/Auth.jsx";
import Home from "./components/Home.jsx";
import Library from "./components/Library.jsx";
import Player from "./components/Player.jsx";
import PlaylistPicker from "./components/PlaylistPicker.jsx";

function Shell() {
  const { user, logout } = useApp();
  const [tab, setTab] = useState("home");
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || "dark");

  if (!user) return <Auth />;

  const flip = () => {
    const t = theme === "dark" ? "light" : "dark";
    setTheme(t);
    document.documentElement.dataset.theme = t;
    localStorage.setItem("hm_theme", t);
  };

  return (
    <PlayerProvider>
      <div className="app">
        <header className="top">
          <h1 className="logo">Hi<span>Music</span></h1>
          <div className="top-actions">
            <button className="icon-btn" onClick={flip} title="Theme">
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
            <button className="icon-btn" onClick={logout} title="Logout">⎋</button>
          </div>
        </header>

        <main className="content">
          {tab === "home" ? <Home /> : <Library />}
        </main>

        <Player />

        <nav className="bottom-nav">
          <button className={tab === "home" ? "on" : ""} onClick={() => setTab("home")}>
            <span>🔍</span>Search
          </button>
          <button className={tab === "library" ? "on" : ""} onClick={() => setTab("library")}>
            <span>🎵</span>Library
          </button>
        </nav>
        <PlaylistPicker />
      </div>
    </PlayerProvider>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
