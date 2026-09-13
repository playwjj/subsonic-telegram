// Accounting for the optional R2 read-through cache. See src/storage/cached.ts
// for the class that actually reads/writes R2 — this file just tracks size
// and recency in D1 so eviction can find the least-recently-used entries
// without listing the whole bucket.

export interface CacheEntryRow {
  key: string;
  size: number;
  content_type: string;
  last_accessed: number;
}

export async function getCacheEntry(db: D1Database, key: string): Promise<CacheEntryRow | null> {
  return db.prepare(`SELECT * FROM cache_entries WHERE key = ?`).bind(key).first<CacheEntryRow>();
}

export async function upsertCacheEntry(
  db: D1Database,
  key: string,
  size: number,
  contentType: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO cache_entries (key, size, content_type, last_accessed) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET size = excluded.size, content_type = excluded.content_type,
         last_accessed = excluded.last_accessed`,
    )
    .bind(key, size, contentType, now)
    .run();
}

export async function touchCacheEntry(db: D1Database, key: string, now: number): Promise<void> {
  await db.prepare(`UPDATE cache_entries SET last_accessed = ? WHERE key = ?`).bind(now, key).run();
}

export async function deleteCacheEntry(db: D1Database, key: string): Promise<void> {
  await db.prepare(`DELETE FROM cache_entries WHERE key = ?`).bind(key).run();
}

export async function getTotalCacheBytes(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COALESCE(SUM(size), 0) as total FROM cache_entries`)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

// Oldest-accessed first, for LRU eviction.
export async function listOldestCacheEntries(db: D1Database, limit: number): Promise<CacheEntryRow[]> {
  const res = await db
    .prepare(`SELECT * FROM cache_entries ORDER BY last_accessed ASC LIMIT ?`)
    .bind(limit)
    .all<CacheEntryRow>();
  return res.results ?? [];
}
