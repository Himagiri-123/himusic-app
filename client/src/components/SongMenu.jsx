import { useApp } from "../store.jsx";
import { usePlayer } from "../PlayerContext.jsx";
import { cleanArtist } from "../hooks.js";
import Cover from "./Cover.jsx";
import Icon from "./Icon.jsx";

// bottom sheet opened by the ⋯ button on any song
export default function SongMenu() {
  const { menu, setMenu, isLiked, toggleLike, setPicker, showToast } = useApp();
  const { playNext, addToQueue } = usePlayer();
  if (!menu) return null;
  const { song, onRemove } = menu;
  const close = () => setMenu(null);
  const liked = isLiked(song.id);

  const Item = ({ icon, label, onClick, danger }) => (
    <button
      className={"sheet-item" + (danger ? " danger" : "")}
      onClick={() => {
        close();
        onClick();
      }}
    >
      <Icon name={icon} size={24} />
      <span>{label}</span>
    </button>
  );

  return (
    <div className="sheet-bg" onClick={close}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <Cover src={song.thumbnail} size={52} />
          <div className="meta">
            <div className="title">{song.title}</div>
            <div className="sub">{cleanArtist(song.artist)}</div>
          </div>
        </div>
        <Item icon={liked ? "heartFill" : "heart"} label={liked ? "Remove from Liked Songs" : "Add to Liked Songs"} onClick={() => toggleLike(song)} />
        <Item icon="plus" label="Add to playlist" onClick={() => setPicker(song)} />
        <Item icon="queueAdd" label="Play next" onClick={() => { playNext(song); showToast("Will play next"); }} />
        <Item icon="queue" label="Add to queue" onClick={() => { addToQueue(song); showToast("Added to queue"); }} />
        {onRemove && <Item icon="trash" label="Remove from this playlist" danger onClick={() => onRemove(song)} />}
      </div>
    </div>
  );
}
