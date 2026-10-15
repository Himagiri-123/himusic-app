import { useState } from "react";
import { useApp } from "../store.jsx";

export default function PlaylistPicker() {
  const { picker, setPicker, lib, addToPlaylist, createPlaylist } = useApp();
  const [name, setName] = useState("");
  if (!picker) return null;

  const pick = async (id) => {
    await addToPlaylist(id, picker);
    setPicker(null);
  };

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    await createPlaylist(name.trim());
    setName("");
  };

  return (
    <div className="modal-bg" onClick={() => setPicker(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add to playlist</h3>
        <p className="muted small">{picker.title}</p>
        <div className="modal-list">
          {lib.playlists.length === 0 && <p className="muted">Create your first playlist below</p>}
          {lib.playlists.map((p) => (
            <button key={p._id} className="row-main pick" onClick={() => pick(p._id)}>
              <div className="pl-cover small">♪</div>
              <div className="title">{p.name}</div>
            </button>
          ))}
        </div>
        <form className="search" onSubmit={create}>
          <input placeholder="New playlist" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="primary">Create</button>
        </form>
        <button className="link" onClick={() => setPicker(null)}>Close</button>
      </div>
    </div>
  );
}
