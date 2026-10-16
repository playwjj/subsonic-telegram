import { md5Hex } from "../md5";

export interface ArtistRow {
  id: string;
  name: string;
  sort_name: string;
  cover_ref: string | null;
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
  rating: number;
  cover_ref: string | null;
  dir: string | null;
}

const ARTIST_SELECT = `
  SELECT a.id, a.name, a.sort_name, a.cover_ref, COUNT(al.id) as album_count
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

// An artist's own photo if fix-covers found one, otherwise borrows the
// cover of one of their albums (newest first), then any per-track cover —
// so artists still get a real picture, just not a portrait.
export async function getArtistCoverRef(db: D1Database, artistId: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT COALESCE(
         ar.cover_ref,
         (SELECT cover_ref FROM albums WHERE artist_id = ar.id AND cover_ref IS NOT NULL
          ORDER BY year DESC, created_at DESC LIMIT 1),
         (SELECT cover_ref FROM tracks WHERE artist_id = ar.id AND cover_ref IS NOT NULL LIMIT 1)
       ) as cover_ref
       FROM artists ar WHERE ar.id = ?`,
    )
    .bind(artistId)
    .first<{ cover_ref: string | null }>();
  return row?.cover_ref ?? null;
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
  // Tracks to leave out — used to fill the rest of a "size" quota after
  // getRandomStarredTracks already claimed some of it, without risking the
  // same track being picked twice.
  excludeIds?: string[];
}

function randomSongsFilter(opts: {
  genre?: string;
  fromYear?: number;
  toYear?: number;
  excludeIds?: string[];
}): { conditions: string[]; params: unknown[] } {
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
  if (opts.excludeIds?.length) {
    conditions.push(`t.id NOT IN (${opts.excludeIds.map(() => "?").join(",")})`);
    params.push(...opts.excludeIds);
  }
  return { conditions, params };
}

export async function getRandomSongs(db: D1Database, opts: RandomSongsOptions): Promise<TrackRow[]> {
  const { conditions, params } = randomSongsFilter(opts);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(opts.size);
  const { results } = await db
    .prepare(`${TRACK_SELECT} ${where} ORDER BY RANDOM() LIMIT ?`)
    .bind(...params)
    .all<TrackRow>();
  return results;
}

// Same shape as getRandomSongs, restricted to owner's starred tracks — used
// to blend a share of favorites into the "random songs" widget/endpoint.
export async function getRandomStarredTracks(
  db: D1Database,
  owner: string,
  opts: { size: number; genre?: string; fromYear?: number; toYear?: number },
): Promise<TrackRow[]> {
  const { conditions, params } = randomSongsFilter(opts);
  conditions.push(`t.id IN (SELECT item_id FROM starred WHERE owner = ? AND item_type = 'track')`);
  params.push(owner, opts.size);
  const { results } = await db
    .prepare(`${TRACK_SELECT} WHERE ${conditions.join(" AND ")} ORDER BY RANDOM() LIMIT ?`)
    .bind(...params)
    .all<TrackRow>();
  return results;
}

// Same shape as getRandomSongs, restricted to the most recently added tracks
// (by created_at) — used to blend a share of newly added music into the
// "random songs" widget/endpoint.
export async function getRandomRecentTracks(
  db: D1Database,
  opts: { size: number; genre?: string; fromYear?: number; toYear?: number; excludeIds?: string[]; pool: number },
): Promise<TrackRow[]> {
  const { conditions, params } = randomSongsFilter(opts);
  conditions.push(`t.id IN (SELECT id FROM tracks ORDER BY created_at DESC LIMIT ?)`);
  params.push(opts.pool, opts.size);
  const { results } = await db
    .prepare(`${TRACK_SELECT} WHERE ${conditions.join(" AND ")} ORDER BY RANDOM() LIMIT ?`)
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

export async function setRating(db: D1Database, trackId: string, rating: number): Promise<void> {
  await db.prepare(`UPDATE tracks SET rating = ? WHERE id = ?`).bind(rating, trackId).run();
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

// getTopSongs takes an artist *name*, not id (that's the classic Subsonic
// spec — it predates ID3 browsing), so this matches case-insensitively
// rather than joining on artist_id.
export async function getTopSongsByArtistName(db: D1Database, artistName: string, limit: number): Promise<TrackRow[]> {
  const { results } = await db
    .prepare(`${TRACK_SELECT} WHERE ar.name = ? COLLATE NOCASE ORDER BY t.play_count DESC LIMIT ?`)
    .bind(artistName, limit)
    .all<TrackRow>();
  return results;
}

// There's no "similar artists" graph here (that's normally sourced from
// Last.fm) — getSimilarSongs2 approximates it locally: mostly the artist's
// own other tracks, blended with tracks from other artists sharing their
// most common genre, the same "blend a few related signals" approach
// getRandomSongs already uses.
export async function getArtistPrimaryGenre(db: D1Database, artistId: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT genre FROM albums WHERE artist_id = ? AND genre IS NOT NULL GROUP BY genre ORDER BY COUNT(*) DESC LIMIT 1`,
    )
    .bind(artistId)
    .first<{ genre: string }>();
  return row?.genre ?? null;
}

export async function getRandomTracksByArtist(db: D1Database, artistId: string, limit: number): Promise<TrackRow[]> {
  const { results } = await db
    .prepare(`${TRACK_SELECT} WHERE t.artist_id = ? ORDER BY RANDOM() LIMIT ?`)
    .bind(artistId, limit)
    .all<TrackRow>();
  return results;
}

export async function getRandomTracksByGenreExcludingArtist(
  db: D1Database,
  genre: string,
  excludeArtistId: string,
  limit: number,
): Promise<TrackRow[]> {
  const { results } = await db
    .prepare(`${TRACK_SELECT} WHERE al.genre = ? AND t.artist_id != ? ORDER BY RANDOM() LIMIT ?`)
    .bind(genre, excludeArtistId, limit)
    .all<TrackRow>();
  return results;
}

// Fetches tracks by id, preserving the input order and silently dropping any
// id that no longer exists (e.g. a track referenced by a saved play queue
// that's since been deleted).
export async function getTracksByIds(db: D1Database, ids: string[]): Promise<TrackRow[]> {
  if (!ids.length) return [];
  // One JSON param rather than one bind per id — D1 caps binds at 100.
  const { results } = await db
    .prepare(`${TRACK_SELECT} WHERE t.id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(ids))
    .all<TrackRow>();
  const byId = new Map(results.map((t) => [t.id, t]));
  return ids.map((id) => byId.get(id)).filter((t): t is TrackRow => !!t);
}

export interface PlayQueueRow {
  owner: string;
  track_ids: string;
  current_id: string | null;
  position_ms: number;
  changed_at: number;
  changed_by: string | null;
}

export async function getPlayQueue(db: D1Database, owner: string): Promise<PlayQueueRow | null> {
  const row = await db.prepare(`SELECT * FROM play_queue WHERE owner = ?`).bind(owner).first<PlayQueueRow>();
  return row ?? null;
}

export async function savePlayQueue(
  db: D1Database,
  owner: string,
  opts: { trackIds: string[]; currentId: string | null; positionMs: number; changedBy: string | null },
): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO play_queue (owner, track_ids, current_id, position_ms, changed_at, changed_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(owner, JSON.stringify(opts.trackIds), opts.currentId, opts.positionMs, Math.floor(Date.now() / 1000), opts.changedBy)
    .run();
}

// "Strictly under folder `prefix`" as a range on a path column: "/" is
// 0x2F and "0" is 0x30, so [prefix + "/", prefix + "0") is exactly the set of
// strings starting with prefix + "/". Unlike LIKE there are no wildcards to
// escape (a folder named "a_b" no longer matches "axb/..."), it's
// case-sensitive like a real path, and it can use the column's index. The
// empty prefix (the root) means everything that has a path at all.
export function underPrefix(column: string, prefix: string): { sql: string; binds: string[] } {
  if (!prefix) return { sql: `${column} IS NOT NULL`, binds: [] };
  return { sql: `(${column} >= ? AND ${column} < ?)`, binds: [`${prefix}/`, `${prefix}0`] };
}

export async function getRandomTracksUnderPath(db: D1Database, prefix: string, limit: number): Promise<TrackRow[]> {
  const under = underPrefix("t.source_path", prefix);
  const { results } = await db
    .prepare(`${TRACK_SELECT} WHERE ${under.sql} ORDER BY RANDOM() LIMIT ?`)
    .bind(...under.binds, limit)
    .all<TrackRow>();
  return results;
}

// Tracks directly inside one folder (not its subfolders) — "" is the root.
export async function listTracksInDir(db: D1Database, dir: string): Promise<TrackRow[]> {
  const { results } = await db
    .prepare(`${TRACK_SELECT} WHERE t.dir = ? ORDER BY t.source_path COLLATE NOCASE`)
    .bind(dir)
    .all<TrackRow>();
  return results;
}

// Tracks anywhere under a folder, in path order, optionally narrowed to ones
// whose title/artist/album/file name (relative to the folder) contains
// `query`. Backs the Folders view's "play folder" and in-folder search.
export async function listTracksUnderPath(
  db: D1Database,
  prefix: string,
  opts: { query?: string; limit?: number } = {},
): Promise<TrackRow[]> {
  const under = underPrefix("t.source_path", prefix);
  const binds: (string | number)[] = [...under.binds];
  let where = under.sql;
  if (opts.query) {
    // Escape LIKE's own wildcards so the query matches literally.
    const pattern = `%${opts.query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const like = (expr: string) => `${expr} LIKE ? ESCAPE '\\'`;
    where += ` AND (${like("t.title")} OR ${like("ar.name")} OR ${like("al.name")} OR ${like("substr(t.source_path, ?)")})`;
    binds.push(pattern, pattern, pattern, prefix ? prefix.length + 2 : 1, pattern);
  }
  const { results } = await db
    .prepare(`${TRACK_SELECT} WHERE ${where} ORDER BY t.source_path COLLATE NOCASE LIMIT ?`)
    .bind(...binds, opts.limit ?? -1)
    .all<TrackRow>();
  return results;
}

export async function listTrackSizesUnderPath(db: D1Database, prefix: string): Promise<{ id: string; size: number }[]> {
  const under = underPrefix("source_path", prefix);
  const { results } = await db
    .prepare(`SELECT id, size FROM tracks WHERE ${under.sql}`)
    .bind(...under.binds)
    .all<{ id: string; size: number }>();
  return results;
}

export async function listTrackIdsUnderPath(db: D1Database, prefix: string): Promise<string[]> {
  const under = underPrefix("source_path", prefix);
  const { results } = await db
    .prepare(`SELECT id FROM tracks WHERE ${under.sql}`)
    .bind(...under.binds)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

export interface DirStatRow {
  dir: string;
  song_count: number;
  size: number;
  duration: number;
}

// Totals per directory for every directory at or below `prefix` that
// directly holds tracks — read straight off idx_tracks_dir, without touching
// the tracks themselves. Callers roll these up into parent folders (see
// src/subsonic/folders.ts).
export async function listDirStats(db: D1Database, prefix: string): Promise<DirStatRow[]> {
  const under = underPrefix("dir", prefix);
  const where = prefix ? `(dir = ? OR ${under.sql})` : "dir IS NOT NULL";
  const { results } = await db
    .prepare(
      `SELECT dir, COUNT(*) as song_count, COALESCE(SUM(size), 0) as size, COALESCE(SUM(duration), 0) as duration
       FROM tracks WHERE ${where} GROUP BY dir`,
    )
    .bind(...(prefix ? [prefix, ...under.binds] : []))
    .all<DirStatRow>();
  return results;
}

// Whether anything lives at `path`: a track under it, or an explicit
// registration of it or something below it. The root always exists.
export async function folderExists(db: D1Database, path: string): Promise<boolean> {
  if (!path) return true;
  const tracks = underPrefix("source_path", path);
  const folders = underPrefix("path", path);
  const row = await db
    .prepare(
      `SELECT EXISTS(SELECT 1 FROM tracks WHERE ${tracks.sql})
           OR EXISTS(SELECT 1 FROM folders WHERE path = ? OR ${folders.sql}) as found`,
    )
    .bind(...tracks.binds, path, ...folders.binds)
    .first<{ found: number }>();
  return !!row?.found;
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

export const artistIdFor = (name: string) => md5Hex(`artist:${name.toLowerCase()}`);
export const albumIdFor = (artistId: string, name: string) => md5Hex(`album:${artistId}:${name.toLowerCase()}`);

export async function ensureArtist(db: D1Database, name: string): Promise<string> {
  const id = artistIdFor(name);
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
  const id = albumIdFor(artistId, name);
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
  // From freeTrackId beforehand (uploadTrack needs it for the caption).
  id?: string;
}

// The id scheme is md5 of album + file name (same as scripts/import.ts), so
// the same file name in the same album but a different folder would clash;
// those fall back to also hashing the folder path. Never returns an id
// that's already taken — insertTrack's ON CONFLICT DO NOTHING would
// otherwise silently keep the other track.
export async function freeTrackId(
  db: D1Database,
  input: Pick<NewTrackInput, "albumId" | "filename" | "sourcePath">,
): Promise<string> {
  const seeds = [`track:${input.albumId}:${input.filename}`, `track:${input.albumId}:${input.sourcePath ?? input.filename}`];
  for (let i = 0; ; i++) {
    const id = md5Hex(seeds[i] ?? `${seeds[1]}:${i}`);
    const taken = await db.prepare(`SELECT 1 FROM tracks WHERE id = ?`).bind(id).first();
    if (!taken) return id;
  }
}

export async function insertTrack(db: D1Database, input: NewTrackInput): Promise<string> {
  const id = input.id ?? (await freeTrackId(db, input));
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
  sourcePath: string | null;
}

export interface TrackDeleteRow {
  id: string;
  file_ref: string;
  source_path: string | null;
  album_id: string;
  artist_id: string;
}

export async function getTracksForDelete(db: D1Database, trackIds: string[]): Promise<TrackDeleteRow[]> {
  if (!trackIds.length) return [];
  const { results } = await db
    .prepare(
      `SELECT id, file_ref, source_path, album_id, artist_id FROM tracks WHERE id IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify(trackIds))
    .all<TrackDeleteRow>();
  return results;
}

// db/schema.sql has no ON DELETE behavior at all, so playlist_tracks/starred
// rows referencing these tracks (and albums/artists left with nothing in
// them) have to be cleaned up by hand here. Set-based, so the number of
// statements stays the same whether this is one track or a whole folder
// (D1 caps queries per Worker invocation); ids travel as one JSON array
// param via json_each rather than one bind per id (D1 caps those at 100).
// Meant for a db.batch(), which runs as one transaction, in order — so the
// album/artist checks already see the tracks gone.
export function cascadeDeleteStatements(db: D1Database, rows: TrackDeleteRow[]): D1PreparedStatement[] {
  if (!rows.length) return [];
  const ids = JSON.stringify(rows.map((r) => r.id));
  return [
    db.prepare(`DELETE FROM playlist_tracks WHERE track_id IN (SELECT value FROM json_each(?))`).bind(ids),
    db.prepare(`DELETE FROM starred WHERE item_type = 'track' AND item_id IN (SELECT value FROM json_each(?))`).bind(ids),
    db.prepare(`DELETE FROM tracks WHERE id IN (SELECT value FROM json_each(?))`).bind(ids),
    ...pruneEmptyStatements(
      db,
      rows.map((r) => r.album_id),
      rows.map((r) => r.artist_id),
    ),
  ];
}

// Of the given albums and artists, deletes the ones left with nothing in
// them (and their stars) — after a delete, or after a tag edit moved songs
// to another album/artist. Same json_each batching as above.
export function pruneEmptyStatements(db: D1Database, albumIds: string[], artistIds: string[]): D1PreparedStatement[] {
  const albums = JSON.stringify([...new Set(albumIds)]);
  const artists = JSON.stringify([...new Set(artistIds)]);
  const emptyAlbums = `SELECT value FROM json_each(?) WHERE NOT EXISTS (SELECT 1 FROM tracks WHERE album_id = value)`;
  const emptyArtists = `SELECT value FROM json_each(?) WHERE NOT EXISTS (SELECT 1 FROM albums WHERE artist_id = value)
    AND NOT EXISTS (SELECT 1 FROM tracks WHERE artist_id = value)`;
  return [
    db.prepare(`DELETE FROM starred WHERE item_type = 'album' AND item_id IN (${emptyAlbums})`).bind(albums),
    db.prepare(`DELETE FROM albums WHERE id IN (${emptyAlbums})`).bind(albums),
    db.prepare(`DELETE FROM starred WHERE item_type = 'artist' AND item_id IN (${emptyArtists})`).bind(artists),
    db.prepare(`DELETE FROM artists WHERE id IN (${emptyArtists})`).bind(artists),
  ];
}

export async function deleteTracksCascade(db: D1Database, trackIds: string[]): Promise<DeletedTrackInfo[]> {
  const rows = await getTracksForDelete(db, trackIds);
  if (!rows.length) return [];
  await db.batch(cascadeDeleteStatements(db, rows));
  return rows.map((r) => ({ fileRef: r.file_ref, sourcePath: r.source_path }));
}

// Explicit folder registrations — see db/schema.sql. getFolder merges
// these with the folders it derives from tracks.source_path.
export async function listFoldersUnderPath(db: D1Database, prefix: string): Promise<{ path: string }[]> {
  const under = underPrefix("path", prefix);
  const { results } = await db
    .prepare(`SELECT path FROM folders WHERE ${under.sql} ORDER BY path COLLATE NOCASE`)
    .bind(...under.binds)
    .all<{ path: string }>();
  return results;
}

export async function createFolder(db: D1Database, path: string): Promise<void> {
  await db
    .prepare(`INSERT INTO folders (path, created_at) VALUES (?, ?) ON CONFLICT(path) DO NOTHING`)
    .bind(path, Math.floor(Date.now() / 1000))
    .run();
}

// Registers each (non-root) path so it keeps showing up even once nothing
// is left in it — what a file manager does when you move or delete the last
// thing out of a folder.
export function keepFoldersStatement(db: D1Database, paths: string[]): D1PreparedStatement | null {
  const kept = [...new Set(paths.filter(Boolean))];
  if (!kept.length) return null;
  return db
    .prepare(`INSERT INTO folders (path, created_at) SELECT value, ? FROM json_each(?) WHERE true ON CONFLICT(path) DO NOTHING`)
    .bind(Math.floor(Date.now() / 1000), JSON.stringify(kept));
}

// Drops the registration of `path` and of everything below it. Tracks are
// the caller's business (deleteTracksCascade).
export function deleteFolderRegistrationsStatement(db: D1Database, path: string): D1PreparedStatement {
  const under = underPrefix("path", path);
  return db.prepare(`DELETE FROM folders WHERE path = ? OR ${under.sql}`).bind(path, ...under.binds);
}

export type DeleteFolderResult = "deleted" | "not_found" | "not_empty";

// Only removes the folders registration itself — never touches tracks, so a
// folder with anything under it (tracks, or a nested folder registration)
// is refused rather than silently orphaning content. The Folders view's
// recursive delete goes through deleteItems (src/subsonic/folders.ts)
// instead; this stays for the plain "delete empty folder" endpoint.
export async function deleteFolder(db: D1Database, path: string): Promise<DeleteFolderResult> {
  const [tracks, nestedFolders] = await Promise.all([
    listTrackIdsUnderPath(db, path),
    listFoldersUnderPath(db, path),
  ]);
  if (tracks.length > 0 || nestedFolders.length > 0) return "not_empty";

  const result = await db.prepare(`DELETE FROM folders WHERE path = ?`).bind(path).run();
  return result.meta.changes > 0 ? "deleted" : "not_found";
}

// Moves folder oldPrefix (and everything in it) to newPrefix — a rename
// when only the last segment differs. One UPDATE per table, whatever the
// folder's size. OR REPLACE on folders: a registration that already exists
// at the target path is the same folder anyway.
export function movePrefixStatements(db: D1Database, oldPrefix: string, newPrefix: string): D1PreparedStatement[] {
  const tracks = underPrefix("source_path", oldPrefix);
  const folders = underPrefix("path", oldPrefix);
  const tailStart = oldPrefix.length + 1;
  return [
    db
      .prepare(`UPDATE tracks SET source_path = ? || substr(source_path, ?) WHERE ${tracks.sql}`)
      .bind(newPrefix, tailStart, ...tracks.binds),
    db
      .prepare(`UPDATE OR REPLACE folders SET path = ? || substr(path, ?) WHERE path = ? OR ${folders.sql}`)
      .bind(newPrefix, tailStart, oldPrefix, ...folders.binds),
  ];
}

// Sets source_path for many tracks in one statement — `moves` travels as a
// single JSON array of {id, path} (see deleteTracksCascade on why).
export function setTrackPathsStatement(db: D1Database, moves: { id: string; path: string }[]): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE tracks SET source_path = (
         SELECT json_extract(value, '$.path') FROM json_each(?1) WHERE json_extract(value, '$.id') = tracks.id
       )
       WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))`,
    )
    .bind(JSON.stringify(moves));
}

// Tracks that have at least one likely duplicate, ordered so duplicates sit
// next to each other: by "tags" (same title, ignoring case and surrounding
// spaces, by the same artist — getDuplicates then splits those by
// duration), or by "size" (same byte size and format: almost certainly
// the very same file uploaded twice).
export async function listDuplicateTracks(db: D1Database, mode: "tags" | "size"): Promise<TrackRow[]> {
  const sql =
    mode === "size"
      ? `${TRACK_SELECT}
         WHERE (t.size, t.suffix) IN (SELECT size, suffix FROM tracks GROUP BY size, suffix HAVING COUNT(*) > 1)
         ORDER BY t.size DESC, t.suffix, t.created_at`
      : `${TRACK_SELECT}
         WHERE (lower(trim(t.title)), t.artist_id) IN
           (SELECT lower(trim(title)), artist_id FROM tracks GROUP BY 1, 2 HAVING COUNT(*) > 1)
         ORDER BY lower(trim(t.title)), t.artist_id, t.duration, t.created_at`;
  const { results } = await db.prepare(sql).all<TrackRow>();
  return results;
}

export async function listLargestTracks(db: D1Database, limit: number): Promise<TrackRow[]> {
  const { results } = await db.prepare(`${TRACK_SELECT} ORDER BY t.size DESC LIMIT ?`).bind(limit).all<TrackRow>();
  return results;
}
