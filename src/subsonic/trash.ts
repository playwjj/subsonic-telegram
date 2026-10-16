// Trash (recycle bin) for the web UI's deletes. Deleting moves tracks out of
// the live tables into trash/trash_rows (src/db/trash.ts) without touching
// Telegram; restoring puts them back; purging — by hand, or the daily cron
// once an entry is older than the retention period — finally deletes the
// Telegram files.
import * as q from "../db/queries";
import * as t from "../db/trash";
import type { StorageBackend } from "../storage/types";
import {
  FolderError,
  baseName,
  deleteFilesOrQueue,
  joinPath,
  keepParentsStatement,
  listSubfolders,
  parentOf,
  trackFileName,
  uniqueName,
} from "./folders";

export const DEFAULT_RETENTION_DAYS = 30;

// One purge call deletes at most this many songs' Telegram files: 40
// deleteMessages calls, inside the Workers free plan's 50-subrequest cap.
// Bigger purges are split across calls (purgeTrash returns `remaining`).
const MAX_SONGS_PER_PURGE = 4000;

// Moves tracks and whole folders to the trash: each folder becomes one entry
// (everything under it), each other song its own entry. Returns the entry
// ids, which restoreTrash takes back (the web UI's "Undo").
export async function trashItems(
  db: D1Database,
  trackIds: string[],
  folderPaths: string[],
): Promise<{ entryIds: string[]; songs: number }> {
  const entries: t.NewTrashEntry[] = [];
  const moves: { id: string; trash: string }[] = [];
  const claimed = new Set<string>();
  const paths = [...new Set(folderPaths)];

  for (const path of paths) {
    if (!path) throw new FolderError("Can't delete the root folder");
    if (!(await q.folderExists(db, path))) throw new FolderError(`Folder not found: ${path}`, 70);
    const tracks = await q.listTrackSizesUnderPath(db, path);
    const id = crypto.randomUUID();
    entries.push({
      id,
      kind: "folder",
      name: baseName(path),
      path,
      song_count: tracks.length,
      size: tracks.reduce((sum, r) => sum + r.size, 0),
    });
    for (const track of tracks) {
      if (claimed.has(track.id)) continue; // a folder nested in another selected one
      claimed.add(track.id);
      moves.push({ id: track.id, trash: id });
    }
  }
  for (const track of await q.getTracksByIds(db, trackIds.filter((id) => !claimed.has(id)))) {
    const id = crypto.randomUUID();
    entries.push({ id, kind: "track", name: trackFileName(track), path: track.source_path, song_count: 1, size: track.size });
    claimed.add(track.id);
    moves.push({ id: track.id, trash: id });
  }
  if (!entries.length) return { entryIds: [], songs: 0 };

  const rows = await q.getTracksForDelete(db, [...claimed]);
  const statements = [
    ...t.captureStatements(db, entries, moves),
    ...q.cascadeDeleteStatements(db, rows),
    ...paths.map((path) => q.deleteFolderRegistrationsStatement(db, path)),
  ];
  const keep = keepParentsStatement(db, paths, rows.map((r) => r.source_path));
  if (keep) statements.push(keep);
  await db.batch(statements);
  return { entryIds: entries.map((e) => e.id), songs: moves.length };
}

export interface RestoreResult {
  restored: number;
  // Came back as "name (1).mp3" because their old name was taken meanwhile.
  renamed: number;
  // Not restored: the same track (same id) exists again by now, e.g.
  // re-uploaded — the live copy wins.
  skipped: number;
}

export async function restoreTrash(db: D1Database, storage: StorageBackend, entryIds: string[]): Promise<RestoreResult> {
  const entries = await t.getTrashEntries(db, entryIds);
  if (!entries.length) throw new FolderError("Nothing to restore — already restored or purged?", 70);
  const ids = entries.map((e) => e.id);
  const snapshots = await t.getTrashedTracks(db, ids);

  const live = new Map((await q.getTracksForDelete(db, snapshots.map((s) => s.id))).map((r) => [r.id, r.file_ref]));
  const restoring = snapshots.filter((s) => !live.has(s.id));
  // A skipped snapshot whose file isn't the live copy's would be orphaned.
  const superseded = snapshots.filter((s) => live.has(s.id) && live.get(s.id) !== s.file_ref).map((s) => s.file_ref);

  // Names taken since, in each folder something is coming back to.
  const dirs = [...new Set(restoring.flatMap((s) => (s.source_path ? [parentOf(s.source_path)] : [])))];
  const taken = new Map<string, Set<string>>();
  for (const dir of dirs) {
    const [tracks, subfolders] = await Promise.all([q.listTracksInDir(db, dir), listSubfolders(db, dir)]);
    taken.set(dir, new Set([...tracks.map((r) => baseName(r.source_path!)), ...subfolders.map((f) => f.name)]));
  }
  const renames: Record<string, string> = {};
  for (const s of restoring) {
    if (!s.source_path) continue;
    const dir = parentOf(s.source_path);
    const names = taken.get(dir)!;
    let name = baseName(s.source_path);
    if (names.has(name)) {
      name = uniqueName(name, names, true);
      renames[s.id] = joinPath(dir, name);
    }
    names.add(name);
  }

  const recreated = await t.getMissingAlbumsAndArtists(db, ids);
  await db.batch(t.restoreStatements(db, ids, renames, recreated));
  await deleteFilesOrQueue(db, storage, superseded);
  return { restored: restoring.length, renamed: Object.keys(renames).length, skipped: snapshots.length - restoring.length };
}

// Permanently deletes trash entries and their Telegram files. Works through
// them oldest first in chunks of at most MAX_SONGS_PER_PURGE songs (always
// at least one entry); `remaining` says how many entries are left to do.
export async function purgeTrash(
  db: D1Database,
  storage: StorageBackend,
  entryIds: string[] | "all",
): Promise<{ purged: number; songs: number; remaining: number }> {
  const entries = entryIds === "all" ? (await t.listTrashEntries(db)).reverse() : await t.getTrashEntries(db, entryIds);
  return purgeEntries(db, storage, entries);
}

async function purgeEntries(
  db: D1Database,
  storage: StorageBackend,
  entries: t.TrashEntryRow[],
): Promise<{ purged: number; songs: number; remaining: number }> {
  const chunk: t.TrashEntryRow[] = [];
  let songs = 0;
  for (const entry of entries) {
    if (chunk.length && songs + entry.song_count > MAX_SONGS_PER_PURGE) break;
    chunk.push(entry);
    songs += entry.song_count;
  }
  if (!chunk.length) return { purged: 0, songs: 0, remaining: 0 };
  const ids = chunk.map((e) => e.id);
  const refs = await t.getPurgeableFileRefs(db, ids);
  await db.batch(t.deleteEntriesStatements(db, ids));
  await deleteFilesOrQueue(db, storage, refs);
  return { purged: chunk.length, songs: refs.length, remaining: entries.length - chunk.length };
}

// Daily cron: purge what's past retention, then retry failed Telegram
// deletes. Both bounded so one run stays within the subrequest cap.
export async function dailyCleanup(db: D1Database, storage: StorageBackend, retentionDays: number): Promise<void> {
  const before = Math.floor(Date.now() / 1000) - retentionDays * 86400;
  const expired = await t.listExpiredTrashEntries(db, before, 200);
  const { purged, songs, remaining } = await purgeEntries(db, storage, expired);
  console.log(`Trash cleanup: purged ${purged} entries (${songs} songs), ${remaining} expired left for next run`);

  const pending = await t.listPendingDeletes(db, 500);
  if (pending.length) {
    const { failed, error } = await storage.deleteFiles(pending);
    const failedSet = new Set(failed);
    await t.removePendingDeletes(db, pending.filter((ref) => !failedSet.has(ref)));
    if (failed.length) await t.queuePendingDeletes(db, failed, error);
    console.log(`Retried ${pending.length} Telegram deletes, ${failed.length} still failing`);
  }
}
