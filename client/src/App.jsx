import { useCallback, useMemo, useState } from "react";
import { AppProvider, useApp } from "./store.jsx";
import { PlayerProvider, usePlayer } from "./PlayerContext.jsx";
import { NavCtx } from "./nav.jsx";
import { pushEntry, goBack, popAll } from "./historyStack.js";
import Auth from "./components/Auth.jsx";
import Home from "./components/Home.jsx";
import Search from "./components/Search.jsx";
import Library from "./components/Library.jsx";
import Collection from "./components/Collection.jsx";
import Player from "./components/Player.jsx";
import SongMenu from "./components/SongMenu.jsx";
import PlaylistPicker from "./components/PlaylistPicker.jsx";
import PlaylistEditor from "./components/PlaylistEditor.jsx";
import InstallBanner from "./components/InstallBanner.jsx";
import Icon from "./components/Icon.jsx";

const TABS = [
  ["home", "Home", "home"],
  ["search", "Search", "search"],
  ["library", "Your Library", "library"],
];

// toast sits above the bottom bar, or at the top while the full-screen player is open
function Toast() {
  const { toast } = useApp();
  const { expanded } = usePlayer();
  return toast ? <div className={"toast" + (expanded ? " top" : "")}>{toast}</div> : null;
}

function Main() {
  const [tab, setTab] = useState("home");
  const [stack, setStack] = useState([]); // artist / playlist / liked pages opened on top of a tab
  const [pendingQuery, setPendingQuery] = useState(null);

  const push = useCallback((view) => {
    setStack((s) => [...s, view]);
    pushEntry(() => setStack((s) => s.slice(0, -1)));
    window.scrollTo(0, 0);
  }, []);
  const back = useCallback(() => goBack(), []);
  const go = useCallback((t) => {
    popAll();
    setStack([]);
    setTab(t);
    window.scrollTo(0, 0);
  }, []);
  const searchFor = useCallback((text) => {
    popAll();
    setStack([]);
    setTab("search");
    setPendingQuery({ text });
    window.scrollTo(0, 0);
  }, []);
  const clearQuery = useCallback(() => setPendingQuery(null), []);

  const view = stack[stack.length - 1] || null;
  const nav = useMemo(
    () => ({ tab, stack, view, push, back, go, searchFor, pendingQuery, clearQuery }),
    [tab, stack, view, push, back, go, searchFor, pendingQuery, clearQuery]
  );
  const show = (t) => (tab === t && !view ? "" : "hide");

  return (
    <PlayerProvider>
      <NavCtx.Provider value={nav}>
        <div className="app">
          <main className="content">
            <InstallBanner />
            <div className={show("home")}>
              <Home />
            </div>
            <div className={show("search")}>
              <Search />
            </div>
            <div className={show("library")}>
              <Library />
            </div>
            {view && <Collection key={stack.length + ":" + (view.id || view.artist?.id || view.type)} view={view} />}
          </main>

          <Player />

          <nav className="bottom-nav" aria-label="Main">
            {TABS.map(([id, label, icon]) => (
              <button key={id} className={tab === id ? "on" : ""} onClick={() => go(id)}>
                <Icon name={icon} size={26} />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          <SongMenu />
          <PlaylistPicker />
          <PlaylistEditor />
          <Toast />
        </div>
      </NavCtx.Provider>
    </PlayerProvider>
  );
}

function Shell() {
  const { user } = useApp();
  return user ? <Main /> : <Auth />;
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
