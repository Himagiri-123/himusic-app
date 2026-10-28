import { usePlayer } from "../PlayerContext.jsx";
import { useNav } from "../nav.jsx";
import { cleanArtist } from "../hooks.js";
import Cover from "./Cover.jsx";

// Horizontal scrolling row: songs (square covers) or artists (round photos)
export default function Shelf({ title, items, type = "songs" }) {
  const { play, current } = usePlayer();
  const nav = useNav();
  if (!items?.length) return null;
  return (
    <section className="shelf">
      <h2>{title}</h2>
      <div className="shelf-row">
        {items.map((it) =>
          type === "artists" ? (
            <button key={it.id} className="card artist" onClick={() => nav.push({ type: "artist", artist: it })}>
              <Cover src={it.thumbnail} round />
              <div className="card-title center">{it.name}</div>
              <div className="card-sub center">{String(it.id).startsWith("hero-") ? "Hero" : "Artist"}</div>
            </button>
          ) : (
            <button key={it.id} className={"card" + (current?.id === it.id ? " active" : "")} onClick={() => play(it, items)}>
              <Cover src={it.thumbnail} />
              <div className="card-title">{it.title}</div>
              <div className="card-sub">{cleanArtist(it.artist)}</div>
            </button>
          )
        )}
      </div>
    </section>
  );
}
