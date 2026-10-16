// The web UI's Storage page: where the space goes, and a check that every
// file can still be fetched from Telegram.
import * as q from "../db/queries";
import type { StorageBackend } from "../storage/types";
import { captionStatus, type CaptionStatus } from "./captions";

export interface Bucket {
  name: string;
  songCount: number;
  size: number;
}

export interface StorageStats {
  songCount: number;
  size: number;
  duration: number;
  folders: Bucket[]; // top-level folders; "" = files at the root, null-path songs as "(no folder)"
  formats: Bucket[];
  months: Bucket[]; // added per month (YYYY-MM), last 12 months with uploads
  covers: { albums: number; albumsWithCover: number; artistsWithPhoto: number; songCovers: number };
  trash: { entries: number; songCount: number; size: number };
  pendingDeletes: number;
  cache: { enabled: boolean; size: number; entries: number; maxBytes: number };
  captions: CaptionStatus;
  largest: q.TrackRow[];
}

export async function storageStats(
  db: D1Database,
  cacheEnabled: boolean,
  cacheMaxBytes: number,
): Promise<StorageStats> {
  const [totals, folders, formats, months, covers, trash, pending, cached, captions, largest] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) as n, COALESCE(SUM(size), 0) as size, COALESCE(SUM(duration), 0) as duration FROM tracks`)
      .first<{ n: number; size: number; duration: number }>(),
    db
      .prepare(
        `SELECT CASE WHEN source_path IS NULL THEN NULL
                     WHEN instr(source_path, '/') = 0 THEN ''
                     ELSE substr(source_path, 1, instr(source_path, '/') - 1) END as name,
                COUNT(*) as songCount, SUM(size) as size
         FROM tracks GROUP BY 1 ORDER BY size DESC`,
      )
      .all<{ name: string | null; songCount: number; size: number }>(),
    db
      .prepare(`SELECT lower(suffix) as name, COUNT(*) as songCount, SUM(size) as size FROM tracks GROUP BY 1 ORDER BY size DESC`)
      .all<Bucket>(),
    db
      .prepare(
        `SELECT strftime('%Y-%m', created_at, 'unixepoch') as name, COUNT(*) as songCount, SUM(size) as size
         FROM tracks GROUP BY 1 ORDER BY 1 DESC LIMIT 12`,
      )
      .all<Bucket>(),
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM albums) as albums,
                (SELECT COUNT(*) FROM albums WHERE cover_ref IS NOT NULL) as albumsWithCover,
                (SELECT COUNT(*) FROM artists WHERE cover_ref IS NOT NULL) as artistsWithPhoto,
                (SELECT COUNT(*) FROM tracks WHERE cover_ref IS NOT NULL) as songCovers`,
      )
      .first<StorageStats["covers"]>(),
    db
      .prepare(`SELECT COUNT(*) as entries, COALESCE(SUM(song_count), 0) as songCount, COALESCE(SUM(size), 0) as size FROM trash`)
      .first<StorageStats["trash"]>(),
    db.prepare(`SELECT COUNT(*) as n FROM pending_deletes`).first<{ n: number }>(),
    cacheEnabled
      ? db.prepare(`SELECT COUNT(*) as n, COALESCE(SUM(size), 0) as size FROM cache_entries`).first<{ n: number; size: number }>()
      : Promise.resolve(null),
    captionStatus(db),
    q.listLargestTracks(db, 10),
  ]);
  return {
    songCount: totals?.n ?? 0,
    size: totals?.size ?? 0,
    duration: totals?.duration ?? 0,
    folders: folders.results.map((f) => ({ ...f, name: f.name ?? "(no folder)" })),
    formats: formats.results,
    months: months.results.reverse(),
    covers: covers ?? { albums: 0, albumsWithCover: 0, artistsWithPhoto: 0, songCovers: 0 },
    trash: trash ?? { entries: 0, songCount: 0, size: 0 },
    pendingDeletes: pending?.n ?? 0,
    cache: { enabled: cacheEnabled, size: cached?.size ?? 0, entries: cached?.n ?? 0, maxBytes: cacheMaxBytes },
    captions,
    largest,
  };
}

// --- integrity check ---

export type CheckKind = "songs" | "covers";

export interface Problem {
  kind: "song" | "album" | "artist" | "songCover";
  id: string;
  name: string;
  path?: string;
  error: string;
}

interface RefRow {
  key: string; // cursor: unique and ordered within the kind
  kind: Problem["kind"];
  id: string;
  ref: string;
  name: string;
  path: string | null;
}

// Files checked per request: each is one Telegram getFile call, and a
// Worker invocation may only make so many subrequests.
const CHECK_BATCH = 40;
const CONCURRENCY = 8;

function friendly(error: string): string {
  if (/file is too big/i.test(error)) return "Over Telegram's 20 MB download limit — can't be played";
  if (/wrong file_id|temporarily unavailable|file not found/i.test(error)) return "File not found in Telegram";
  return error;
}

// One batch of the check, after `cursor` (from the previous batch; "" to
// start). `next` is absent once this kind is done.
export async function checkFiles(
  db: D1Database,
  storage: StorageBackend,
  kind: CheckKind,
  cursor: string,
): Promise<{ checked: number; total: number; next?: string; problems: Problem[] }> {
  const source =
    kind === "songs"
      ? `SELECT id as key, 'song' as kind, id, file_ref as ref, title as name, source_path as path FROM tracks`
      : `SELECT 'al:' || id as key, 'album' as kind, id, cover_ref as ref, name, NULL as path FROM albums WHERE cover_ref IS NOT NULL
         UNION ALL
         SELECT 'ar:' || id, 'artist', id, cover_ref, name, NULL FROM artists WHERE cover_ref IS NOT NULL
         UNION ALL
         SELECT 'tr:' || id, 'songCover', id, cover_ref, title, source_path FROM tracks WHERE cover_ref IS NOT NULL`;
  const [batch, total] = await Promise.all([
    db.prepare(`SELECT * FROM (${source}) WHERE key > ? ORDER BY key LIMIT ?`).bind(cursor, CHECK_BATCH).all<RefRow>(),
    db.prepare(`SELECT COUNT(*) as n FROM (${source})`).first<{ n: number }>(),
  ]);
  const rows = batch.results;

  const problems: Problem[] = [];
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    // Rate-limit errors propagate: the caller retries this same batch later.
    const results = await Promise.all(rows.slice(i, i + CONCURRENCY).map((r) => storage.checkFile(r.ref)));
    results.forEach((result, j) => {
      if (result.ok) return;
      const r = rows[i + j];
      problems.push({ kind: r.kind, id: r.id, name: r.name, path: r.path ?? undefined, error: friendly(result.error) });
    });
  }
  return {
    checked: rows.length,
    total: total?.n ?? 0,
    next: rows.length === CHECK_BATCH ? rows[rows.length - 1].key : undefined,
    problems,
  };
}
