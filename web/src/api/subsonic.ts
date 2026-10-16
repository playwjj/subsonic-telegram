// Thin client for this project's Subsonic REST API. Every call attaches the
// credentials stored by stores/auth.ts as query params — same model any
// Subsonic client uses, just from a browser instead of a native app.
import { reactive } from "vue";
import { credentialsFor, getCredentials, setCredentials, type Credentials } from "../stores/auth";

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

function buildSearch(params: Params, creds: Credentials): URLSearchParams {
  const search = new URLSearchParams();
  search.set("u", creds.username);
  search.set("t", creds.token);
  search.set("s", creds.salt);
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

function buildUrl(endpoint: string, params: Params = {}, creds?: Credentials): string {
  const search = buildSearch(params, creds ?? getCredentials());
  return `/rest/${endpoint}.view?${search.toString()}`;
}

async function parseResponse<T>(res: Response): Promise<T> {
  const data = (await res.json()) as { "subsonic-response": any };
  const body = data["subsonic-response"];
  if (body.status !== "ok") {
    throw new SubsonicError(body.error?.code ?? 0, body.error?.message ?? "Unknown error");
  }
  return body as T;
}

async function call<T>(
  endpoint: string,
  params?: Params,
  creds?: Credentials,
): Promise<T> {
  return parseResponse<T>(await fetch(buildUrl(endpoint, params, creds)));
}

// Same as call(), but with the params sent as a form body (the Worker's
// "formPost" support) — for multi-select actions whose id lists wouldn't
// fit in a URL.
async function callPost<T>(endpoint: string, params: Params): Promise<T> {
  const res = await fetch(`/rest/${endpoint}.view`, {
    method: "POST",
    body: buildSearch(params, getCredentials()),
  });
  return parseResponse<T>(res);
}

export function streamUrl(id: string): string {
  return buildUrl("stream", { id });
}

// Saves under the track's real file name (the Worker sets
// Content-Disposition on `download`, unlike `stream`).
export function downloadUrl(id: string): string {
  return buildUrl("download", { id });
}

// Bumped per id when its cover changes (setCoverArt), so every <img> showing
// it reloads instead of keeping the image it already has for that URL.
const coverVersions = reactive<Record<string, number>>({});

export function coverArtUrl(id: string): string {
  return buildUrl("getCoverArt", { id, v: coverVersions[id] });
}

export async function login(username: string, password: string): Promise<void> {
  const creds = credentialsFor(username, password);
  await call("ping", {}, creds);
  setCredentials(creds);
}

// --- entity shapes, matching src/subsonic/mappers.ts on the Worker side ---

export interface Artist {
  id: string;
  name: string;
  albumCount: number;
  coverArt?: string;
  starred?: string;
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
  starred?: string;
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
  starred?: string;
  userRating?: number;
  // Folder path + file name (tracks.source_path); absent for a song that
  // was uploaded without a folder.
  path?: string;
  created?: string;
  playCount?: number;
  played?: string;
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

// Uniformly random sample (up to 500) of the whole library, one artist, or a
// folder including its subfolders — this project's own endpoint, for the
// web UI's "Shuffle" buttons.
export async function getShuffleSongs(scope: { artistId?: string; path?: string } = {}): Promise<Song[]> {
  const body = await call<{ shuffleSongs: { song?: Song[] } }>("getShuffleSongs", scope);
  return body.shuffleSongs.song ?? [];
}

export async function getRecentlyPlayed(size: number): Promise<Song[]> {
  const body = await call<{ recentlyPlayed: { song: Song[] } }>("getRecentlyPlayed", { size });
  return body.recentlyPlayed.song;
}

export async function getMostPlayed(size: number): Promise<Song[]> {
  const body = await call<{ mostPlayed: { song: Song[] } }>("getMostPlayed", { size });
  return body.mostPlayed.song;
}

export async function scrobble(id: string): Promise<void> {
  await call("scrobble", { id });
}

export interface PlayQueue {
  entry: Song[];
  current?: string;
  position?: number;
}

export async function getPlayQueue(): Promise<PlayQueue> {
  const body = await call<{ playQueue: Partial<PlayQueue> }>("getPlayQueue");
  return { ...body.playQueue, entry: body.playQueue.entry ?? [] };
}

export async function savePlayQueue(ids: string[], current: string | undefined, positionMs: number): Promise<void> {
  await call("savePlayQueue", { id: ids, current, position: positionMs });
}

export interface Starred {
  artist: Artist[];
  album: Album[];
  song: Song[];
}

export async function getStarred2(): Promise<Starred> {
  const body = await call<{ starred2: Partial<Starred> }>("getStarred2");
  return { artist: body.starred2.artist ?? [], album: body.starred2.album ?? [], song: body.starred2.song ?? [] };
}

export async function star(songId: string): Promise<void> {
  await call("star", { id: songId });
}

export async function unstar(songId: string): Promise<void> {
  await call("unstar", { id: songId });
}

export async function setRating(songId: string, rating: number): Promise<void> {
  await call("setRating", { id: songId, rating });
}

export interface StructuredLyrics {
  synced: boolean;
  // `start` is in milliseconds, present on synced lyrics only.
  line: { start?: number; value?: string }[];
}

// OpenSubsonic's getLyricsBySongId — unlike getLyrics it keeps per-line
// timing, which the full-screen player uses for scrolling lyrics.
export async function getLyricsBySongId(id: string): Promise<StructuredLyrics | null> {
  const body = await call<{ lyricsList: { structuredLyrics?: StructuredLyrics[] } }>("getLyricsBySongId", { id });
  return body.lyricsList.structuredLyrics?.[0] ?? null;
}

export interface FolderStats {
  songCount: number;
  size: number;
  duration: number;
}

export interface FolderDir extends FolderStats {
  name: string;
  // Nothing under it at all (no tracks, no nested folder).
  empty: boolean;
}

export interface FolderListing {
  path: string;
  dirs: FolderDir[];
  songs: Song[];
}

export async function getFolder(path: string): Promise<FolderListing> {
  const body = await call<{ folder: { path: string; dir?: FolderDir[]; song?: Song[] } }>("getFolder", {
    path,
  });
  return {
    path: body.folder.path,
    dirs: body.folder.dir ?? [],
    songs: body.folder.song ?? [],
  };
}

export interface TreeFolder extends FolderStats {
  path: string;
}

export async function getFolderTree(): Promise<{ root: FolderStats; folders: TreeFolder[] }> {
  const body = await call<{ folderTree: FolderStats & { folder?: TreeFolder[] } }>("getFolderTree");
  const { folder, ...root } = body.folderTree;
  return { root, folders: folder ?? [] };
}

// Everything under `path` (subfolders included, max 500) in path order, or
// only the songs matching `query`.
export async function getFolderSongs(path: string, query?: string): Promise<Song[]> {
  const body = await call<{ folderSongs: { song?: Song[] } }>("getFolderSongs", { path, query, size: 500 });
  return body.folderSongs.song ?? [];
}

export type ConflictPolicy = "ask" | "rename" | "skip";

export interface MoveResult {
  moved: number;
  skipped: number;
  // Names already taken in the destination. With "ask", nothing was moved
  // if this is non-empty.
  conflicts: string[];
}

export async function moveItems(opts: {
  songIds: string[];
  folderPaths: string[];
  dest: string;
  onConflict: ConflictPolicy;
}): Promise<MoveResult> {
  const body = await callPost<{ moveResult: { moved: number; skipped: number; conflict?: { name: string }[] } }>(
    "moveItems",
    { id: opts.songIds, path: opts.folderPaths, dest: opts.dest, onConflict: opts.onConflict },
  );
  const r = body.moveResult;
  return { moved: r.moved, skipped: r.skipped, conflicts: (r.conflict ?? []).map((c) => c.name) };
}

// Songs and whole folders (recursively). Goes to the trash — the returned
// entry ids can be passed to restoreTrash to undo — unless `permanent`,
// which deletes right away, Telegram files included.
export async function deleteItems(opts: {
  songIds: string[];
  folderPaths: string[];
  permanent?: boolean;
}): Promise<{ deleted: number; entryIds: string[] }> {
  const body = await callPost<{ deleteResult: { deleted: number; entry?: { id: string }[] } }>("deleteItems", {
    id: opts.songIds,
    path: opts.folderPaths,
    permanent: opts.permanent ? "true" : undefined,
  });
  return { deleted: body.deleteResult.deleted, entryIds: (body.deleteResult.entry ?? []).map((e) => e.id) };
}

export interface TrashEntry {
  id: string;
  kind: "folder" | "track";
  name: string;
  // Original folder path / file path; absent for a song that wasn't in a folder.
  path?: string;
  songCount: number;
  size: number;
  deleted: string;
  expires: string;
}

export interface TrashListing {
  entries: TrashEntry[];
  retentionDays: number;
  // Telegram files whose deletion failed and is being retried daily.
  pendingDeletes: number;
}

export async function getTrash(): Promise<TrashListing> {
  const body = await call<{ trash: { retentionDays: number; pendingDeletes: number; entry?: TrashEntry[] } }>("getTrash");
  return { entries: body.trash.entry ?? [], retentionDays: body.trash.retentionDays, pendingDeletes: body.trash.pendingDeletes };
}

export interface RestoreResult {
  restored: number;
  renamed: number;
  skipped: number;
}

export async function restoreTrash(ids: string[]): Promise<RestoreResult> {
  const body = await callPost<{ restoreResult: RestoreResult }>("restoreTrash", { id: ids });
  return body.restoreResult;
}

// Deletes trash entries for good (or everything, with "all"). The Worker
// does big purges in chunks, so this keeps calling until it's all done.
export async function purgeTrash(ids: string[] | "all"): Promise<number> {
  let purged = 0;
  for (;;) {
    const body = await callPost<{ purgeResult: { purged: number; remaining: number } }>(
      "purgeTrash",
      ids === "all" ? { all: "true" } : { id: ids },
    );
    purged += body.purgeResult.purged;
    if (!body.purgeResult.remaining || !body.purgeResult.purged) return purged;
  }
}

// Renames the file (last segment of the song's path), not its title tag.
export async function renameTrackFile(id: string, name: string): Promise<Song> {
  const body = await callPost<{ song: Song }>("renameTrackFile", { id, name });
  return body.song;
}

export interface TrackStorage {
  messageId: number;
  link?: string;
  // Undefined when the R2 cache isn't enabled at all.
  cached?: boolean;
}

export async function getTrackStorage(id: string): Promise<TrackStorage> {
  const body = await call<{ trackStorage: TrackStorage }>("getTrackStorage", { id });
  return body.trackStorage;
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
  // Same file name already in `folder`: "rename" (default) stores this one
  // as "name (1).ext", "skip" fails with UploadError.exists.
  onConflict?: "rename" | "skip";
}

// An uploadTrack failure, with what the batch uploader needs to react:
// Telegram's rate limit (wait retryAfter seconds, then retry), or the file
// already existing (counts as skipped, not failed).
export class UploadError extends SubsonicError {
  retryAfter?: number;
  exists: boolean;
  constructor(message: string, retryAfter?: number, exists = false) {
    super(0, message);
    this.retryAfter = retryAfter;
    this.exists = exists;
  }
}

// XHR rather than fetch, for upload progress. `progress` gets the fraction
// of the file sent to the Worker (0..1); after 1 the Worker is still
// passing it on to Telegram. abort() on the returned handle cancels.
export function uploadTrack(
  file: File,
  metadata: UploadTrackMetadata,
  progress?: (fraction: number) => void,
): { done: Promise<Song>; abort: () => void } {
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
      onConflict: metadata.onConflict,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
    },
    getCredentials(),
  );
  const xhr = new XMLHttpRequest();
  const done = new Promise<Song>((resolve, reject) => {
    xhr.open("POST", `/rest/uploadTrack.view?${search.toString()}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && progress?.(e.loaded / e.total);
    xhr.onerror = () => reject(new UploadError("Network error — check your connection"));
    xhr.onabort = () => reject(new UploadError("Cancelled"));
    xhr.onload = () => {
      // A non-2xx from in front of the Worker (e.g. an edge timeout/size
      // limit) won't be JSON at all — surface the raw status instead.
      let body: any;
      try {
        body = JSON.parse(xhr.responseText)["subsonic-response"];
      } catch {
        return reject(new UploadError(`Upload failed: HTTP ${xhr.status} ${xhr.statusText}`));
      }
      if (body.status === "ok") return resolve(body.song as Song);
      const err = body.error ?? {};
      reject(new UploadError(err.message ?? "Upload failed", err.retryAfter, !!err.exists));
    };
    xhr.send(file);
  });
  return { done, abort: () => xhr.abort() };
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

// --- tags, covers, duplicates (src/subsonic/metadata.ts) ---

// Only the fields present are changed. null clears year/genre/track/disc.
// Year and genre belong to the album, so they change for its other songs too.
export interface TagEdits {
  title?: string;
  artist?: string;
  album?: string;
  year?: number | null;
  genre?: string | null;
  track?: number | null;
  disc?: number | null;
}

// Songs by id, and/or everything under folders. Returns how many songs
// changed and the album(s) they're in now.
export async function updateTracks(
  target: { songIds?: string[]; folderPaths?: string[] },
  edits: TagEdits,
): Promise<{ updated: number; albumIds: string[] }> {
  const params: Params = { id: target.songIds, path: target.folderPaths };
  for (const [key, value] of Object.entries(edits)) {
    if (value !== undefined) params[key] = value === null ? "" : value;
  }
  const body = await callPost<{ updateResult: { updated: number; album?: { id: string }[] } }>("updateTracks", params);
  return { updated: body.updateResult.updated, albumIds: (body.updateResult.album ?? []).map((a) => a.id) };
}

// An album's cover or an artist's photo: a new image, or null to remove it.
export async function setCoverArt(id: string, image: Blob | null): Promise<void> {
  const search = buildSearch({ id, remove: image ? undefined : "true" }, getCredentials());
  const res = await fetch(`/rest/setCoverArt.view?${search.toString()}`, {
    method: "POST",
    headers: image ? { "Content-Type": image.type } : undefined,
    body: image ?? undefined,
  });
  await parseResponse(res);
  coverVersions[id] = (coverVersions[id] ?? 0) + 1;
}

export type DuplicateMode = "tags" | "size";

export async function getDuplicates(mode: DuplicateMode): Promise<Song[][]> {
  const body = await call<{ duplicates: { group?: { song: Song[] }[] } }>("getDuplicates", { mode });
  return (body.duplicates.group ?? []).map((g) => g.song);
}

// --- storage page (src/subsonic/storage.ts, captions.ts) ---

export interface StorageBucket {
  name: string;
  songCount: number;
  size: number;
}

export interface CaptionStatus {
  queued: number;
  failed: number;
  lastError?: string;
}

export interface StorageStats {
  songCount: number;
  size: number;
  duration: number;
  pendingDeletes: number;
  folders: StorageBucket[];
  formats: StorageBucket[];
  months: StorageBucket[];
  covers: { albums: number; albumsWithCover: number; artistsWithPhoto: number; songCovers: number };
  trash: { entries: number; songCount: number; size: number };
  cache: { enabled: boolean; size: number; entries: number; maxBytes: number };
  captions: CaptionStatus;
  largest: Song[];
}

export async function getStorageStats(): Promise<StorageStats> {
  const body = await call<{ storageStats: any }>("getStorageStats");
  const s = body.storageStats;
  return {
    ...s,
    folders: s.folder ?? [],
    formats: s.format ?? [],
    months: s.month ?? [],
    largest: s.largest ?? [],
  };
}

// all: queue a caption update for every song; clearFailed: forget the ones
// that gave up.
export async function queueCaptions(opts: { all?: boolean; clearFailed?: boolean }): Promise<CaptionStatus> {
  const body = await callPost<{ captions: CaptionStatus }>("queueCaptions", {
    all: opts.all ? "true" : undefined,
    clearFailed: opts.clearFailed ? "true" : undefined,
  });
  return body.captions;
}

export interface FileProblem {
  kind: "song" | "album" | "artist" | "songCover";
  id: string;
  name: string;
  path?: string;
  error: string;
}

export interface FileCheckBatch {
  checked: number;
  total: number;
  next?: string;
  problems: FileProblem[];
}

// One batch of the integrity check. Throws UploadError with retryAfter when
// Telegram asks to slow down (same shape as uploads).
export async function checkFiles(kind: "songs" | "covers", after: string): Promise<FileCheckBatch> {
  const res = await fetch(buildUrl("checkFiles", { kind, after }));
  const body = ((await res.json()) as { "subsonic-response": any })["subsonic-response"];
  if (body.status !== "ok") {
    const err = body.error ?? {};
    throw new UploadError(err.message ?? "Check failed", err.retryAfter);
  }
  const r = body.fileCheck;
  return { checked: r.checked, total: r.total, next: r.next, problems: r.problem ?? [] };
}
