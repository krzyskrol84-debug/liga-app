type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const DEFAULT_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry<unknown>>();

export function getCachedAnalyticsValue<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  return entry.value as T;
}

export function setCachedAnalyticsValue<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS) {
  cache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value,
  });
}

export function clearAnalyticsCache(prefix?: string) {
  if (!prefix) {
    cache.clear();
    return;
  }

  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}
