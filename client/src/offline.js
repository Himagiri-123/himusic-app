// Offline songs live in the browser's own storage (IndexedDB), separate per user.
// "meta" holds small info for lists; "blobs" holds the audio file itself.
const DB = "himusic-offline";
let dbp;
const open = () =>
  (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore("meta", { keyPath: "key" });
      d.createObjectStore("blobs");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));

const tx = async (stores, mode, fn) => {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(stores, mode);
    let out;
    Promise.resolve(fn(t)).then((v) => (out = v));
    t.oncomplete = () => res(out);
    t.onerror = t.onabort = () => rej(t.error);
  });
};
const wrap = (req) => new Promise((res, rej) => ((req.onsuccess = () => res(req.result)), (req.onerror = () => rej(req.error))));
const k = (uid, id) => `${uid}:${id}`;

export async function saveOffline(uid, song, blob) {
  const key = k(uid, song.id);
  const meta = {
    key, uid, id: song.id, at: Date.now(), size: blob.size,
    song: { id: song.id, title: song.title, artist: song.artist, thumbnail: song.thumbnail, duration: song.duration },
  };
  await tx(["meta", "blobs"], "readwrite", (t) => {
    t.objectStore("blobs").put(blob, key);
    t.objectStore("meta").put(meta);
  });
  return meta;
}
export const getOfflineBlob = async (uid, id) => {
  const db = await open();
  return wrap(db.transaction("blobs").objectStore("blobs").get(k(uid, id)));
};
export async function listOffline(uid) {
  const db = await open();
  const all = await wrap(db.transaction("meta").objectStore("meta").getAll());
  return all.filter((m) => m.uid === uid).sort((a, b) => b.at - a.at);
}
export async function removeOffline(uid, id) {
  await tx(["meta", "blobs"], "readwrite", (t) => {
    t.objectStore("blobs").delete(k(uid, id));
    t.objectStore("meta").delete(k(uid, id));
  });
}
export async function clearOffline(uid) {
  for (const m of await listOffline(uid)) await removeOffline(uid, m.id);
}
