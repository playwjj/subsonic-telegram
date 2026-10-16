// D1 side of the trash (see db/schema.sql's trash/trash_rows tables and
// src/subsonic/trash.ts for the logic). Rows are captured and restored with
// set-based INSERT ... SELECT statements, so the statement count stays the
// same whether a trash entry holds one song or a 3000-song folder. Lists of
// ids travel as a single JSON param through json_each (D1 caps binds at 100).

// Every column each trashable table has, i.e. what a row's JSON snapshot
// holds. tracks.dir is left out: it's a generated column.
const COLUMNS = {
  tracks: [
    "id",
    "album_id",
    "artist_id",
    "title",
    "track_no",
    "disc_no",
    "duration",
    "suffix",
    "content_type",
    "size",
    "bitrate",
    "file_ref",
    "created_at",
    "source_path",
    "play_count",
    "last_played",
    "rating",
    "cover_ref",
  ],
  albums: ["id", "name", "artist_id", "year", "genre", "cover_ref", "created_at"],
  artists: ["id", "name", "sort_name", "cover_ref"],
  playlist_tracks: ["playlist_id", "position", "track_id"],
  starred: ["owner", "item_type", "item_id", "starred_at"],
  folders: ["path", "created_at"],
} as const;

type Table = keyof typeof COLUMNS;

function snapshot(table: Table, alias: string): string {
  return `json_object(${COLUMNS[table].map((c) => `'${c}', ${alias}.${c}`).join(", ")})`;
}

const field = (col: string) => `json_extract(data, '$.${col}')`;

// The tracks being trashed, and the entry each one goes to — bound as ?1.
const MOVES = `(SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.trash') AS trash FROM json_each(?1))`;
const ENTRY_IDS = `(SELECT value FROM json_each(?1))`;

export interface TrashEntryRow {
  id: string;
  kind: "folder" | "track";
  name: string;
  path: string | null;
  song_count: number;
  size: number;
  deleted_at: number;
}

export type NewTrashEntry = Omit<TrashEntryRow, "deleted_at">;

// Records `entries` and copies everything that's about to be deleted into
// trash_rows: the tracks themselves (tagged with their entry via `moves`),
// every album/artist they belong to (the cascade may delete those; an
// unconditional copy keeps each entry restorable on its own, whatever
// happens to the others), their playlist entries and stars (including the
// album/artist ones), and the folder registrations under each trashed
// folder. Must run before the deletes, in the same batch.
export function captureStatements(
  db: D1Database,
  entries: NewTrashEntry[],
  moves: { id: string; trash: string }[],
): D1PreparedStatement[] {
  const m = JSON.stringify(moves);
  const folders = JSON.stringify(entries.filter((e) => e.kind === "folder").map((e) => ({ id: e.id, path: e.path })));
  const capture = (sql: string, param: string) => db.prepare(`INSERT INTO trash_rows (trash_id, tbl, data) ${sql}`).bind(param);
  return [
    db
      .prepare(
        `INSERT INTO trash (id, kind, name, path, song_count, size, deleted_at)
         SELECT json_extract(value, '$.id'), json_extract(value, '$.kind'), json_extract(value, '$.name'),
                json_extract(value, '$.path'), json_extract(value, '$.song_count'), json_extract(value, '$.size'), ?2
         FROM json_each(?1)`,
      )
      .bind(JSON.stringify(entries), Math.floor(Date.now() / 1000)),
    capture(`SELECT m.trash, 'tracks', ${snapshot("tracks", "t")} FROM ${MOVES} m JOIN tracks t ON t.id = m.id`, m),
    capture(
      `SELECT DISTINCT m.trash, 'albums', ${snapshot("albums", "al")}
       FROM ${MOVES} m JOIN tracks t ON t.id = m.id JOIN albums al ON al.id = t.album_id`,
      m,
    ),
    capture(
      `SELECT DISTINCT m.trash, 'artists', ${snapshot("artists", "ar")}
       FROM ${MOVES} m JOIN tracks t ON t.id = m.id JOIN albums al ON al.id = t.album_id
       JOIN artists ar ON ar.id IN (t.artist_id, al.artist_id)`,
      m,
    ),
    capture(
      `SELECT m.trash, 'playlist_tracks', ${snapshot("playlist_tracks", "p")}
       FROM ${MOVES} m JOIN playlist_tracks p ON p.track_id = m.id`,
      m,
    ),
    capture(
      `SELECT DISTINCT m.trash, 'starred', ${snapshot("starred", "s")}
       FROM ${MOVES} m JOIN tracks t ON t.id = m.id JOIN albums al ON al.id = t.album_id
       JOIN starred s ON (s.item_type = 'track' AND s.item_id = t.id)
                      OR (s.item_type = 'album' AND s.item_id = t.album_id)
                      OR (s.item_type = 'artist' AND s.item_id IN (t.artist_id, al.artist_id))`,
      m,
    ),
    capture(
      `SELECT e.id, 'folders', ${snapshot("folders", "f")}
       FROM (SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.path') AS path FROM json_each(?1)) e
       JOIN folders f ON f.path = e.path OR (f.path >= e.path || '/' AND f.path < e.path || '0')`,
      folders,
    ),
  ];
}

export async function listTrashEntries(db: D1Database): Promise<TrashEntryRow[]> {
  const { results } = await db.prepare(`SELECT * FROM trash ORDER BY deleted_at DESC, name`).all<TrashEntryRow>();
  return results;
}

export async function getTrashEntries(db: D1Database, ids: string[]): Promise<TrashEntryRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM trash WHERE id IN ${ENTRY_IDS} ORDER BY deleted_at`)
    .bind(JSON.stringify(ids))
    .all<TrashEntryRow>();
  return results;
}

// Oldest first, for the retention cron.
export async function listExpiredTrashEntries(db: D1Database, before: number, limit: number): Promise<TrashEntryRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM trash WHERE deleted_at < ? ORDER BY deleted_at LIMIT ?`)
    .bind(before, limit)
    .all<TrashEntryRow>();
  return results;
}

export interface TrackSnapshot {
  id: string;
  file_ref: string;
  source_path: string | null;
}

export async function getTrashedTracks(db: D1Database, entryIds: string[]): Promise<TrackSnapshot[]> {
  const { results } = await db
    .prepare(
      `SELECT ${field("id")} AS id, ${field("file_ref")} AS file_ref, ${field("source_path")} AS source_path
       FROM trash_rows WHERE tbl = 'tracks' AND trash_id IN ${ENTRY_IDS}`,
    )
    .bind(JSON.stringify(entryIds))
    .all<TrackSnapshot>();
  return results;
}

// Album/artist ids the given entries hold a copy of that don't exist any
// more — the ones a restore will recreate (and so restore the stars of).
export async function getMissingAlbumsAndArtists(db: D1Database, entryIds: string[]): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT ${field("id")} AS id FROM trash_rows
       WHERE trash_id IN ${ENTRY_IDS}
         AND ((tbl = 'albums' AND NOT EXISTS (SELECT 1 FROM albums WHERE id = ${field("id")}))
           OR (tbl = 'artists' AND NOT EXISTS (SELECT 1 FROM artists WHERE id = ${field("id")})))`,
    )
    .bind(JSON.stringify(entryIds))
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

function restoreSql(table: Table, opts: { expr?: Record<string, string>; where?: string } = {}): string {
  const cols = COLUMNS[table];
  return `INSERT OR IGNORE INTO ${table} (${cols.join(", ")})
    SELECT ${cols.map((c) => opts.expr?.[c] ?? field(c)).join(", ")}
    FROM trash_rows WHERE tbl = '${table}' AND trash_id IN ${ENTRY_IDS} ${opts.where ?? ""}`;
}

// Puts the given entries' rows back and removes the entries. `renames` maps
// a track id to the source_path it should come back under (when its old
// name has been taken since). `recreated` lists album/artist ids that don't
// exist before this restore (getMissingAlbumsAndArtists) — only their stars
// come back, so restoring never re-stars something unstarred in the
// meantime. Rows whose primary key is taken by now (a track id that's been
// re-uploaded, an album that still exists) are skipped via OR IGNORE.
export function restoreStatements(
  db: D1Database,
  entryIds: string[],
  renames: Record<string, string>,
  recreated: string[],
): D1PreparedStatement[] {
  const ids = JSON.stringify(entryIds);
  const playlistExists = `AND EXISTS (SELECT 1 FROM playlists WHERE id = ${field("playlist_id")})`;
  return [
    db.prepare(restoreSql("artists")).bind(ids),
    db.prepare(restoreSql("albums")).bind(ids),
    db
      .prepare(
        restoreSql("tracks", {
          expr: { source_path: `COALESCE(json_extract(?2, '$."' || ${field("id")} || '"'), ${field("source_path")})` },
        }),
      )
      .bind(ids, JSON.stringify(renames)),
    db
      .prepare(
        restoreSql("starred", {
          where: `AND (${field("item_type")} = 'track' OR ${field("item_id")} IN (SELECT value FROM json_each(?2)))`,
        }),
      )
      .bind(ids, JSON.stringify(recreated)),
    // Back at the old playlist position if that slot's still free...
    db.prepare(restoreSql("playlist_tracks", { where: playlistExists })).bind(ids),
    // ...otherwise appended at the end, keeping their relative order.
    // (SQLite computes the SELECT into a temp table first, since it reads
    // the table being inserted into, so MAX() sees the pre-insert state.)
    db
      .prepare(
        `INSERT INTO playlist_tracks (playlist_id, position, track_id)
         SELECT pid,
                (SELECT COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id = pid)
                  + ROW_NUMBER() OVER (PARTITION BY pid ORDER BY pos),
                tid
         FROM (SELECT ${field("playlist_id")} AS pid, ${field("position")} AS pos, ${field("track_id")} AS tid
               FROM trash_rows WHERE tbl = 'playlist_tracks' AND trash_id IN ${ENTRY_IDS})
         WHERE EXISTS (SELECT 1 FROM playlists WHERE id = pid)
           AND NOT EXISTS (SELECT 1 FROM playlist_tracks p WHERE p.playlist_id = pid AND p.position = pos AND p.track_id = tid)`,
      )
      .bind(ids),
    db.prepare(restoreSql("folders")).bind(ids),
    ...deleteEntriesStatements(db, entryIds),
  ];
}

export function deleteEntriesStatements(db: D1Database, entryIds: string[]): D1PreparedStatement[] {
  const ids = JSON.stringify(entryIds);
  return [
    db.prepare(`DELETE FROM trash_rows WHERE trash_id IN ${ENTRY_IDS}`).bind(ids),
    db.prepare(`DELETE FROM trash WHERE id IN ${ENTRY_IDS}`).bind(ids),
  ];
}

// Telegram files of the given entries' tracks — minus any a live track still
// points at, so purging can never take out a file that's in use.
export async function getPurgeableFileRefs(db: D1Database, entryIds: string[]): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT ${field("file_ref")} AS ref FROM trash_rows
       WHERE tbl = 'tracks' AND trash_id IN ${ENTRY_IDS}
         AND NOT EXISTS (SELECT 1 FROM tracks WHERE file_ref = ${field("file_ref")})`,
    )
    .bind(JSON.stringify(entryIds))
    .all<{ ref: string }>();
  return results.map((r) => r.ref);
}

// --- pending_deletes: Telegram deletes to retry ---

export async function queuePendingDeletes(db: D1Database, refs: string[], error: string | undefined): Promise<void> {
  if (!refs.length) return;
  await db
    .prepare(
      `INSERT INTO pending_deletes (file_ref, attempts, last_error, created_at)
       SELECT value, 1, ?2, ?3 FROM json_each(?1) WHERE true
       ON CONFLICT(file_ref) DO UPDATE SET attempts = attempts + 1, last_error = excluded.last_error`,
    )
    .bind(JSON.stringify(refs), error ?? null, Math.floor(Date.now() / 1000))
    .run();
}

export async function listPendingDeletes(db: D1Database, limit: number): Promise<string[]> {
  const { results } = await db
    .prepare(`SELECT file_ref FROM pending_deletes ORDER BY created_at LIMIT ?`)
    .bind(limit)
    .all<{ file_ref: string }>();
  return results.map((r) => r.file_ref);
}

export async function removePendingDeletes(db: D1Database, refs: string[]): Promise<void> {
  if (!refs.length) return;
  await db
    .prepare(`DELETE FROM pending_deletes WHERE file_ref IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(refs))
    .run();
}

export async function countPendingDeletes(db: D1Database): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM pending_deletes`).first<{ n: number }>();
  return row?.n ?? 0;
}
