import { useApp } from "../store.jsx";
import { useNav } from "../nav.jsx";
import { useDownloads } from "../downloads.jsx";
import Cover from "./Cover.jsx";
import Icon from "./Icon.jsx";

export default function Library() {
  const { lib, setEditor, user } = useApp();
  const nav = useNav();
  const dl = useDownloads();

  return (
    <div className="page">
      <header className="page-head">
        <div className="head-left">
          <div className="avatar small">{(user?.name || "U").trim()[0].toUpperCase()}</div>
          <h1>Your Library</h1>
        </div>
        <button className="ic big" onClick={() => setEditor({})} aria-label="Create playlist">
          <Icon name="plus" size={28} />
        </button>
      </header>

      <div className="list">
        <button className="lib-row" onClick={() => nav.push({ type: "liked" })}>
          <div className="cover liked-cover" style={{ width: 56, height: 56 }}>
            <Icon name="heartFill" size={26} />
          </div>
          <div className="meta">
            <div className="title">Liked Songs</div>
            <div className="sub">Playlist · {lib.liked.length} songs</div>
          </div>
        </button>

        <button className="lib-row" onClick={() => nav.push({ type: "history" })}>
          <Cover src={lib.history[0]?.thumbnail} size={56} icon="library" />
          <div className="meta">
            <div className="title">Recently played</div>
            <div className="sub">History · {lib.history.length} songs</div>
          </div>
        </button>

        <button className="lib-row" onClick={() => nav.push({ type: "downloads" })}>
          <div className="cover dl-cover" style={{ width: 56, height: 56 }}>
            <Icon name="downloaded" size={28} />
          </div>
          <div className="meta">
            <div className="title">Downloaded</div>
            <div className="sub">Offline · {dl.items.length} songs · {(dl.bytes / 1048576).toFixed(0)} MB</div>
          </div>
        </button>

        {lib.playlists.map((p) => (
          <button key={p._id} className="lib-row" onClick={() => nav.push({ type: "playlist", id: p._id })}>
            <Cover src={p.cover || p.songs[0]?.thumbnail} size={56} icon="library" />
            <div className="meta">
              <div className="title">{p.name}</div>
              <div className="sub">Playlist · {p.songs.length} songs</div>
            </div>
          </button>
        ))}

        <button className="lib-row" onClick={() => setEditor({})}>
          <div className="cover add-cover" style={{ width: 56, height: 56 }}>
            <Icon name="plus" size={28} />
          </div>
          <div className="meta">
            <div className="title">Create playlist</div>
            <div className="sub">Give it a name and a photo</div>
          </div>
        </button>
      </div>
    </div>
  );
}
