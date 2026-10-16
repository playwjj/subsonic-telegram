// Captions on the Telegram messages holding the songs: the song's path in
// the library and its id. They make the channel readable on its own — and a
// second way back, should the D1 metadata ever be lost — so they're kept in
// step with moves and renames. New uploads get theirs right away; changes
// go through caption_queue, which a cron works off a few at a time (every
// edit is a Telegram call, and Telegram rate-limits them per channel).
import * as q from "../db/queries";
import type { StorageBackend } from "../storage/types";
import { TelegramRateLimitError } from "../storage/telegram";

// Per cron run (every 2 minutes), spaced out: ~300 an hour, which leaves
// room for uploads under Telegram's ~20 messages a minute per channel.
const BATCH = 10;
const SPACING_MS = 1500;
const MAX_ATTEMPTS = 5;

export function captionFor(t: { id: string; source_path: string | null; title: string; artist_name: string; suffix: string }): string {
  const path = t.source_path ?? `${t.artist_name} - ${t.title}.${t.suffix}`;
  return `${path}\nid: ${t.id}`;
}

const now = () => Math.floor(Date.now() / 1000);

// Re-queues, also when it had given up before: a fresh change is worth
// another try.
const UPSERT = `ON CONFLICT(track_id) DO UPDATE SET queued_at = excluded.queued_at, attempts = 0, last_error = NULL`;

export function enqueueIdsStatement(db: D1Database, ids: string[]): D1PreparedStatement | null {
  if (!ids.length) return null;
  return db
    .prepare(`INSERT INTO caption_queue (track_id, queued_at) SELECT value, ? FROM json_each(?) WHERE true ${UPSERT}`)
    .bind(now(), JSON.stringify(ids));
}

// Everything under a folder ("" for the whole library).
export function enqueueUnderStatement(db: D1Database, prefix: string): D1PreparedStatement {
  const under = q.underPrefix("source_path", prefix);
  return db
    .prepare(
      `INSERT INTO caption_queue (track_id, queued_at) SELECT id, ? FROM tracks WHERE ${prefix ? under.sql : "true"} ${UPSERT}`,
    )
    .bind(now(), ...under.binds);
}

export interface CaptionStatus {
  queued: number;
  failed: number;
  lastError?: string;
}

export async function captionStatus(db: D1Database): Promise<CaptionStatus> {
  const row = await db
    .prepare(
      `SELECT SUM(attempts < ?1) as queued, SUM(attempts >= ?1) as failed,
              (SELECT last_error FROM caption_queue WHERE attempts >= ?1 ORDER BY queued_at DESC LIMIT 1) as last_error
       FROM caption_queue`,
    )
    .bind(MAX_ATTEMPTS)
    .first<{ queued: number | null; failed: number | null; last_error: string | null }>();
  return { queued: row?.queued ?? 0, failed: row?.failed ?? 0, lastError: row?.last_error ?? undefined };
}

export async function clearFailedCaptions(db: D1Database): Promise<void> {
  await db.prepare(`DELETE FROM caption_queue WHERE attempts >= ?`).bind(MAX_ATTEMPTS).run();
}

interface QueuedRow {
  id: string;
  file_ref: string;
  source_path: string | null;
  title: string;
  suffix: string;
  artist_name: string;
}

// Songs deleted after being queued have nothing left to caption. The join
// below already skips them; this just stops them counting as queued. It
// reads the whole queue, so it runs from the daily cron, not every batch.
export async function pruneCaptionQueue(db: D1Database): Promise<void> {
  await db.prepare(`DELETE FROM caption_queue WHERE track_id NOT IN (SELECT id FROM tracks)`).run();
}

export async function processCaptionQueue(db: D1Database, storage: StorageBackend): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.file_ref, t.source_path, t.title, t.suffix, ar.name as artist_name
       FROM caption_queue c JOIN tracks t ON t.id = c.track_id JOIN artists ar ON ar.id = t.artist_id
       WHERE c.attempts < ? ORDER BY c.attempts, c.queued_at LIMIT ?`,
    )
    .bind(MAX_ATTEMPTS, BATCH)
    .all<QueuedRow>();

  const done: string[] = [];
  const failures: { id: string; error: string; final: boolean }[] = [];
  for (const [i, row] of results.entries()) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, SPACING_MS));
    try {
      const result = await storage.setCaption(row.file_ref, captionFor(row));
      if (result === "ok") done.push(row.id);
      else failures.push({ id: row.id, error: "The song's message no longer exists in the channel", final: true });
    } catch (err) {
      if (err instanceof TelegramRateLimitError) break; // the rest waits for the next run
      failures.push({ id: row.id, error: err instanceof Error ? err.message : String(err), final: false });
    }
  }

  const statements: D1PreparedStatement[] = [];
  if (done.length) {
    statements.push(
      db.prepare(`DELETE FROM caption_queue WHERE track_id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(done)),
    );
  }
  for (const f of failures) {
    statements.push(
      db
        .prepare(`UPDATE caption_queue SET attempts = CASE WHEN ? THEN ? ELSE attempts + 1 END, last_error = ? WHERE track_id = ?`)
        .bind(f.final ? 1 : 0, MAX_ATTEMPTS, f.error, f.id),
    );
  }
  if (statements.length) await db.batch(statements);
}
