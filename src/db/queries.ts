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

export async function getUserPassword(db: D1Database, username: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT password FROM users WHERE username = ?`)
    .bind(username)
    .first<{ password: string }>();
  return row?.password ?? null;
}
