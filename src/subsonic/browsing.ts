import { node, type SNode } from "./node";
import { artistNode, albumNode, songNode, isoDate } from "./mappers";
import * as q from "../db/queries";
import { baseName, listSubfolders, parentOf } from "./folders";

const IGNORED_ARTICLES = "The El La Los Las Le Les";

async function buildArtistIndex(db: D1Database, owner: string): Promise<SNode[]> {
  const [artists, starred] = await Promise.all([q.listArtistsWithCounts(db), q.getStarredIds(db, owner)]);
  const groups = new Map<string, q.ArtistRow[]>();
  for (const a of artists) {
    const letter = letterOf(a.sort_name);
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

// Two views of the same library for clients that browse with getIndexes +
// getMusicDirectory (DSub, Ultrasonic, …): by artist (the default), or by
// the folder tree the Folders page shows, picked as music folder 2.
export const FOLDERS_MUSIC_FOLDER = "2";

export function getMusicFolders(): SNode {
  return node("musicFolders", undefined, {
    lists: {
      musicFolder: [node("musicFolder", { id: 1, name: "Music" }), node("musicFolder", { id: 2, name: "Folders" })],
    },
  });
}

// Folder ids in getMusicDirectory: "dir:" + path ("dir:" alone is the root).
const DIR_PREFIX = "dir:";

function letterOf(name: string): string {
  const first = name[0] ?? "#";
  return /[A-Za-z]/.test(first) ? first.toUpperCase() : "#";
}

function childSong(t: q.TrackRow, parent: string, starredAt?: number): SNode {
  const song = songNode(t, { starredAt });
  return { ...song, tag: "child", attrs: { ...song.attrs, parent } };
}

export async function getIndexes(db: D1Database, owner: string, musicFolderId?: string | null): Promise<SNode> {
  const attrs = { lastModified: Date.now(), ignoredArticles: IGNORED_ARTICLES };
  if (musicFolderId !== FOLDERS_MUSIC_FOLDER) {
    return node("indexes", attrs, { lists: { index: await buildArtistIndex(db, owner) } });
  }
  // Top-level folders as the "artists" of the index, songs at the root as
  // its children.
  const [folders, rootSongs, starred] = await Promise.all([
    listSubfolders(db, ""),
    q.listTracksInDir(db, ""),
    q.getStarredIds(db, owner),
  ]);
  const groups = new Map<string, SNode[]>();
  for (const f of folders) {
    const letter = letterOf(f.name);
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter)!.push(node("artist", { id: DIR_PREFIX + f.name, name: f.name }));
  }
  const index = [...groups.entries()]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([letter, artist]) => node("index", { name: letter }, { lists: { artist } }));
  return node("indexes", attrs, {
    lists: { index, child: rootSongs.map((t) => childSong(t, DIR_PREFIX, starred.tracks.get(t.id))) },
  });
}

// A folder (its subfolders and songs), an artist (its albums) or an album
// (its songs) — whatever the id is.
export async function getMusicDirectory(db: D1Database, owner: string, id: string): Promise<SNode | null> {
  const starred = await q.getStarredIds(db, owner);
  if (id.startsWith(DIR_PREFIX)) {
    const path = id.slice(DIR_PREFIX.length);
    const [subfolders, songs] = await Promise.all([listSubfolders(db, path), q.listTracksInDir(db, path)]);
    if (path && !subfolders.length && !songs.length && !(await q.folderExists(db, path))) return null;
    const dirs = subfolders.map((f) =>
      node("child", { id: `${DIR_PREFIX}${path ? `${path}/` : ""}${f.name}`, parent: id, isDir: true, title: f.name }),
    );
    return node(
      "directory",
      { id, name: path ? baseName(path) : "Folders", parent: path ? DIR_PREFIX + parentOf(path) : undefined },
      { lists: { child: [...dirs, ...songs.map((t) => childSong(t, id, starred.tracks.get(t.id)))] } },
    );
  }

  const artist = await q.getArtist(db, id);
  if (artist) {
    const albums = await q.listAlbumsByArtist(db, id);
    return node(
      "directory",
      { id, name: artist.name, starred: starred.artists.has(id) ? isoDate(starred.artists.get(id)!) : undefined },
      {
        lists: {
          child: albums.map((al) =>
            node("child", {
              id: al.id,
              parent: id,
              isDir: true,
              title: al.name,
              album: al.name,
              artist: al.artist_name,
              year: al.year ?? undefined,
              genre: al.genre ?? undefined,
              coverArt: al.id,
              songCount: al.song_count,
              duration: al.duration,
            }),
          ),
        },
      },
    );
  }

  const album = await q.getAlbum(db, id);
  if (!album) return null;
  const tracks = await q.listTracksByAlbum(db, id);
  return node(
    "directory",
    { id, name: album.name, parent: album.artist_id },
    { lists: { child: tracks.map((t) => childSong(t, id, starred.tracks.get(t.id))) } },
  );
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
      // Per song, its own genre or else its album's (q.TRACK_GENRE); an
      // album counts under every genre one of its songs has.
      `SELECT genre, COUNT(DISTINCT album_id) as album_count, COUNT(*) as song_count
       FROM (SELECT ${q.TRACK_GENRE} as genre, t.album_id FROM tracks t JOIN albums al ON al.id = t.album_id)
       WHERE genre IS NOT NULL AND genre != ''
       GROUP BY genre ORDER BY genre COLLATE NOCASE`,
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
