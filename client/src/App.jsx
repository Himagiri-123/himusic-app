import { useCallback, useEffect, useMemo, useState } from "react";
import { AppProvider, useApp } from "./store.jsx";
import { DownloadsProvider } from "./downloads.jsx";
import { SettingsProvider } from "./settings.jsx";
import { useNav } from "./nav.jsx";
import Settings from "./components/Settings.jsx";
import ImportSheet from "./components/ImportSheet.jsx";
import Wrapped from "./components/Wrapped.jsx";
import Cover from "./components/Cover.jsx";
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

// Opens links friends send on WhatsApp: ?song=… (play a song), ?pl=… (shared playlist), ?join=… (shared playlist invite)
function IncomingLinks() {
  const nav = useNav();
  const { play } = usePlayer();
  const { joinCollab, showToast } = useApp();
  const [song, setSong] = useState(null);

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (!q.has("song") && !q.has("pl") && !q.has("join")) return;
    history.replaceState(history.state, "", location.pathname);
    if (q.get("song")) {
      const id = q.get("song");
      if (/^[\w-]{6,15}$/.test(id))
        setSong({ id, title: q.get("t") || "Shared song", artist: q.get("a") || "", thumbnail: q.get("th") || `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, duration: Number(q.get("d")) || 0 });
    } else if (q.get("pl")) nav.push({ type: "shared", code: q.get("pl") });
    else if (q.get("join"))
      joinCollab(q.get("join"))
        .then((c) => {
          showToast(`Joined "${c.name}"`);
          nav.push({ type: "collab", id: c.id });
        })
        .catch((e) => showToast(e.message));
  }, []); // eslint-disable-line

  if (!song) return null;
  return (
    <div className="modal-bg" onClick={() => setSong(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>A friend shared a song</h3>
        <div className="share-card">
          <Cover src={song.thumbnail} size={64} />
          <div className="meta"><div className="title">{song.title}</div><div className="sub">{song.artist}</div></div>
        </div>
        <div className="modal-actions">
          <button className="link" onClick={() => setSong(null)}>Not now</button>
          <button className="btn-green small" onClick={() => { play(song, [song]); setSong(null); }}>Play</button>
        </div>
      </div>
    </div>
  );
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

          <IncomingLinks />
          <SongMenu />
          <Settings />
          <ImportSheet />
          <Wrapped />
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
    <SettingsProvider>
      <AppProvider>
        <DownloadsProvider>
          <Shell />
        </DownloadsProvider>
      </AppProvider>
    </SettingsProvider>
  );
}
