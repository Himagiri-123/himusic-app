// Smart cache: songs you played are kept on this device (IndexedDB), oldest removed first once the size limit
// is reached. A replay then starts instantly and costs no mobile data. Separate from "Downloads" (those stay forever).
const DB = "himusic-cache";
let dbp;
const open = () =>
  (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore("meta", { keyPath: "id" });
      d.createObjectStore("blobs");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
const wrap = (req) => new Promise((res, rej) => ((req.onsuccess = () => res(req.result)), (req.onerror = () => rej(req.error))));
const done = (t) => new Promise((res, rej) => ((t.oncomplete = () => res()), (t.onerror = t.onabort = () => rej(t.error))));

export async function cacheGet(id) {
  try {
    const db = await open();
    const blob = await wrap(db.transaction("blobs").objectStore("blobs").get(id));
    if (!blob) return null;
    const t = db.transaction("meta", "readwrite");
    const st = t.objectStore("meta");
    const m = await wrap(st.get(id));
    if (m) st.put({ ...m, at: Date.now() });
    return blob;
  } catch {
    return null;
  }
}

export async function cacheHas(id) {
  try {
    const db = await open();
    return !!(await wrap(db.transaction("meta").objectStore("meta").get(id)));
  } catch {
    return false;
  }
}

export async function cacheUsage() {
  try {
    const db = await open();
    const all = await wrap(db.transaction("meta").objectStore("meta").getAll());
    return { count: all.length, bytes: all.reduce((a, m) => a + (m.size || 0), 0) };
  } catch {
    return { count: 0, bytes: 0 };
  }
}

export async function cachePut(id, blob, limitMB) {
  try {
    if (!blob || blob.size < 20_000) return;
    const db = await open();
    const t = db.transaction(["meta", "blobs"], "readwrite");
    t.objectStore("blobs").put(blob, id);
    t.objectStore("meta").put({ id, size: blob.size, at: Date.now() });
    await done(t);
    // keep the cache under the limit: remove the least recently played songs first
    const all = await wrap(db.transaction("meta").objectStore("meta").getAll());
    let total = all.reduce((a, m) => a + (m.size || 0), 0);
    const limit = (limitMB || 200) * 1024 * 1024;
    if (total <= limit) return;
    all.sort((a, b) => a.at - b.at);
    const t2 = db.transaction(["meta", "blobs"], "readwrite");
    for (const m of all) {
      if (total <= limit || m.id === id) break;
      t2.objectStore("blobs").delete(m.id);
      t2.objectStore("meta").delete(m.id);
      total -= m.size || 0;
    }
    await done(t2);
  } catch {
    // storage full or blocked: the cache is optional, playback goes on without it
  }
}

export async function cacheClear() {
  try {
    const db = await open();
    const t = db.transaction(["meta", "blobs"], "readwrite");
    t.objectStore("blobs").clear();
    t.objectStore("meta").clear();
    await done(t);
  } catch {}
}

// download a whole song into memory (one request) and keep it in the cache
export async function fetchSong(url, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const blob = await r.blob();
  if (blob.size < 20_000) throw new Error("incomplete");
  return blob;
}
