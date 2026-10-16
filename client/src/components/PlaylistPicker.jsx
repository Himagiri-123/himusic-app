import { useState } from "react";
import { useApp } from "../store.jsx";
import Cover from "./Cover.jsx";
import Icon from "./Icon.jsx";

export default function PlaylistPicker() {
  const { picker, setPicker, lib, addToPlaylist, createPlaylist } = useApp();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  if (!picker) return null;
  const close = () => setPicker(null);

  const pick = async (id) => {
    close();
    try {
      await addToPlaylist(id, picker);
    } catch {}
  };

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const p = await createPlaylist(name.trim());
      setName("");
      if (p) await pick(p._id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-bg" onClick={close}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3 className="sheet-title">Add to playlist</h3>
        <div className="sheet-scroll">
          {lib.playlists.length === 0 && <p className="sub pad">You have no playlists yet. Create one below.</p>}
          {lib.playlists.map((p) => (
            <button key={p._id} className="sheet-item" onClick={() => pick(p._id)}>
              <Cover src={p.cover || p.songs[0]?.thumbnail} size={44} icon="library" />
              <span>
                {p.name}
                <small className="sub"> · {p.songs.length} songs</small>
              </span>
            </button>
          ))}
        </div>
        <form className="inline-form" onSubmit={create}>
          <input placeholder="New playlist name" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn-green" disabled={busy}>
            <Icon name="plus" size={18} /> Create
          </button>
        </form>
      </div>
    </div>
  );
}
