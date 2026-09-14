import { md5Hex } from "../md5";

export interface ArtistRow {
  id: string;
  name: string;
  sort_name: string;
  album_count: number;
}

export interface AlbumRow {
  id: string;
  name: string;
  artist_id: string;
  artist_name: string;
  year: number | null;
  genre: string | null;
  cover_ref: string | null;
  created_at: number;
  song_count: number;
  duration: number;
}

export interface TrackRow {
  id: string;
  album_id: string;
  album_name: string;
  artist_id: string;
  artist_name: string;
  title: string;
  track_no: number | null;
  disc_no: number | null;
  duration: number | null;
  suffix: string;
  content_type: string;
  size: number;
  bitrate: number | null;
  file_ref: string;
  created_at: number;
  year: number | null;
  genre: string | null;
  play_count: number;
  last_played: number | null;
  source_path: string | null;
}

const ARTIST_SELECT = `
  SELECT a.id, a.name, a.sort_name, COUNT(al.id) as album_count
  FROM artists a LEFT JOIN albums al ON al.artist_id = a.id
`;

const ALBUM_SELECT = `
  SELECT al.id, al.name, al.artist_id, ar.name as artist_name, al.year, al.genre, al.cover_ref, al.created_at,
         COUNT(t.id) as song_count, COALESCE(SUM(t.duration), 0) as duration
  FROM albums al
  JOIN artists ar ON ar.id = al.artist_id
  LEFT JOIN tracks t ON t.album_id = al.id
`;

const TRACK_SELECT = `
  SELECT t.*, al.name as album_name, ar.name as artist_name, al.year, al.genre
  FROM tracks t
  JOIN albums al ON al.id = t.album_id
  JOIN artists ar ON ar.id = t.artist_id
`;

export async function listArtistsWithCounts(db: D1Database): Promise<ArtistRow[]> {
  const { results } = await db
    .prepare(`${ARTIST_SELECT} GROUP BY a.id ORDER BY a.sort_name COLLATE NOCASE`)
    .all<ArtistRow>();
  return results;
}

export async function getArtist(db: D1Database, id: string): Promise<ArtistRow | null> {
  const row = await db
    .prepare(`${ARTIST_SELECT} WHERE a.id = ? GROUP BY a.id`)
    .bind(id)
    .first<ArtistRow>();
  return row ?? null;
}

export async function listAlbumsByArtist(db: D1Database, artistId: string): Promise<AlbumRow[]> {
  const { results } = await db
    .prepare(`${ALBUM_SELECT} WHERE al.artist_id = ? GROUP BY al.id ORDER BY al.year, al.name COLLATE NOCASE`)
    .bind(artistId)
    .all<AlbumRow>();
  return results;
}

export async function getAlbum(db: D1Database, id: string): Promise<AlbumRow | null> {
  const row = await db.prepare(`${ALBUM_SELECT} WHERE al.id = ? GROUP BY al.id`).bind(id).first<AlbumRow>();
  return row ?? null;
}

export async function listTracksByAlbum(db: D1Database, albumId: string): Promise<TrackRow[]> {
  const { results } = await db
    .prepare(`${TRACK_SELECT} WHERE t.album_id = ? ORDER BY t.disc_no, t.track_no`)
    .bind(albumId)
    .all<TrackRow>();
  return results;
}

export async function getTrack(db: D1Database, id: string): Promise<TrackRow | null> {
  const row = await db.prepare(`${TRACK_SELECT} WHERE t.id = ?`).bind(id).first<TrackRow>();
  return row ?? null;
}

const ALBUM_LIST_ORDER: Record<string, string> = {
  newest: "al.created_at DESC",
  alphabeticalByName: "al.name COLLATE NOCASE",
  alphabeticalByArtist: "ar.name COLLATE NOCASE",
  random: "RANDOM()",
  byYear: "al.year",
};

export async function listAlbumList2(
  db: D1Database,
  type: string,
  size: number,
  offset: number,
): Promise<AlbumRow[]> {
  const orderBy = ALBUM_LIST_ORDER[type] ?? ALBUM_LIST_ORDER.newest;
  const { results } = await db
    .prepare(`${ALBUM_SELECT} GROUP BY al.id ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .bind(size, offset)
    .all<AlbumRow>();
  return results;
}

export interface Search3Result {
  artists: ArtistRow[];
  albums: AlbumRow[];
  songs: TrackRow[];
}

export async function search3(
  db: D1Database,
  query: string,
  artistCount: number,
  albumCount: number,
  songCount: number,
): Promise<Search3Result> {
  const like = `%${query}%`;
  const artists = await db
    .prepare(`${ARTIST_SELECT} WHERE a.name LIKE ? GROUP BY a.id LIMIT ?`)
    .bind(like, artistCount)
    .all<ArtistRow>();
  const albums = await db
    .prepare(`${ALBUM_SELECT} WHERE al.name LIKE ? GROUP BY al.id LIMIT ?`)
    .bind(like, albumCount)
    .all<AlbumRow>();
  const songs = await db
    .prepare(`${TRACK_SELECT} WHERE t.title LIKE ? LIMIT ?`)
    .bind(like, songCount)
    .all<TrackRow>();
  return { artists: artists.results, albums: albums.results, songs: songs.results };
}

export async function getTrackBySourcePath(db: D1Database, sourcePath: string): Promise<TrackRow | null> {
  const row = await db.prepare(`${TRACK_SELECT} WHERE t.source_path = ?`).bind(sourcePath).first<TrackRow>();
  return row ?? null;
}

export interface PlaylistRow {
  id: string;
  name: string;
  owner: string;
  created_at: number;
  changed_at: number;
  song_count: number;
  duration: number;
}

const PLAYLIST_SELECT = `
  SELECT p.id, p.name, p.owner, p.created_at, p.changed_at,
         COUNT(pt.track_id) as song_count, COALESCE(SUM(t.duration), 0) as duration
  FROM playlists p
  LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
  LEFT JOIN tracks t ON t.id = pt.track_id
`;

export async function listPlaylists(db: D1Database): Promise<PlaylistRow[]> {
  const { results } = await db
    .prepare(`${PLAYLIST_SELECT} GROUP BY p.id ORDER BY p.name COLLATE NOCASE`)
    .all<PlaylistRow>();
  return results;
}

export async function getPlaylist(db: D1Database, id: string): Promise<PlaylistRow | null> {
  const row = await db.prepare(`${PLAYLIST_SELECT} WHERE p.id = ? GROUP BY p.id`).bind(id).first<PlaylistRow>();
  return row ?? null;
}

export async function listPlaylistTracks(db: D1Database, playlistId: string): Promise<TrackRow[]> {
  const { results } = await db
    .prepare(`${TRACK_SELECT} JOIN playlist_tracks pt ON pt.track_id = t.id WHERE pt.playlist_id = ? ORDER BY pt.position`)
    .bind(playlistId)
    .all<TrackRow>();
  return results;
}

export async function createPlaylist(
  db: D1Database,
  id: string,
  name: string,
  owner: string,
  trackIds: string[],
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.batch([
    db
      .prepare(`INSERT INTO playlists (id, name, owner, created_at, changed_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(id, name, owner, now, now),
    ...trackIds.map((tid, i) =>
      db
        .prepare(`INSERT INTO playlist_tracks (playlist_id, position, track_id) VALUES (?, ?, ?)`)
        .bind(id, i, tid),
    ),
  ]);
}

export async function deletePlaylist(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM playlist_tracks WHERE playlist_id = ?`).bind(id),
    db.prepare(`DELETE FROM playlists WHERE id = ?`).bind(id),
  ]);
}

export async function renamePlaylist(db: D1Database, id: string, name: string): Promise<void> {
  await db
    .prepare(`UPDATE playlists SET name = ?, changed_at = ? WHERE id = ?`)
    .bind(name, Math.floor(Date.now() / 1000), id)
    .run();
}

export async function replacePlaylistTracks(db: D1Database, playlistId: string, trackIds: string[]): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM playlist_tracks WHERE playlist_id = ?`).bind(playlistId),
    ...trackIds.map((tid, i) =>
      db
        .prepare(`INSERT INTO playlist_tracks (playlist_id, position, track_id) VALUES (?, ?, ?)`)
        .bind(playlistId, i, tid),
    ),
    db
      .prepare(`UPDATE playlists SET changed_at = ? WHERE id = ?`)
      .bind(Math.floor(Date.now() / 1000), playlistId),
  ]);
}

export async function addTracksToPlaylist(db: D1Database, playlistId: string, trackIds: string[]): Promise<void> {
  const row = await db
    .prepare(`SELECT COALESCE(MAX(position), -1) as maxPos FROM playlist_tracks WHERE playlist_id = ?`)
    .bind(playlistId)
    .first<{ maxPos: number }>();
  let pos = (row?.maxPos ?? -1) + 1;
  await db.batch([
    ...trackIds.map((tid) =>
      db
        .prepare(`INSERT INTO playlist_tracks (playlist_id, position, track_id) VALUES (?, ?, ?)`)
        .bind(playlistId, pos++, tid),
    ),
    db
      .prepare(`UPDATE playlists SET changed_at = ? WHERE id = ?`)
      .bind(Math.floor(Date.now() / 1000), playlistId),
  ]);
}

export async function removeTracksFromPlaylistByIndex(
  db: D1Database,
  playlistId: string,
  indexes: number[],
): Promise<void> {
  const { results } = await db
    .prepare(`SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position`)
    .bind(playlistId)
    .all<{ track_id: string }>();
  const removeSet = new Set(indexes);
  const kept = results.filter((_, i) => !removeSet.has(i)).map((r) => r.track_id);
  await db.batch([
    db.prepare(`DELETE FROM playlist_tracks WHERE playlist_id = ?`).bind(playlistId),
    ...kept.map((tid, i) =>
      db
        .prepare(`INSERT INTO playlist_tracks (playlist_id, position, track_id) VALUES (?, ?, ?)`)
        .bind(playlistId, i, tid),
    ),
    db
      .prepare(`UPDATE playlists SET changed_at = ? WHERE id = ?`)
      .bind(Math.floor(Date.now() / 1000), playlistId),
  ]);
}

export interface RandomSongsOptions {
  size: number;
  genre?: string;
  fromYear?: number;
  toYear?: number;
}

export async function getRandomSongs(db: D1Database, opts: RandomSongsOptions): Promise<TrackRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.genre !== undefined) {
    conditions.push("al.genre = ?");
    params.push(opts.genre);
  }
  if (opts.fromYear !== undefined) {
    conditions.push("al.year >= ?");
    params.push(opts.fromYear);
  }
  if (opts.toYear !== undefined) {
    conditions.push("al.year <= ?");
    params.push(opts.toYear);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(opts.size);
  const { results } = await db
    .prepare(`${TRACK_SELECT} ${where} ORDER BY RANDOM() LIMIT ?`)
    .bind(...params)
    .all<TrackRow>();
  return results;
}

export async function scrobble(db: D1Database, trackId: string, playedAt: number): Promise<void> {
  await db
    .prepare(`UPDATE tracks SET play_count = play_count + 1, last_played = ? WHERE id = ?`)
    .bind(playedAt, trackId)
    .run();
}

export type StarredItemType = "artist" | "album" | "track";

export async function starItem(
  db: D1Database,
  owner: string,
  itemType: StarredItemType,
  itemId: string,
): Promise<void> {
  // INSERT OR IGNORE (rather than ON CONFLICT(...) DO NOTHING) doesn't need
  // to name the exact constraint it's deduplicating against, so it still
  // works if the deployed starred table predates the composite primary key
  // in db/schema.sql.
  await db
    .prepare(`INSERT OR IGNORE INTO starred (owner, item_type, item_id, starred_at) VALUES (?, ?, ?, ?)`)
    .bind(owner, itemType, itemId, Math.floor(Date.now() / 1000))
    .run();
}

export async function unstarItem(
  db: D1Database,
  owner: string,
  itemType: StarredItemType,
  itemId: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM starred WHERE owner = ? AND item_type = ? AND item_id = ?`)
    .bind(owner, itemType, itemId)
    .run();
}

// One owner's whole starred set, keyed by item type — cheap enough (one
// query, one row per starred item) to fetch per-request and use to annotate
// every artist/album/song a response returns, rather than joining `starred`
// into each of the ARTIST_SELECT/ALBUM_SELECT/TRACK_SELECT templates above.
export interface StarredIds {
  artists: Map<string, number>;
  albums: Map<string, number>;
  tracks: Map<string, number>;
}

export async function getStarredIds(db: D1Database, owner: string): Promise<StarredIds> {
  const { results } = await db
    .prepare(`SELECT item_type, item_id, starred_at FROM starred WHERE owner = ?`)
    .bind(owner)
    .all<{ item_type: StarredItemType; item_id: string; starred_at: number }>();
  const ids: StarredIds = { artists: new Map(), albums: new Map(), tracks: new Map() };
  for (const r of results) {
    const map = r.item_type === "artist" ? ids.artists : r.item_type === "album" ? ids.albums : ids.tracks;
    map.set(r.item_id, r.starred_at);
  }
  return ids;
}

export async function getStarredAt(
  db: D1Database,
  owner: string,
  itemType: StarredItemType,
  itemId: string,
): Promise<number | undefined> {
  const row = await db
    .prepare(`SELECT starred_at FROM starred WHERE owner = ? AND item_type = ? AND item_id = ?`)
    .bind(owner, itemType, itemId)
    .first<{ starred_at: number }>();
  return row?.starred_at ?? undefined;
}

export async function getStarredArtists(db: D1Database, owner: string): Promise<ArtistRow[]> {
  const { results } = await db
    .prepare(
      `${ARTIST_SELECT} WHERE a.id IN (SELECT item_id FROM starred WHERE owner = ? AND item_type = 'artist')
       GROUP BY a.id ORDER BY a.sort_name COLLATE NOCASE`,
    )
    .bind(owner)
    .all<ArtistRow>();
  return results;
}

export async function getStarredAlbums(db: D1Database, owner: string): Promise<AlbumRow[]> {
  const { results } = await db
    .prepare(
      `${ALBUM_SELECT} WHERE al.id IN (SELECT item_id FROM starred WHERE owner = ? AND item_type = 'album')
       GROUP BY al.id ORDER BY al.name COLLATE NOCASE`,
    )
    .bind(owner)
    .all<AlbumRow>();
  return results;
}

export async function getStarredTracks(db: D1Database, owner: string): Promise<TrackRow[]> {
  const { results } = await db
    .prepare(
      `${TRACK_SELECT} WHERE t.id IN (SELECT item_id FROM starred WHERE owner = ? AND item_type = 'track')
       ORDER BY t.title COLLATE NOCASE`,
    )
    .bind(owner)
    .all<TrackRow>();
  return results;
}

export interface LibraryStats {
  artist_count: number;
  album_count: number;
  song_count: number;
  total_duration: number;
}

export async function getLibraryStats(db: D1Database): Promise<LibraryStats> {
  const row = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM artists) as artist_count,
              (SELECT COUNT(*) FROM albums) as album_count,
              (SELECT COUNT(*) FROM tracks) as song_count,
              (SELECT COALESCE(SUM(duration), 0) FROM tracks) as total_duration`,
    )
    .first<LibraryStats>();
  return row!;
}

const SONG_SORT_COLUMNS: Record<string, string> = {
  title: "t.title COLLATE NOCASE",
  artist: "t.artist_name COLLATE NOCASE",
  recent: "t.created_at DESC",
  mostPlayed: "t.play_count DESC",
};

export interface ListAllTracksResult {
  tracks: TrackRow[];
  total: number;
}

export async function listAllTracks(
  db: D1Database,
  opts: { limit: number; offset: number; sort: string },
): Promise<ListAllTracksResult> {
  const orderBy = SONG_SORT_COLUMNS[opts.sort] ?? SONG_SORT_COLUMNS.title;
  const [{ results: tracks }, totalRow] = await Promise.all([
    db
      .prepare(`${TRACK_SELECT} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .bind(opts.limit, opts.offset)
      .all<TrackRow>(),
    db.prepare(`SELECT COUNT(*) as total FROM tracks`).first<{ total: number }>(),
  ]);
  return { tracks, total: totalRow?.total ?? 0 };
}

export async function getRecentlyPlayed(db: D1Database, limit: number): Promise<TrackRow[]> {
  const { results } = await db
    .prepare(`${TRACK_SELECT} WHERE t.last_played IS NOT NULL ORDER BY t.last_played DESC LIMIT ?`)
    .bind(limit)
    .all<TrackRow>();
  return results;
}

export async function getMostPlayed(db: D1Database, limit: number): Promise<TrackRow[]> {
  const { results } = await db
    .prepare(`${TRACK_SELECT} WHERE t.play_count > 0 ORDER BY t.play_count DESC LIMIT ?`)
    .bind(limit)
    .all<TrackRow>();
  return results;
}

export async function listTracksUnderPath(db: D1Database, prefix: string): Promise<TrackRow[]> {
  const pattern = prefix ? `${prefix}/%` : "%";
  const { results } = await db
    .prepare(`${TRACK_SELECT} WHERE t.source_path LIKE ? ORDER BY t.source_path COLLATE NOCASE`)
    .bind(pattern)
    .all<TrackRow>();
  return results;
}

// --- Web UI upload / delete / folder rename ---
// Mirrors scripts/import.ts's ensureArtist/ensureAlbum/insert-track logic
// (same md5-of-natural-key id scheme, so a name uploaded from the web UI
// lines up with the same artist/album a CLI import already created) but
// goes through the D1 binding directly instead of the HTTP API, since this
// only ever runs inside the Worker.

function stripArticle(name: string): string {
  return name.replace(/^(the|a|an)\s+/i, "");
}

export async function ensureArtist(db: D1Database, name: string): Promise<string> {
  const id = md5Hex(`artist:${name.toLowerCase()}`);
  await db
    .prepare(`INSERT INTO artists (id, name, sort_name) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    .bind(id, name, stripArticle(name))
    .run();
  return id;
}

export async function ensureAlbum(
  db: D1Database,
  name: string,
  artistId: string,
  year: number | null,
  genre: string | null,
): Promise<string> {
  const id = md5Hex(`album:${artistId}:${name.toLowerCase()}`);
  await db
    .prepare(
      `INSERT INTO albums (id, name, artist_id, year, genre, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(id, name, artistId, year, genre, Math.floor(Date.now() / 1000))
    .run();
  return id;
}

export interface NewTrackInput {
  albumId: string;
  artistId: string;
  title: string;
  trackNo: number | null;
  discNo: number | null;
  duration: number | null;
  suffix: string;
  contentType: string;
  size: number;
  bitrate: number | null;
  fileRef: string;
  sourcePath: string | null;
  filename: string;
}

export async function insertTrack(db: D1Database, input: NewTrackInput): Promise<string> {
  const id = md5Hex(`track:${input.albumId}:${input.filename}`);
  await db
    .prepare(
      `INSERT INTO tracks
         (id, album_id, artist_id, title, track_no, disc_no, duration, suffix, content_type, size, bitrate, file_ref, created_at, source_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(
      id,
      input.albumId,
      input.artistId,
      input.title,
      input.trackNo,
      input.discNo,
      input.duration,
      input.suffix,
      input.contentType,
      input.size,
      input.bitrate,
      input.fileRef,
      Math.floor(Date.now() / 1000),
      input.sourcePath,
    )
    .run();
  return id;
}

export interface DeletedTrackInfo {
  fileRef: string;
}

// db/schema.sql has no ON DELETE behavior at all, so playlist_tracks/starred
// rows referencing this track (and an album/artist left with zero tracks)
// have to be cleaned up by hand here.
export async function deleteTrackCascade(db: D1Database, trackId: string): Promise<DeletedTrackInfo | null> {
  const track = await db
    .prepare(`SELECT file_ref, album_id, artist_id FROM tracks WHERE id = ?`)
    .bind(trackId)
    .first<{ file_ref: string; album_id: string; artist_id: string }>();
  if (!track) return null;

  await db.batch([
    db.prepare(`DELETE FROM playlist_tracks WHERE track_id = ?`).bind(trackId),
    db.prepare(`DELETE FROM starred WHERE item_type = 'track' AND item_id = ?`).bind(trackId),
    db.prepare(`DELETE FROM tracks WHERE id = ?`).bind(trackId),
  ]);

  const remainingInAlbum = await db
    .prepare(`SELECT COUNT(*) as c FROM tracks WHERE album_id = ?`)
    .bind(track.album_id)
    .first<{ c: number }>();
  if (remainingInAlbum?.c === 0) {
    await db.batch([
      db.prepare(`DELETE FROM starred WHERE item_type = 'album' AND item_id = ?`).bind(track.album_id),
      db.prepare(`DELETE FROM albums WHERE id = ?`).bind(track.album_id),
    ]);

    const remainingArtistAlbums = await db
      .prepare(`SELECT COUNT(*) as c FROM albums WHERE artist_id = ?`)
      .bind(track.artist_id)
      .first<{ c: number }>();
    if (remainingArtistAlbums?.c === 0) {
      await db.batch([
        db.prepare(`DELETE FROM starred WHERE item_type = 'artist' AND item_id = ?`).bind(track.artist_id),
        db.prepare(`DELETE FROM artists WHERE id = ?`).bind(track.artist_id),
      ]);
    }
  }

  return { fileRef: track.file_ref };
}

// Explicit empty-folder registrations — see db/schema.sql. getFolder merges
// these with the folders it derives from tracks.source_path.
export async function listFoldersUnderPath(db: D1Database, prefix: string): Promise<{ path: string }[]> {
  const pattern = prefix ? `${prefix}/%` : "%";
  const { results } = await db
    .prepare(`SELECT path FROM folders WHERE path LIKE ? ORDER BY path COLLATE NOCASE`)
    .bind(pattern)
    .all<{ path: string }>();
  return results;
}

export async function createFolder(db: D1Database, path: string): Promise<void> {
  await db
    .prepare(`INSERT INTO folders (path, created_at) VALUES (?, ?) ON CONFLICT(path) DO NOTHING`)
    .bind(path, Math.floor(Date.now() / 1000))
    .run();
}

export type DeleteFolderResult = "deleted" | "not_found" | "not_empty";

// Only removes the folders registration itself — never touches tracks, so a
// folder with anything under it (tracks, or a nested folder registration)
// is refused rather than silently orphaning content. Use deleteTrackCascade
// to actually remove tracks first.
export async function deleteFolder(db: D1Database, path: string): Promise<DeleteFolderResult> {
  const [tracks, nestedFolders] = await Promise.all([
    listTracksUnderPath(db, path),
    listFoldersUnderPath(db, path),
  ]);
  if (tracks.length > 0 || nestedFolders.length > 0) return "not_empty";

  const result = await db.prepare(`DELETE FROM folders WHERE path = ?`).bind(path).run();
  return result.meta.changes > 0 ? "deleted" : "not_found";
}

// Renames just the leaf segment of a folder — every track whose source_path
// starts with oldPrefix + "/" gets that prefix swapped for newPrefix.
// Returns how many tracks moved (0 means the folder didn't exist).
export async function renameFolder(db: D1Database, oldPrefix: string, newPrefix: string): Promise<number> {
  const trackRows = await listTracksUnderPath(db, oldPrefix);
  // Also catch an explicit registration for the folder itself (path === oldPrefix,
  // e.g. it was created empty and may still be) or for any empty sub-folder
  // registered under it.
  const { results: folderRows } = await db
    .prepare(`SELECT path FROM folders WHERE path = ? OR path LIKE ?`)
    .bind(oldPrefix, `${oldPrefix}/%`)
    .all<{ path: string }>();

  if (!trackRows.length && !folderRows.length) return 0;

  await db.batch([
    ...trackRows.map((row) =>
      db
        .prepare(`UPDATE tracks SET source_path = ? WHERE id = ?`)
        .bind(newPrefix + row.source_path!.slice(oldPrefix.length), row.id),
    ),
    ...folderRows.map((row) =>
      db
        .prepare(`UPDATE folders SET path = ? WHERE path = ?`)
        .bind(newPrefix + row.path.slice(oldPrefix.length), row.path),
    ),
  ]);
  return trackRows.length + folderRows.length;
}
