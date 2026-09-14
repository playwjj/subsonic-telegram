import { node, type SNode } from "./node";
import { artistNode, albumNode, songNode } from "./mappers";
import * as q from "../db/queries";

const IGNORED_ARTICLES = "The El La Los Las Le Les";

async function buildArtistIndex(db: D1Database, owner: string): Promise<SNode[]> {
  const [artists, starred] = await Promise.all([q.listArtistsWithCounts(db), q.getStarredIds(db, owner)]);
  const groups = new Map<string, q.ArtistRow[]>();
  for (const a of artists) {
    const first = a.sort_name[0] ?? "#";
    const letter = /[A-Za-z]/.test(first) ? first.toUpperCase() : "#";
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter)!.push(a);
  }
  return [...groups.entries()]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([letter, list]) =>
      node(
        "index",
        { name: letter },
        { lists: { artist: list.map((a) => artistNode(a, { starredAt: starred.artists.get(a.id) })) } },
      ),
    );
}

export function getMusicFolders(): SNode {
  return node("musicFolders", undefined, {
    lists: { musicFolder: [node("musicFolder", { id: 1, name: "Music" })] },
  });
}

export async function getIndexes(db: D1Database, owner: string): Promise<SNode> {
  const index = await buildArtistIndex(db, owner);
  return node("indexes", { lastModified: Date.now(), ignoredArticles: IGNORED_ARTICLES }, { lists: { index } });
}

export async function getArtists(db: D1Database, owner: string): Promise<SNode> {
  const index = await buildArtistIndex(db, owner);
  return node("artists", { ignoredArticles: IGNORED_ARTICLES }, { lists: { index } });
}

export async function getArtist(db: D1Database, owner: string, id: string): Promise<SNode | null> {
  const artist = await q.getArtist(db, id);
  if (!artist) return null;
  const [albums, starred] = await Promise.all([q.listAlbumsByArtist(db, id), q.getStarredIds(db, owner)]);
  return artistNode(artist, {
    albums: albums.map((al) => albumNode(al, { starredAt: starred.albums.get(al.id) })),
    starredAt: starred.artists.get(id),
  });
}

export async function getAlbum(db: D1Database, owner: string, id: string): Promise<SNode | null> {
  const album = await q.getAlbum(db, id);
  if (!album) return null;
  const [tracks, starred] = await Promise.all([q.listTracksByAlbum(db, id), q.getStarredIds(db, owner)]);
  return albumNode(album, {
    songs: tracks.map((t) => songNode(t, { starredAt: starred.tracks.get(t.id) })),
    starredAt: starred.albums.get(id),
  });
}

export async function getAlbumList2(
  db: D1Database,
  owner: string,
  type: string,
  size: number,
  offset: number,
): Promise<SNode> {
  const [albums, starred] = await Promise.all([q.listAlbumList2(db, type, size, offset), q.getStarredIds(db, owner)]);
  return node("albumList2", undefined, {
    lists: { album: albums.map((al) => albumNode(al, { starredAt: starred.albums.get(al.id) })) },
  });
}

export async function getGenres(db: D1Database): Promise<SNode> {
  const { results } = await db
    .prepare(
      `SELECT al.genre as genre, COUNT(DISTINCT al.id) as album_count, COUNT(t.id) as song_count
       FROM albums al LEFT JOIN tracks t ON t.album_id = al.id
       WHERE al.genre IS NOT NULL AND al.genre != ''
       GROUP BY al.genre ORDER BY al.genre COLLATE NOCASE`,
    )
    .all<{ genre: string; album_count: number; song_count: number }>();
  return node("genres", undefined, {
    lists: {
      genre: results.map((g) =>
        node("genre", { songCount: g.song_count, albumCount: g.album_count }, { text: g.genre }),
      ),
    },
  });
}
