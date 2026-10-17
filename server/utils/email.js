// Returns { email, key, domain } or null. `key` is the canonical form used to stop duplicate accounts:
// for Gmail, dots and +tags do not matter (a.b+x@gmail.com is the same inbox as ab@gmail.com).
export function normalizeEmail(raw) {
  const email = String(raw || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  let domain = email.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  const base = domain === "gmail.com" ? local.split("+")[0].replace(/\./g, "") : local;
  if (!base) return null;
  return { email, key: `${base}@${domain}`, domain };
}
