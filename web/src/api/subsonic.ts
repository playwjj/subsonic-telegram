// Thin client for this project's Subsonic REST API. Every call attaches the
// credentials stored by stores/auth.ts as query params — same model any
// Subsonic client uses, just from a browser instead of a native app.
import { getCredentials, setCredentials } from "../stores/auth";

const CLIENT_NAME = "subsonic-telegram-web";
const API_VERSION = "1.16.1";

export class SubsonicError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

type ParamValue = string | number | undefined;
type Params = Record<string, ParamValue | ParamValue[]>;

function buildSearch(params: Params, creds: { username: string; password: string }): URLSearchParams {
  const search = new URLSearchParams();
  search.set("u", creds.username);
  search.set("p", creds.password);
  search.set("v", API_VERSION);
  search.set("c", CLIENT_NAME);
  search.set("f", "json");
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) if (item !== undefined) search.append(key, String(item));
    } else {
      search.set(key, String(value));
    }
  }
  return search;
}

function buildUrl(endpoint: string, params: Params = {}, creds?: { username: string; password: string }): string {
  const search = buildSearch(params, creds ?? getCredentials());
  return `/rest/${endpoint}.view?${search.toString()}`;
}

async function call<T>(
  endpoint: string,
  params?: Params,
  creds?: { username: string; password: string },
): Promise<T> {
  const res = await fetch(buildUrl(endpoint, params, creds));
  const data = (await res.json()) as { "subsonic-response": any };
  const body = data["subsonic-response"];
  if (body.status !== "ok") {
    throw new SubsonicError(body.error?.code ?? 0, body.error?.message ?? "Unknown error");
  }
  return body as T;
}

export function streamUrl(id: string): string {
  return buildUrl("stream", { id });
}

export function coverArtUrl(id: string): string {
  return buildUrl("getCoverArt", { id });
}

export async function login(username: string, password: string): Promise<void> {
  await call("ping", {}, { username, password });
  setCredentials({ username, password });
}

// --- entity shapes, matching src/subsonic/mappers.ts on the Worker side ---

export interface Artist {
  id: string;
  name: string;
  albumCount: number;
}

export interface ArtistIndex {
  name: string;
  artist: Artist[];
}

export interface Album {
  id: string;
  name: string;
  artist: string;
  artistId: string;
  songCount: number;
  duration: number;
  created: string;
  year?: number;
  genre?: string;
  coverArt?: string;
}

export interface Song {
  id: string;
  parent: string;
  isDir: boolean;
  title: string;
  album: string;
  artist: string;
  track?: number;
  discNumber?: number;
  year?: number;
  genre?: string;
  size: number;
  contentType: string;
  suffix: string;
  duration?: number;
  bitRate?: number;
  coverArt: string;
  albumId: string;
  artistId: string;
  type: string;
}

export interface ArtistDetail extends Artist {
  album: Album[];
}

export interface AlbumDetail extends Album {
  song: Song[];
}

export interface Playlist {
  id: string;
  name: string;
  owner: string;
  songCount: number;
  duration: number;
  created: string;
  changed: string;
}

export interface PlaylistDetail extends Playlist {
  entry: Song[];
}

export async function getArtists(): Promise<ArtistIndex[]> {
  const body = await call<{ artists: { index: ArtistIndex[] } }>("getArtists");
  return body.artists.index;
}

export async function getArtist(id: string): Promise<ArtistDetail> {
  const body = await call<{ artist: ArtistDetail }>("getArtist", { id });
  return body.artist;
}

export async function getAlbum(id: string): Promise<AlbumDetail> {
  const body = await call<{ album: AlbumDetail }>("getAlbum", { id });
  return body.album;
}

export async function getAlbumList2(opts: { type: string; size: number }): Promise<Album[]> {
  const body = await call<{ albumList2: { album: Album[] } }>("getAlbumList2", opts);
  return body.albumList2.album;
}

export async function search3(query: string): Promise<{ artist: Artist[]; album: Album[]; song: Song[] }> {
  const body = await call<{ searchResult3: { artist: Artist[]; album: Album[]; song: Song[] } }>("search3", {
    query,
  });
  return body.searchResult3;
}

export async function getPlaylists(): Promise<Playlist[]> {
  const body = await call<{ playlists: { playlist: Playlist[] } }>("getPlaylists");
  return body.playlists.playlist;
}

export async function getPlaylist(id: string): Promise<PlaylistDetail> {
  const body = await call<{ playlist: PlaylistDetail }>("getPlaylist", { id });
  return body.playlist;
}

export async function createPlaylist(opts: {
  name?: string;
  playlistId?: string;
  songIds?: string[];
}): Promise<PlaylistDetail> {
  const body = await call<{ playlist: PlaylistDetail }>("createPlaylist", {
    name: opts.name,
    playlistId: opts.playlistId,
    songId: opts.songIds,
  });
  return body.playlist;
}

export async function updatePlaylist(opts: {
  playlistId: string;
  name?: string;
  songIdToAdd?: string[];
  songIndexToRemove?: number[];
}): Promise<void> {
  await call("updatePlaylist", {
    playlistId: opts.playlistId,
    name: opts.name,
    songIdToAdd: opts.songIdToAdd,
    songIndexToRemove: opts.songIndexToRemove,
  });
}

export async function deletePlaylist(id: string): Promise<void> {
  await call("deletePlaylist", { id });
}

// --- Home/Songs/Folders — these are custom endpoints this project's own
// Worker exposes for this web UI, not part of the official Subsonic spec.

export interface LibraryStats {
  artistCount: number;
  albumCount: number;
  songCount: number;
  totalDuration: number;
}

export async function getLibraryStats(): Promise<LibraryStats> {
  const body = await call<{ libraryStats: LibraryStats }>("getLibraryStats");
  return body.libraryStats;
}

export type SongSort = "title" | "artist" | "recent" | "mostPlayed";

export async function getSongs(opts: { size: number; offset: number; sort: SongSort }): Promise<{
  songs: Song[];
  total: number;
}> {
  const body = await call<{ songs: { total: number; song: Song[] } }>("getSongs", {
    size: opts.size,
    offset: opts.offset,
    sort: opts.sort,
  });
  return { songs: body.songs.song, total: body.songs.total };
}

export async function getRandomSongs(size: number): Promise<Song[]> {
  const body = await call<{ randomSongs: { song: Song[] } }>("getRandomSongs", { size });
  return body.randomSongs.song;
}

export async function getRecentlyPlayed(size: number): Promise<Song[]> {
  const body = await call<{ recentlyPlayed: { song: Song[] } }>("getRecentlyPlayed", { size });
  return body.recentlyPlayed.song;
}

export async function getMostPlayed(size: number): Promise<Song[]> {
  const body = await call<{ mostPlayed: { song: Song[] } }>("getMostPlayed", { size });
  return body.mostPlayed.song;
}

export interface FolderListing {
  path: string;
  dirs: string[];
  songs: Song[];
}

export async function getFolder(path: string): Promise<FolderListing> {
  const body = await call<{ folder: { path: string; dir?: { name: string }[]; song?: Song[] } }>("getFolder", {
    path,
  });
  return {
    path: body.folder.path,
    dirs: (body.folder.dir ?? []).map((d) => d.name),
    songs: body.folder.song ?? [],
  };
}

// Same 19MB cap the Worker enforces (Telegram's getFile download limit) —
// checked here first just for fast feedback, the server check is authoritative.
export const MAX_UPLOAD_TRACK_BYTES = 19 * 1024 * 1024;

export interface UploadTrackMetadata {
  title: string;
  artist: string;
  album: string;
  year?: number;
  genre?: string;
  trackNumber?: number;
  discNumber?: number;
  duration?: number;
  bitrate?: number;
  folder?: string;
}

export async function uploadTrack(file: File, metadata: UploadTrackMetadata): Promise<Song> {
  const search = buildSearch(
    {
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album,
      year: metadata.year,
      genre: metadata.genre,
      trackNumber: metadata.trackNumber,
      discNumber: metadata.discNumber,
      duration: metadata.duration,
      bitrate: metadata.bitrate,
      folder: metadata.folder,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
    },
    getCredentials(),
  );
  const res = await fetch(`/rest/uploadTrack.view?${search.toString()}`, { method: "POST", body: file });
  // A non-2xx from in front of the Worker (e.g. an edge timeout/size limit)
  // won't be JSON at all — surface the raw status instead of letting
  // res.json() throw an opaque SyntaxError.
  let data: { "subsonic-response": any };
  try {
    data = (await res.json()) as { "subsonic-response": any };
  } catch {
    throw new SubsonicError(0, `Upload failed: HTTP ${res.status} ${res.statusText}`);
  }
  const body = data["subsonic-response"];
  if (body.status !== "ok") {
    throw new SubsonicError(body.error?.code ?? 0, body.error?.message ?? "Unknown error");
  }
  return body.song as Song;
}

export async function deleteTrack(id: string): Promise<void> {
  await call("deleteTrack", { id });
}

export async function renameFolder(path: string, name: string): Promise<void> {
  await call("renameFolder", { path, name });
}

export async function createFolder(parentPath: string, name: string): Promise<void> {
  await call("createFolder", { path: parentPath, name });
}

export async function deleteFolder(path: string): Promise<void> {
  await call("deleteFolder", { path });
}
