// helpers for sharing songs / playlists (WhatsApp link + copy)
const enc = encodeURIComponent;
export const songLink = (s) => `${location.origin}/?song=${s.id}&t=${enc(s.title || "")}&a=${enc(s.artist || "")}&th=${enc(s.thumbnail || "")}&d=${Math.round(s.duration || 0)}`;
export const playlistLink = (code) => `${location.origin}/?pl=${code}`;
export const joinLink = (code) => `${location.origin}/?join=${code}`;
export const openWhatsApp = (text) => window.open(`https://wa.me/?text=${enc(text)}`, "_blank", "noopener");
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
