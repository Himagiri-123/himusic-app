// Tiny in-memory rate limiter (fine for one server instance, which is what Render free gives you).
export function makeLimiter({ max, windowMs }) {
  const hits = new Map(); // key -> { n, reset }
  const timer = setInterval(() => {
    const t = Date.now();
    for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
  }, 60_000);
  timer.unref?.();
  return {
    check(key) {
      const v = hits.get(key);
      if (!v || v.reset <= Date.now() || v.n < max) return { ok: true, retryAfter: 0 };
      return { ok: false, retryAfter: Math.ceil((v.reset - Date.now()) / 1000) };
    },
    hit(key) {
      const t = Date.now();
      const v = hits.get(key);
      if (!v || v.reset <= t) hits.set(key, { n: 1, reset: t + windowMs });
      else v.n++;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

// Express middleware: count every request per key, answer 429 when over the limit.
export function rateLimit(limiter, keyFn) {
  return (req, res, next) => {
    const key = keyFn(req);
    const c = limiter.check(key);
    if (!c.ok) {
      res.set("Retry-After", String(c.retryAfter));
      return res.status(429).json({ error: `Too many requests. Try again in ${Math.ceil(c.retryAfter / 60)} min.`, retryAfter: c.retryAfter });
    }
    limiter.hit(key);
    next();
  };
}
