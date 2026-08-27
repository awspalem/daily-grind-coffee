/**
 * Tiny in-memory cache for fetch() responses on the storefront.
 *
 * Returns the cached body (parsed JSON) if a GET to the same URL+method was
 * issued within `ttlMs`. While returning the cached value, kicks off a
 * background refresh so the next call sees fresh data — the classic
 * stale-while-revalidate pattern, scoped to a single tab.
 *
 * This is NOT a replacement for the server's Cache-Control headers (which
 * sit in front of the edge) or the service worker's SWR branch (which
 * survives across tabs and offline). It is the third layer: an in-tab
 * dedupe so that loadCatalog + a sub-component's data fetch don't fire two
 * identical /api/products requests back-to-back.
 */
const DEFAULT_TTL_MS = 30_000;
const MAX_ENTRIES = 200;

interface CacheEntry {
  expires: number;
  body: unknown;
  inflight?: Promise<unknown>;
}

const cache = new Map<string, CacheEntry>();

function key(url: string, method: string): string {
  return `${method.toUpperCase()} ${url}`;
}

function trim(): void {
  if (cache.size <= MAX_ENTRIES) return;
  // Delete the oldest by insertion order (Map preserves it). Drop a quarter
  // of the cache to amortize the cost of constant re-trimming.
  const toDrop = Math.ceil(MAX_ENTRIES / 4);
  let i = 0;
  for (const k of cache.keys()) {
    if (i++ >= toDrop) break;
    cache.delete(k);
  }
}

/**
 * Stale-while-revalidate fetch wrapper. The first arg is a fetcher so the
 * caller controls headers / credentials / body. Only GET requests are cached.
 */
export function cachedFetch<T = unknown>(
  url: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<T> {
  const k = key(url, 'GET');
  const now = Date.now();
  const entry = cache.get(k);

  if (entry) {
    if (entry.expires > now) {
      // Fresh hit — return immediately, no background refresh.
      return Promise.resolve(entry.body as T);
    }
    if (entry.inflight) {
      // Stale hit but a refresh is already in flight; serve stale and let
      // the in-flight refresh update the cache when it lands.
      return Promise.resolve(entry.body as T);
    }
    // Stale and no in-flight — kick off a refresh and return the stale body
    // right now. The next caller will see the new body.
    const refresh = fetcher()
      .then((body) => { cache.set(k, { expires: Date.now() + ttlMs, body }); return body; })
      .catch((err) => { cache.delete(k); throw err; });
    cache.set(k, { ...entry, inflight: refresh });
    refresh.finally(() => {
      const cur = cache.get(k);
      if (cur?.inflight === refresh) cache.set(k, { expires: cur.expires, body: cur.body });
    });
    return Promise.resolve(entry.body as T);
  }

  // Cold path — fetch, then cache.
  const promise = fetcher()
    .then((body) => { cache.set(k, { expires: Date.now() + ttlMs, body }); trim(); return body; })
    .catch((err) => { cache.delete(k); throw err; });
  // Store an in-flight marker so concurrent callers dedupe onto the same fetch.
  cache.set(k, { expires: 0, body: undefined, inflight: promise });
  promise.finally(() => {
    const cur = cache.get(k);
    if (cur?.inflight === promise && cur.expires === 0) {
      // Body was never cached (failing path) — drop the entry.
      cache.delete(k);
    }
  });
  return promise;
}

export function clearFetchCache(): void {
  cache.clear();
}
