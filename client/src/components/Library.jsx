import { useState } from "react";
import { useApp } from "../store.jsx";
import SongRow from "./SongRow.jsx";

export default function Library() {
  const { lib, createPlaylist, deletePlaylist, removeFromPlaylist } = useApp();
  const [tab, setTab] = useState("liked");
  const [openId, setOpenId] = useState(null);
  const [name, setName] = useState("");

  const open = lib.playlists.find((p) => p._id === openId);

  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    await createPlaylist(name.trim());
    setName("");
  };

  return (
    <div>
      <div className="tabs">
        {[
          ["liked", "Liked"],
          ["history", "Recent"],
          ["playlists", "Playlists"],
        ].map(([k, label]) => (
          <button
            key={k}
            className={tab === k ? "on" : ""}
            onClick={() => {
              setTab(k);
              setOpenId(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "liked" && (
        <section>
          {lib.liked.length === 0 && <p className="muted center">No liked songs yet</p>}
          {lib.liked.map((s) => (
            <SongRow key={s.id} song={s} list={lib.liked} />
          ))}
        </section>
      )}

      {tab === "history" && (
        <section>
          {lib.history.length === 0 && <p className="muted center">Nothing played yet</p>}
          {lib.history.map((s) => (
            <SongRow key={s.id} song={s} list={lib.history} />
          ))}
        </section>
      )}

      {tab === "playlists" && !open && (
        <section>
          <form className="search" onSubmit={add}>
            <input
              placeholder="New playlist name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="primary">Create</button>
          </form>
          {lib.playlists.length === 0 && <p className="muted center">No playlists yet</p>}
          {lib.playlists.map((p) => (
            <div key={p._id} className="row">
              <button className="row-main" onClick={() => setOpenId(p._id)}>
                <div className="pl-cover">♪</div>
                <div className="meta">
                  <div className="title">{p.name}</div>
                  <div className="artist">{p.songs.length} songs</div>
                </div>
              </button>
              <button
                className="icon-btn"
                title="Delete playlist"
                onClick={() => confirm(`Delete "${p.name}"?`) && deletePlaylist(p._id)}
              >
                🗑
              </button>
            </div>
          ))}
        </section>
      )}

      {tab === "playlists" && open && (
        <section>
          <button className="link" onClick={() => setOpenId(null)}>← All playlists</button>
          <h2>{open.name}</h2>
          {open.songs.length === 0 && <p className="muted center">Empty. Add songs using ＋ in search.</p>}
          {open.songs.map((s) => (
            <SongRow
              key={s.id}
              song={s}
              list={open.songs}
              onRemove={(song) => removeFromPlaylist(open._id, song.id)}
            />
          ))}
        </section>
      )}
    </div>
  );
}
