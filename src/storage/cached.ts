import type { DeleteFilesResult, FileCheck, OpenedFile, SourceStorage, StorageBackend } from "./types";
import { parseRange, rangeHeaders, rangeNotSatisfiable, rangeResponse } from "./range";
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
// Keys being copied into R2 right now, by this isolate.
const populating = new Set<string>();

export class CachedStorage implements StorageBackend {
  constructor(
    private source: SourceStorage,
    private bucket: R2Bucket,
    private db: D1Database,
    private maxBytes: number,
    private ctx: ExecutionContext,
  ) {}

  async putFile(bytes: Uint8Array, filename: string, mimeType: string, caption?: string): Promise<string> {
    return this.source.putFile(bytes, filename, mimeType, caption);
  }

  checkFile(ref: string): Promise<FileCheck> {
    return this.source.checkFile(ref);
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

  async deleteFiles(refs: string[]): Promise<DeleteFilesResult> {
    const result = await this.source.deleteFiles(refs);
    const keys = await Promise.all(refs.map(cacheKey));
    // R2's bulk delete takes up to 1000 keys per call.
    const chunks: string[][] = [];
    for (let i = 0; i < keys.length; i += 1000) chunks.push(keys.slice(i, i + 1000));
    this.ctx.waitUntil(
      Promise.all(chunks.map((chunk) => this.bucket.delete(chunk)))
        .then(() => cache.deleteCacheEntries(this.db, keys))
        .catch((err) => console.warn(`Cache cleanup failed for deleted files: ${err}`)),
    );
    return result;
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

    let file: OpenedFile;
    try {
      file = await this.source.openFile(ref, contentType);
    } catch (err) {
      return new Response(err instanceof Error ? err.message : String(err), { status: 502 });
    }
    // A browser starting a song often asks for the start and the end at
    // once; only the first of those copies it into R2. Per isolate, and just
    // a key set — awaiting another request's copy could hang this one.
    if (populating.has(key)) return rangeResponse(file.body, file.size, file.contentType, rangeHeader);
    populating.add(key);
    const [toClient, toCache] = file.body.tee();
    this.ctx.waitUntil(this.populate(key, toCache, file.size, file.contentType).finally(() => populating.delete(key)));
    return rangeResponse(toClient, file.size, file.contentType, rangeHeader);
  }

  private async serveFromCache(
    key: string,
    entry: cache.CacheEntryRow,
    rangeHeader: string | null,
  ): Promise<Response | null> {
    const range = parseRange(entry.size, rangeHeader);
    if (range === "unsatisfiable") return rangeNotSatisfiable(entry.size);
    const object = await this.bucket.get(
      key,
      range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined,
    );
    if (!object) return null;

    this.ctx.waitUntil(cache.touchCacheEntry(this.db, key, nowSeconds()));
    const headers = rangeHeaders(entry.content_type, entry.size, range);
    return new Response(object.body, { status: range ? 206 : 200, headers });
  }

  // Reads the whole file even when the player only wanted a range of it (or
  // went away), so the next request for any part is a hit.
  private async populate(key: string, body: ReadableStream<Uint8Array>, size: number, contentType: string): Promise<void> {
    try {
      await this.bucket.put(key, body.pipeThrough(new FixedLengthStream(size)), { httpMetadata: { contentType } });
      await cache.upsertCacheEntry(this.db, key, size, contentType, nowSeconds());
      await this.evictIfNeeded();
    } catch (err) {
      console.warn(`Cache populate failed: ${err}`);
    }
  }

  // Runs after every write, not on a schedule -- simplest thing that keeps
  // total R2 usage bounded without a separate cron Worker. Evicts oldest
  // (least-recently-served) entries first until back under the cap.
  private async evictIfNeeded(): Promise<void> {
    let over = (await cache.getCacheTotals(this.db)).bytes - this.maxBytes;
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

export async function cacheKey(ref: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ref));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
