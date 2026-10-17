import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../store.jsx";
import { usePlayer } from "../PlayerContext.jsx";
import { useNav } from "../nav.jsx";
import { useDownloads } from "../downloads.jsx";
import { cleanArtist, rgb, useDominantColor } from "../hooks.js";
import Cover from "./Cover.jsx";
import Icon from "./Icon.jsx";
import SongRow from "./SongRow.jsx";

// One screen for: Liked Songs, Recently played, a playlist, or an artist page
export default function Collection({ view }) {
  const { lib, setEditor, deletePlaylist, removeFromPlaylist } = useApp();
  const { playAll } = usePlayer();
  const nav = useNav();
  const dl = useDownloads();
  const [artistSongs, setArtistSongs] = useState(null);
  const [artistErr, setArtistErr] = useState("");

  const playlist = view.type === "playlist" ? lib.playlists.find((p) => p._id === view.id) : null;

  useEffect(() => {
    if (view.type !== "artist") return;
    let dead = false;
    setArtistSongs(null);
    setArtistErr("");
    api
      .search(`${view.artist.name} songs`)
      .then((r) => !dead && setArtistSongs(r.results))
      .catch((e) => !dead && (setArtistSongs([]), setArtistErr(e.message)));
    return () => {
      dead = true;
    };
  }, [view]); // eslint-disable-line

  let title = "";
  let kind = "";
  let songs = [];
  let cover = "";
  let round = false;
  if (view.type === "liked") {
    title = "Liked Songs";
    kind = "Playlist";
    songs = lib.liked;
    cover = lib.liked[0]?.thumbnail;
  } else if (view.type === "history") {
    title = "Recently played";
    kind = "History";
    songs = lib.history;
    cover = lib.history[0]?.thumbnail;
  } else if (view.type === "downloads") {
    title = "Downloaded";
    kind = "Offline";
    songs = dl.songs;
    cover = dl.songs[0]?.thumbnail;
  } else if (view.type === "playlist") {
    title = playlist?.name || "Playlist";
    kind = "Playlist";
    songs = playlist?.songs || [];
    cover = playlist?.cover || playlist?.songs?.[0]?.thumbnail;
  } else {
    title = view.artist.name;
    kind = "Artist";
    songs = artistSongs || [];
    cover = view.artist.thumbnail;
    round = true;
  }

  const accent = useDominantColor(cover, title);

  if (view.type === "playlist" && !playlist) {
    return (
      <div className="page">
        <button className="ic back" onClick={nav.back}><Icon name="back" /></button>
        <p className="sub center pad">This playlist no longer exists.</p>
      </div>
    );
  }

  const del = async () => {
    if (!confirm(`Delete "${playlist.name}"?`)) return;
    try {
      await deletePlaylist(playlist._id);
      nav.back();
    } catch {}
  };

  return (
    <div className="page">
      <div className="page-grad tall" style={{ background: `linear-gradient(180deg, ${rgb(accent, 0.95, 0.9)} 0%, #121212 460px)` }} />
      <button className="ic back" onClick={nav.back} aria-label="Back">
        <Icon name="back" />
      </button>

      <div className="coll-head">
        {view.type === "liked" ? (
          <div className="cover liked-cover coll-cover"><Icon name="heartFill" size={64} /></div>
        ) : (
          <Cover src={cover} round={round} className="coll-cover" icon={round ? "user" : "library"} />
        )}
        <h1 className="coll-title">{title}</h1>
        <div className="sub">
          {kind}
          {view.type !== "artist" || artistSongs ? ` · ${songs.length} songs` : ""}
        </div>
      </div>

      <div className="coll-actions">
        <button className={"ic" + (false ? " on" : "")} onClick={() => playAll(songs, { shuffled: true })} disabled={!songs.length} aria-label="Shuffle play">
          <Icon name="shuffle" size={28} />
        </button>
        {view.type !== "downloads" && songs.length > 0 && (
          <button className="ic" onClick={() => dl.downloadMany(songs)} aria-label="Download all">
            <Icon name="download" size={28} />
          </button>
        )}
        {playlist && (
          <>
            <button className="ic" onClick={() => setEditor({ playlist })} aria-label="Edit playlist">
              <Icon name="edit" size={24} />
            </button>
            <button className="ic" onClick={del} aria-label="Delete playlist">
              <Icon name="trash" size={24} />
            </button>
          </>
        )}
        <span className="grow" />
        <button className="play-fab" onClick={() => playAll(songs)} disabled={!songs.length} aria-label="Play">
          <Icon name="play" size={32} />
        </button>
      </div>

      {view.type === "artist" && !artistSongs && <p className="sub center pad">Loading songs...</p>}
      {artistErr && <div className="error pad">{artistErr}</div>}
      {songs.length === 0 && (view.type !== "artist" || artistSongs) && !artistErr && (
        <p className="sub center pad">
          {view.type === "downloads"
            ? "Use the ⋯ menu on any song and pick Download for offline."
            : view.type === "liked"
            ? "Tap the heart on any song to save it here."
            : view.type === "playlist"
            ? "Empty. Add songs from the ⋯ menu on any song."
            : "Nothing here yet."}
        </p>
      )}

      <div className="list">
        {songs.map((s) => (
          <SongRow
            key={s.id}
            song={s}
            list={songs}
            onRemove={playlist ? (song) => removeFromPlaylist(playlist._id, song.id) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
