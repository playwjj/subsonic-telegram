export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  TG_BOT_TOKEN: string;
  TG_CHANNEL_ID: string;
  AUTH_USERNAME: string;
  AUTH_PASSWORD: string;
  // Both optional: only set when the R2 read-through cache (src/storage/cached.ts)
  // is enabled -- see wrangler.toml. Without CACHE_BUCKET bound, streaming
  // falls back to talking to Telegram directly on every request, same as
  // before this cache existed.
  CACHE_BUCKET?: R2Bucket;
  CACHE_MAX_BYTES?: string;
  // Days a deleted item stays in the trash before the daily cron purges it
  // (default 30, see src/subsonic/trash.ts).
  TRASH_RETENTION_DAYS?: string;
  // Workers AI, for reading artist/title out of messy file names (see
  // src/subsonic/fileNames.ts). Optional: without it that just isn't offered.
  AI?: Ai;
}
