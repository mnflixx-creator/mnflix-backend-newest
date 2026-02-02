// simple in-memory cache (lives until server restarts)
const cache = new Map();

// fallback TTL 12 hours
const TTL = 12 * 60 * 60 * 1000;

export function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expireAt) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

export function setCache(key, value, ttl = TTL) {
  cache.set(key, {
    value,
    expireAt: Date.now() + ttl,
  });
}
