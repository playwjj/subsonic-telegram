import type { SourceStorage, StorageBackend } from "./types";
import { parseRange, rangeHeaders } from "./range";
import * as cache from "../db/cache";

// Optional read-through cache in front of a SourceStorage (Telegram). Only
// ever constructed when the CACHE_BUCKET binding is present (see
// src/index.ts) -- without it, streamTrack talks to TelegramStorage
// directly, unchanged from before this file existed.
//
// Writes (putFile/deleteFile) always go straight to the wrapped backend;
// nothing is cached until it's actually streamed once. That keeps this
// class simple and means a stale cache entry can never diverge from the
// source of truth on write -- only reads populate/evict it.
export class CachedStorage implements StorageBackend {
  constructor(
    private source: SourceStorage,
    private bucket: R2Bucket,
    private db: D1Database,
    private maxBytes: number,
    private ctx: ExecutionContext,
  ) {}

  async putFile(bytes: Uint8Array, filename: string, mimeType: string): Promise<string> {
    return this.source.putFile(bytes, filename, mimeType);
  }

  async deleteFile(ref: string): Promise<void> {
    await this.source.deleteFile(ref);
    const key = await cacheKey(ref);
    // Best-effort, same tolerance TelegramStorage.deleteFile already applies
    // to the Telegram side -- a stale cache entry left behind after this
    // just gets served until it ages out of the LRU eviction below.
    this.ctx.waitUntil(
      this.bucket
        .delete(key)
        .then(() => cache.deleteCacheEntry(this.db, key))
        .catch((err) => console.warn(`Cache cleanup failed for deleted file: ${err}`)),
    );
  }

  async getFileResponse(ref: string, rangeHeader: string | null, contentType?: string): Promise<Response> {
    const key = await cacheKey(ref);
    const entry = await cache.getCacheEntry(this.db, key);

    if (entry) {
      const hit = await this.serveFromCache(key, entry, rangeHeader);
      if (hit) return hit;
      // Metadata row exists but the R2 object is gone (evicted out-of-band,
      // bucket recreated, ...) -- drop the stale row and fall through to a
      // normal cache-miss fetch below.
      await cache.deleteCacheEntry(this.db, key);
    }

    let bytes: Uint8Array;
    let resolvedType: string;
    try {
      ({ bytes, contentType: resolvedType } = await this.source.getFileBytes(ref, contentType));
    } catch (err) {
      return new Response(err instanceof Error ? err.message : String(err), { status: 502 });
    }
    this.ctx.waitUntil(this.populate(key, bytes, resolvedType));

    const range = parseRange(bytes.byteLength, rangeHeader);
    const body = range ? bytes.slice(range.start, range.end + 1) : bytes;
    const headers = rangeHeaders(resolvedType, bytes.byteLength, range);
    return new Response(body, { status: range ? 206 : 200, headers });
  }

  private async serveFromCache(
    key: string,
    entry: cache.CacheEntryRow,
    rangeHeader: string | null,
  ): Promise<Response | null> {
    const range = parseRange(entry.size, rangeHeader);
    const object = await this.bucket.get(
      key,
      range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined,
    );
    if (!object) return null;

    this.ctx.waitUntil(cache.touchCacheEntry(this.db, key, nowSeconds()));
    const headers = rangeHeaders(entry.content_type, entry.size, range);
    return new Response(object.body, { status: range ? 206 : 200, headers });
  }

  private async populate(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    try {
      await this.bucket.put(key, bytes, { httpMetadata: { contentType } });
      await cache.upsertCacheEntry(this.db, key, bytes.byteLength, contentType, nowSeconds());
      await this.evictIfNeeded();
    } catch (err) {
      console.warn(`Cache populate failed: ${err}`);
    }
  }

  // Runs after every write, not on a schedule -- simplest thing that keeps
  // total R2 usage bounded without a separate cron Worker. Evicts oldest
  // (least-recently-served) entries first until back under the cap.
  private async evictIfNeeded(): Promise<void> {
    let over = (await cache.getTotalCacheBytes(this.db)) - this.maxBytes;
    if (over <= 0) return;
    const stale = await cache.listOldestCacheEntries(this.db, 50);
    for (const e of stale) {
      if (over <= 0) break;
      await this.bucket.delete(e.key);
      await cache.deleteCacheEntry(this.db, e.key);
      over -= e.size;
    }
  }
}

async function cacheKey(ref: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ref));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
