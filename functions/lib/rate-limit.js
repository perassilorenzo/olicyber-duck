/** Rate limiter in memoria per isolato Workers (non distribuito). */

export function createRateLimiter({ limit = 12, windowMs = 60_000, maxKeys = 5_000, now = Date.now } = {}) {
  const entries = new Map();

  return {
    check(key) {
      const time = now();
      for (const [storedKey, value] of entries) {
        if (time - value[value.length - 1] >= windowMs) entries.delete(storedKey);
        if (entries.size > maxKeys) entries.delete(entries.keys().next().value);
      }
      const timestamps = (entries.get(key) || []).filter((stamp) => time - stamp < windowMs);
      if (timestamps.length >= limit) {
        entries.set(key, timestamps);
        return { allowed: false, retryAfter: Math.max(1, Math.ceil((timestamps[0] + windowMs - time) / 1000)) };
      }
      timestamps.push(time);
      entries.set(key, timestamps);
      return { allowed: true, retryAfter: 0 };
    },
  };
}
