import { useApp } from "../store.jsx";
import { usePlayer } from "../PlayerContext.jsx";
import { useDownloads } from "../downloads.jsx";
import { cleanArtist } from "../hooks.js";
import Cover from "./Cover.jsx";
import Icon from "./Icon.jsx";

export default function SongRow({ song, list, onRemove }) {
  const { isLiked, toggleLike, setMenu } = useApp();
  const { play, current, playing } = usePlayer();
  const dl = useDownloads();
  const saved = dl.isDownloaded(song.id);
  const pct = dl.progress[song.id];
  const active = current?.id === song.id;
  const liked = isLiked(song.id);

  return (
    <div className={"song-row" + (active ? " active" : "")}>
      <button className="song-main" onClick={() => play(song, list || [song])}>
        <Cover src={song.thumbnail} size={48} />
        <div className="meta">
          <div className="title">{song.title}</div>
          <div className="sub">
            {active && playing && <span className="eq" aria-hidden="true"><i /><i /><i /></span>}
            {saved && <span className="dl-badge" aria-label="Downloaded"><Icon name="downloaded" size={14} /></span>}
            {pct != null && <span className="dl-pct">{Math.round(pct * 100)}%</span>}
            {cleanArtist(song.artist)}
          </div>
        </div>
      </button>
      <button className={"ic" + (liked ? " on" : "")} onClick={() => toggleLike(song)} aria-label="Like">
        <Icon name={liked ? "heartFill" : "heart"} size={22} />
      </button>
      <button className="ic" onClick={() => setMenu({ song, onRemove })} aria-label="More">
        <Icon name="more" size={22} />
      </button>
    </div>
  );
}
