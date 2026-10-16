// Folder (file manager) logic behind the web UI's Folders view: listing,
// tree, move, rename, delete. Folders are paths derived from
// tracks.source_path plus explicit registrations in the folders table (see
// db/schema.sql); everything here works on both.
import * as q from "../db/queries";
import type { StorageBackend } from "../storage/types";

// A failure the user caused (bad name, missing folder, name clash) rather
// than a server fault — src/index.ts reports these as-is instead of as a
// "Server error in ...".
export class FolderError extends Error {
  constructor(
    message: string,
    public code = 0,
  ) {
    super(message);
  }
}

export interface FolderStats {
  songCount: number;
  size: number;
  duration: number;
}

export interface SubfolderInfo extends FolderStats {
  name: string;
  // Nothing at all under it (no tracks, no nested folder).
  empty: boolean;
}

export interface TreeFolder extends FolderStats {
  path: string;
}

export function parentOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

// A single path segment, as typed into a "rename"/"new folder" box.
export function validateName(input: string): string {
  const name = input.trim();
  if (!name || name.includes("/") || name === "." || name === "..") throw new FolderError("Invalid name");
  return name;
}

function addStats(into: FolderStats, from: { song_count: number; size: number; duration: number }): void {
  into.songCount += from.song_count;
  into.size += from.size;
  into.duration += from.duration;
}

// Immediate subfolders of `prefix`, each with totals for everything under it.
export async function listSubfolders(db: D1Database, prefix: string): Promise<SubfolderInfo[]> {
  const [dirRows, folderRows] = await Promise.all([q.listDirStats(db, prefix), q.listFoldersUnderPath(db, prefix)]);
  const prefixLen = prefix ? prefix.length + 1 : 0;
  const byName = new Map<string, SubfolderInfo>();
  const entry = (name: string) => {
    let info = byName.get(name);
    if (!info) byName.set(name, (info = { name, songCount: 0, size: 0, duration: 0, empty: true }));
    return info;
  };
  for (const row of dirRows) {
    if (row.dir === prefix) continue; // tracks directly in `prefix` itself
    const info = entry(row.dir.slice(prefixLen).split("/")[0]);
    addStats(info, row);
    info.empty = false;
  }
  for (const { path } of folderRows) {
    const rest = path.slice(prefixLen);
    const slashIdx = rest.indexOf("/");
    const info = entry(slashIdx === -1 ? rest : rest.slice(0, slashIdx));
    if (slashIdx !== -1) info.empty = false;
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Every folder in the library with recursive totals, plus the library-wide
// total (everything with a path) — the Folders view's sidebar tree.
export async function folderTree(db: D1Database): Promise<{ root: FolderStats; folders: TreeFolder[] }> {
  const [dirRows, folderRows] = await Promise.all([q.listDirStats(db, ""), q.listFoldersUnderPath(db, "")]);
  const root: FolderStats = { songCount: 0, size: 0, duration: 0 };
  const byPath = new Map<string, TreeFolder>();
  const ancestorsOf = (path: string) => {
    const segments = path.split("/");
    return segments.map((_, i) => segments.slice(0, i + 1).join("/"));
  };
  const entry = (path: string) => {
    let info = byPath.get(path);
    if (!info) byPath.set(path, (info = { path, songCount: 0, size: 0, duration: 0 }));
    return info;
  };
  for (const row of dirRows) {
    addStats(root, row);
    if (!row.dir) continue;
    for (const path of ancestorsOf(row.dir)) addStats(entry(path), row);
  }
  for (const { path } of folderRows) for (const p of ancestorsOf(path)) entry(p);
  return { root, folders: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)) };
}

// Names already taken directly inside `dir`, by files or subfolders.
async function childNames(db: D1Database, dir: string): Promise<Set<string>> {
  const [tracks, subfolders] = await Promise.all([q.listTracksInDir(db, dir), listSubfolders(db, dir)]);
  return new Set([...tracks.map((t) => baseName(t.source_path!)), ...subfolders.map((f) => f.name)]);
}

// "song.mp3" -> "song (1).mp3" (or "Folder" -> "Folder (1)"), counting up
// until it's free.
function uniqueName(name: string, taken: Set<string>, isFile: boolean): string {
  const dot = isFile ? name.lastIndexOf(".") : -1;
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let i = 1; ; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function trackFileName(t: q.TrackRow): string {
  return t.source_path ? baseName(t.source_path) : `${t.title}.${t.suffix}`;
}

// "ask" makes no changes if any name is already taken in the destination
// and just reports which — the client then asks the user and retries with
// "rename" (move as "name (1)") or "skip" (leave those where they are).
export type ConflictPolicy = "ask" | "rename" | "skip";

export interface MoveResult {
  moved: number;
  skipped: number;
  conflicts: string[];
}

export async function moveItems(
  db: D1Database,
  trackIds: string[],
  folderPaths: string[],
  dest: string,
  policy: ConflictPolicy,
): Promise<MoveResult> {
  if (!(await q.folderExists(db, dest))) throw new FolderError("Destination folder not found", 70);

  const [tracks, taken] = await Promise.all([q.getTracksByIds(db, trackIds), childNames(db, dest)]);
  const folderMoves: { from: string; to: string }[] = [];
  const trackMoves: { id: string; path: string }[] = [];
  const conflicts: string[] = [];
  const sourceDirs: string[] = [];
  let skipped = 0;

  // Claims `name` in dest, resolving a clash per `policy`; null means skip.
  const claim = (name: string, isFile: boolean): string | null => {
    if (taken.has(name)) {
      conflicts.push(name);
      if (policy === "skip") return null;
      if (policy === "rename") name = uniqueName(name, taken, isFile);
    }
    taken.add(name);
    return name;
  };

  for (const path of folderPaths) {
    if (!path) throw new FolderError("Can't move the root folder");
    if (dest === path || dest.startsWith(`${path}/`)) {
      throw new FolderError(`Can't move "${baseName(path)}" into itself`);
    }
    if (parentOf(path) === dest) continue; // already there
    if (!(await q.folderExists(db, path))) throw new FolderError(`Folder not found: ${path}`, 70);
    const name = claim(baseName(path), false);
    if (name === null) {
      skipped++;
      continue;
    }
    folderMoves.push({ from: path, to: joinPath(dest, name) });
    sourceDirs.push(parentOf(path));
  }
  for (const t of tracks) {
    if (t.dir === dest) continue; // already there
    const name = claim(trackFileName(t), true);
    if (name === null) {
      skipped++;
      continue;
    }
    trackMoves.push({ id: t.id, path: joinPath(dest, name) });
    if (t.dir) sourceDirs.push(t.dir);
  }

  if (policy === "ask" && conflicts.length) return { moved: 0, skipped: 0, conflicts };

  const statements = folderMoves.flatMap((m) => q.movePrefixStatements(db, m.from, m.to));
  if (trackMoves.length) statements.push(q.setTrackPathsStatement(db, trackMoves));
  // Keep the folders things were moved out of, even if that emptied them.
  const keep = q.keepFoldersStatement(db, sourceDirs);
  if (keep) statements.push(keep);
  if (statements.length) await db.batch(statements);
  return { moved: folderMoves.length + trackMoves.length, skipped, conflicts };
}

export async function renameFolder(db: D1Database, path: string, newName: string): Promise<string> {
  const name = validateName(newName);
  if (!path || !(await q.folderExists(db, path))) throw new FolderError("Folder not found", 70);
  const newPath = joinPath(parentOf(path), name);
  if (newPath === path) return path;
  if ((await childNames(db, parentOf(path))).has(name)) {
    throw new FolderError(`"${name}" already exists in this folder`);
  }
  await db.batch(q.movePrefixStatements(db, path, newPath));
  return newPath;
}

// Renames a track's file name (the last segment of its source_path) — not
// its title tag, which is what Artists/Songs/the player show.
export async function renameTrackFile(db: D1Database, id: string, newName: string): Promise<string> {
  const name = validateName(newName);
  const track = await q.getTrack(db, id);
  if (!track) throw new FolderError("Song not found", 70);
  if (track.source_path === null) throw new FolderError("This song isn't in a folder");
  const dir = track.dir ?? "";
  const newPath = joinPath(dir, name);
  if (newPath === track.source_path) return newPath;
  if ((await childNames(db, dir)).has(name)) throw new FolderError(`"${name}" already exists in this folder`);
  await db.batch([q.setTrackPathsStatement(db, [{ id, path: newPath }])]);
  return newPath;
}

// Permanently deletes tracks and whole folders (recursively), Telegram
// messages included. Telegram failures are logged, not fatal — same
// tolerance deleteTrack has always had (see TelegramStorage.deleteFile).
export async function deleteItems(
  db: D1Database,
  storage: StorageBackend,
  trackIds: string[],
  folderPaths: string[],
): Promise<{ deleted: number }> {
  const ids = new Set(trackIds);
  for (const path of folderPaths) {
    if (!path) throw new FolderError("Can't delete the root folder");
    for (const id of await q.listTrackIdsUnderPath(db, path)) ids.add(id);
  }
  const removed = await q.deleteTracksCascade(db, [...ids]);

  const statements = folderPaths.map((path) => q.deleteFolderRegistrationsStatement(db, path));
  // Keep the folders things were deleted from, even if that emptied them —
  // unless that folder is itself being deleted.
  const doomed = (dir: string) => folderPaths.some((p) => dir === p || dir.startsWith(`${p}/`));
  const keep = q.keepFoldersStatement(
    db,
    [...folderPaths.map(parentOf), ...removed.map((r) => (r.sourcePath ? parentOf(r.sourcePath) : ""))].filter(
      (dir) => !doomed(dir),
    ),
  );
  if (keep) statements.push(keep);
  if (statements.length) await db.batch(statements);

  if (removed.length) {
    try {
      await storage.deleteFiles(removed.map((r) => r.fileRef));
    } catch (err) {
      console.warn(`Failed to delete Telegram messages for ${removed.length} tracks: ${err}`);
    }
  }
  return { deleted: removed.length };
}
