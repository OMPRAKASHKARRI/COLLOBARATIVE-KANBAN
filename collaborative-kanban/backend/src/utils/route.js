// Wraps a handler `(req) => ({status, body})` with async error forwarding and
// idempotent replay: a mutating request carrying the same X-Operation-Id (per user+URL)
// returns the original result instead of executing twice.
const cache = new Map();
const TTL_MS = 2 * 60 * 1000;

const route = (fn) => async (req, res, next) => {
  try {
    const opId = req.get('x-operation-id');
    const key = opId && req.method !== 'GET' && req.user ? `${req.user.id}:${req.method}:${req.originalUrl}:${opId}` : null;
    let p;
    if (key && cache.has(key)) {
      p = cache.get(key);
      res.set('Idempotent-Replay', 'true');
    } else {
      p = Promise.resolve(fn(req));
      if (key) {
        cache.set(key, p);
        p.catch(() => cache.delete(key));
        setTimeout(() => cache.delete(key), TTL_MS).unref();
      }
    }
    const out = await p;
    if (out.status === 204) return res.status(204).end();
    res.status(out.status || 200).json(out.body);
  } catch (e) { next(e); }
};

module.exports = { route, _cache: cache };
