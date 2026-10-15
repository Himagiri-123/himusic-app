import { useApp } from "../store.jsx";
import { usePlayer } from "../PlayerContext.jsx";

export default function SongRow({ song, list, onRemove }) {
  const { isLiked, toggleLike, setPicker } = useApp();
  const { play, current, playing } = usePlayer();
  const active = current?.id === song.id;

  return (
    <div className={"row" + (active ? " active" : "")}>
      <button className="row-main" onClick={() => play(song, list)}>
        <img src={song.thumbnail} alt="" loading="lazy" />
        <div className="meta">
          <div className="title">{song.title}</div>
          <div className="artist">
            {active && playing ? "▶ Playing · " : ""}
            {song.artist}
          </div>
        </div>
      </button>
      <button
        className={"icon-btn" + (isLiked(song.id) ? " liked" : "")}
        onClick={() => toggleLike(song)}
        title="Like"
      >
        {isLiked(song.id) ? "♥" : "♡"}
      </button>
      {onRemove ? (
        <button className="icon-btn" onClick={() => onRemove(song)} title="Remove">✕</button>
      ) : (
        <button className="icon-btn" onClick={() => setPicker(song)} title="Add to playlist">＋</button>
      )}
    </div>
  );
}
