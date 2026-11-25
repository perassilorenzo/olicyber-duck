/** Rate limiter in memoria per isolato Workers (non distribuito). */

export function createRateLimiter({ limit = 12, windowMs = 60_000, maxKeys = 5_000, now = Date.now } = {}) {
  const entries = new Map();

  return {
    check(key) {
      const time = now();

      // Rimuove solo le chiavi scadute, senza espellere chiavi attive.
      for (const [storedKey, timestamps] of entries) {
        if (time - timestamps[timestamps.length - 1] >= windowMs) entries.delete(storedKey);
      }

      // Limita il numero di chiavi conservate (Map conserva l'ordine d'inserimento).
      while (entries.size >= maxKeys && !entries.has(key)) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }

      const timestamps = (entries.get(key) || []).filter((stamp) => time - stamp < windowMs);
      if (timestamps.length >= limit) {
        entries.set(key, timestamps);
        const retryAfter = Math.max(1, Math.ceil((timestamps[0] + windowMs - time) / 1000));
        return { allowed: false, retryAfter };
      }

      timestamps.push(time);
      entries.set(key, timestamps);
      return { allowed: true, retryAfter: 0 };
    },
  };
}
