import { useApp } from "../store.jsx";
import { useState } from "react";
import { useNav } from "../nav.jsx";
import { useDownloads } from "../downloads.jsx";
import Cover from "./Cover.jsx";
import Icon from "./Icon.jsx";

export default function Library() {
  const { lib, setEditor, user, collabs, createCollab, setImportOpen, setWrappedOpen, showToast } = useApp();
  const [newCollab, setNewCollab] = useState(null); // null = closed, string = name being typed
  const makeCollab = async (e) => {
    e.preventDefault();
    if (!newCollab?.trim()) return;
    try {
      const c = await createCollab(newCollab.trim());
      setNewCollab(null);
      nav.push({ type: "collab", id: c.id });
    } catch (err) {
      showToast(err.message);
    }
  };
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

        <button className="lib-row" onClick={() => nav.push({ type: "local" })}>
          <div className="cover local-cover" style={{ width: 56, height: 56 }}>
            <Icon name="library" size={28} />
          </div>
          <div className="meta">
            <div className="title">On this device</div>
            <div className="sub">Music files on your phone</div>
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

        {collabs.map((c) => (
          <button key={c.id} className="lib-row" onClick={() => nav.push({ type: "collab", id: c.id })}>
            <div className="cover collab-cover" style={{ width: 56, height: 56 }}><Icon name="group" size={26} /></div>
            <div className="meta">
              <div className="title">{c.name}</div>
              <div className="sub">Shared · {c.members.length} people · {c.songs.length} songs</div>
            </div>
          </button>
        ))}

        <button className="lib-row" onClick={() => setNewCollab("")}>
          <div className="cover add-cover" style={{ width: 56, height: 56 }}><Icon name="group" size={26} /></div>
          <div className="meta">
            <div className="title">New shared playlist</div>
            <div className="sub">Add songs together with friends</div>
          </div>
        </button>

        <button className="lib-row" onClick={() => setImportOpen(true)}>
          <div className="cover add-cover" style={{ width: 56, height: 56 }}><Icon name="importList" size={26} /></div>
          <div className="meta">
            <div className="title">Import playlist</div>
            <div className="sub">From a YouTube or Spotify link</div>
          </div>
        </button>

        <button className="lib-row" onClick={() => setWrappedOpen(true)}>
          <div className="cover wrapped-cover" style={{ width: 56, height: 56 }}><Icon name="star" size={26} /></div>
          <div className="meta">
            <div className="title">Your HiMusic Wrapped</div>
            <div className="sub">Your year in music</div>
          </div>
        </button>

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
      {newCollab !== null && (
        <div className="modal-bg" onClick={() => setNewCollab(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={makeCollab}>
            <h3>New shared playlist</h3>
            <input placeholder="Playlist name" value={newCollab} onChange={(e) => setNewCollab(e.target.value)} maxLength={80} autoFocus />
            <p className="sub small">After creating it, send the invite link to your friends on WhatsApp.</p>
            <div className="modal-actions">
              <button type="button" className="link" onClick={() => setNewCollab(null)}>Cancel</button>
              <button className="btn-green small" disabled={!newCollab.trim()}>Create</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
