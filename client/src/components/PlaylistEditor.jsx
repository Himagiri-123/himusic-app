import { useEffect, useRef, useState } from "react";
import { useApp } from "../store.jsx";
import { fileToCover } from "../hooks.js";
import Cover from "./Cover.jsx";
import Icon from "./Icon.jsx";

// create a playlist, or edit name + photo of an existing one
export default function PlaylistEditor() {
  const { editor, setEditor, createPlaylist, updatePlaylist, showToast } = useApp();
  const [name, setName] = useState("");
  const [cover, setCover] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const editing = editor?.playlist;

  useEffect(() => {
    if (editor) {
      setName(editing?.name || "");
      setCover(editing?.cover || "");
    }
  }, [editor]); // eslint-disable-line

  if (!editor) return null;
  const close = () => setEditor(null);

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      setCover(await fileToCover(f));
    } catch {
      showToast("Could not read that image");
    }
    e.target.value = "";
  };

  const save = async (e) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      if (editing) await updatePlaylist(editing._id, { name: name.trim(), cover });
      else await createPlaylist(name.trim(), cover);
      close();
    } catch (err) {
      showToast(err.message || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-bg" onClick={close}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h3>{editing ? "Edit playlist" : "Create playlist"}</h3>
        <button type="button" className="cover-pick" onClick={() => fileRef.current.click()}>
          <Cover src={cover || editing?.songs?.[0]?.thumbnail} size={160} icon="library" />
          <span className="cover-pick-badge">
            <Icon name="camera" size={20} /> {cover ? "Change photo" : "Choose photo"}
          </span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
        {cover && (
          <button type="button" className="link" onClick={() => setCover("")}>
            Remove photo
          </button>
        )}
        <input placeholder="Playlist name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus />
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={close}>
            Cancel
          </button>
          <button className="btn-green" disabled={busy || !name.trim()}>
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
