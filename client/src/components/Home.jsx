import { useState } from "react";
import { api } from "../api";
import { useApp } from "../store.jsx";
import SongRow from "./SongRow.jsx";

const SUGGESTED = ["Telugu hits", "Anirudh", "Arijit Singh", "Lofi", "A R Rahman", "Devotional"];

export default function Home() {
  const { lib } = useApp();
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const run = async (text) => {
    const query = (text ?? q).trim();
    if (!query) return;
    setQ(query);
    setBusy(true);
    setErr("");
    try {
      const r = await api.search(query);
      setResults(r.results);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <input
          placeholder="Search songs or artists"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="primary">Search</button>
      </form>

      {busy && <p className="muted center">Searching...</p>}
      {err && <div className="error">{err}</div>}

      {results ? (
        <section>
          {results.length === 0 && <p className="muted center">No results</p>}
          {results.map((s) => (
            <SongRow key={s.id} song={s} list={results} />
          ))}
        </section>
      ) : (
        <>
          <div className="chips">
            {SUGGESTED.map((s) => (
              <button key={s} className="chip" onClick={() => run(s)}>
                {s}
              </button>
            ))}
          </div>
          {lib.history.length > 0 && (
            <section>
              <h2>Recently played</h2>
              {lib.history.slice(0, 8).map((s) => (
                <SongRow key={s.id} song={s} list={lib.history} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
