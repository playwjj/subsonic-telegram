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
  await db
    .prepare(
      `INSERT INTO starred (owner, item_type, item_id, starred_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(owner, item_type, item_id) DO NOTHING`,
    )
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
