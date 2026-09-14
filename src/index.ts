import type { Env } from "./types";
import { authenticate } from "./auth";
import { respond, subsonicError, subsonicSuccess } from "./subsonic/response";
import { node } from "./subsonic/node";
import { artistNode, albumNode, songNode, playlistNode, playlistEntryNode } from "./subsonic/mappers";
import * as browsing from "./subsonic/browsing";
import * as media from "./subsonic/media";
import * as q from "./db/queries";
import { TelegramStorage } from "./storage/telegram";
import { CachedStorage } from "./storage/cached";
import type { StorageBackend } from "./storage/types";

const ERR = {
  MISSING_PARAM: 10,
  NOT_FOUND: 70,
};

// Default cap for the optional R2 read-through cache when CACHE_BUCKET is
// bound but CACHE_MAX_BYTES isn't set. See "R2 read-through cache" in README.
const DEFAULT_CACHE_MAX_BYTES = 8 * 1024 * 1024 * 1024;

// Same ceiling scripts/import.ts enforces (its MAX_FILE_BYTES): a file that
// uploads fine past Telegram's 50MB sendDocument limit could still never be
// streamed back, since getFile caps downloads at ~20MB. So uploads from the
// web UI are held to this tighter limit, not the storage layer's looser one.
const MAX_UPLOAD_TRACK_BYTES = 19 * 1024 * 1024;

// Used for both uploadTrack's optional "folder" param (may have several
// segments) and renameFolder's "name" param (must be a single segment).
function sanitizeFolderPath(input: string): string {
  return input
    .split("/")
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0 && seg !== "." && seg !== "..")
    .join("/");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // wrangler.toml scopes run_worker_first to "/rest/*", so this fetch()
    // only ever runs for API requests — everything else (including "/") is
    // served straight from web/dist by Workers Static Assets, never reaching
    // here. (That also covers Subsonic clients like Amperfy that probe the
    // bare server URL before calling the API: they now get the SPA's 200.)
    if (!url.pathname.startsWith("/rest/")) {
      return new Response("Not found", { status: 404 });
    }
    let endpoint = url.pathname.slice("/rest/".length);
    if (endpoint.endsWith(".view")) endpoint = endpoint.slice(0, -".view".length);

    const params = url.searchParams;
    const format = params.get("f");

    const auth = await authenticate(env, params);
    if (!auth.ok) return respond(subsonicError(auth.code, auth.message), format);

    if (endpoint === "ping") {
      return respond(subsonicSuccess(), format);
    }
    if (endpoint === "getLicense") {
      return respond(subsonicSuccess(node("license", { valid: true })), format);
    }

    const telegram = new TelegramStorage(env.TG_BOT_TOKEN, env.TG_CHANNEL_ID);
    const storage: StorageBackend = env.CACHE_BUCKET
      ? new CachedStorage(
          telegram,
          env.CACHE_BUCKET,
          env.DB,
          env.CACHE_MAX_BYTES ? Number(env.CACHE_MAX_BYTES) : DEFAULT_CACHE_MAX_BYTES,
          ctx,
        )
      : telegram;

    switch (endpoint) {
      case "getMusicFolders":
        return respond(subsonicSuccess(browsing.getMusicFolders()), format);

      case "getIndexes":
        return respond(subsonicSuccess(await browsing.getIndexes(env.DB, auth.username)), format);

      case "getArtists":
        return respond(subsonicSuccess(await browsing.getArtists(env.DB, auth.username)), format);

      case "getGenres":
        return respond(subsonicSuccess(await browsing.getGenres(env.DB)), format);

      case "getArtist": {
        const id = params.get("id");
        if (!id) return respond(subsonicError(ERR.MISSING_PARAM, "Missing id"), format);
        const result = await browsing.getArtist(env.DB, auth.username, id);
        if (!result) return respond(subsonicError(ERR.NOT_FOUND, "Artist not found"), format);
        return respond(subsonicSuccess(result), format);
      }

      case "getAlbum": {
        const id = params.get("id");
        if (!id) return respond(subsonicError(ERR.MISSING_PARAM, "Missing id"), format);
        const result = await browsing.getAlbum(env.DB, auth.username, id);
        if (!result) return respond(subsonicError(ERR.NOT_FOUND, "Album not found"), format);
        return respond(subsonicSuccess(result), format);
      }

      case "getSong": {
        const id = params.get("id");
        if (!id) return respond(subsonicError(ERR.MISSING_PARAM, "Missing id"), format);
        const track = await q.getTrack(env.DB, id);
        if (!track) return respond(subsonicError(ERR.NOT_FOUND, "Song not found"), format);
        const starredAt = await q.getStarredAt(env.DB, auth.username, "track", id);
        return respond(subsonicSuccess(songNode(track, { starredAt })), format);
      }

      case "getAlbumList2": {
        const type = params.get("type") ?? "newest";
        const size = Math.min(Number(params.get("size") ?? 20), 500);
        const offset = Number(params.get("offset") ?? 0);
        return respond(subsonicSuccess(await browsing.getAlbumList2(env.DB, auth.username, type, size, offset)), format);
      }

      case "search3": {
        const query = params.get("query") ?? "";
        const artistCount = Number(params.get("artistCount") ?? 20);
        const albumCount = Number(params.get("albumCount") ?? 20);
        const songCount = Number(params.get("songCount") ?? 20);
        const [results, starred] = await Promise.all([
          q.search3(env.DB, query, artistCount, albumCount, songCount),
          q.getStarredIds(env.DB, auth.username),
        ]);
        return respond(
          subsonicSuccess(
            node("searchResult3", undefined, {
              lists: {
                artist: results.artists.map((a) => artistNode(a, { starredAt: starred.artists.get(a.id) })),
                album: results.albums.map((a) => albumNode(a, { starredAt: starred.albums.get(a.id) })),
                song: results.songs.map((t) => songNode(t, { starredAt: starred.tracks.get(t.id) })),
              },
            }),
          ),
          format,
        );
      }

      case "stream":
      case "download": {
        const id = params.get("id");
        if (!id) return respond(subsonicError(ERR.MISSING_PARAM, "Missing id"), format);
        return media.streamTrack(env.DB, storage, id, request.headers.get("Range"));
      }

      case "getCoverArt": {
        const id = params.get("id");
        if (!id) return respond(subsonicError(ERR.MISSING_PARAM, "Missing id"), format);
        return media.getCoverArt(env.DB, storage, id);
      }

      case "getPlaylists": {
        const playlists = await q.listPlaylists(env.DB);
        return respond(
          subsonicSuccess(node("playlists", undefined, { lists: { playlist: playlists.map((p) => playlistNode(p)) } })),
          format,
        );
      }

      case "getPlaylist": {
        const id = params.get("id");
        if (!id) return respond(subsonicError(ERR.MISSING_PARAM, "Missing id"), format);
        const playlist = await q.getPlaylist(env.DB, id);
        if (!playlist) return respond(subsonicError(ERR.NOT_FOUND, "Playlist not found"), format);
        const [tracks, starred] = await Promise.all([
          q.listPlaylistTracks(env.DB, id),
          q.getStarredIds(env.DB, auth.username),
        ]);
        return respond(
          subsonicSuccess(
            playlistNode(playlist, {
              entries: tracks.map((t) => playlistEntryNode(t, { starredAt: starred.tracks.get(t.id) })),
            }),
          ),
          format,
        );
      }

      case "createPlaylist": {
        const playlistIdParam = params.get("playlistId");
        const name = params.get("name");
        const songIds = params.getAll("songId");
        let id: string;
        if (playlistIdParam) {
          const existing = await q.getPlaylist(env.DB, playlistIdParam);
          if (!existing) return respond(subsonicError(ERR.NOT_FOUND, "Playlist not found"), format);
          await q.replacePlaylistTracks(env.DB, playlistIdParam, songIds);
          if (name) await q.renamePlaylist(env.DB, playlistIdParam, name);
          id = playlistIdParam;
        } else {
          if (!name) return respond(subsonicError(ERR.MISSING_PARAM, "Missing name"), format);
          id = crypto.randomUUID();
          await q.createPlaylist(env.DB, id, name, auth.username, songIds);
        }
        const playlist = (await q.getPlaylist(env.DB, id))!;
        const [tracks, starred] = await Promise.all([
          q.listPlaylistTracks(env.DB, id),
          q.getStarredIds(env.DB, auth.username),
        ]);
        return respond(
          subsonicSuccess(
            playlistNode(playlist, {
              entries: tracks.map((t) => playlistEntryNode(t, { starredAt: starred.tracks.get(t.id) })),
            }),
          ),
          format,
        );
      }

      case "updatePlaylist": {
        const id = params.get("playlistId");
        if (!id) return respond(subsonicError(ERR.MISSING_PARAM, "Missing playlistId"), format);
        const existing = await q.getPlaylist(env.DB, id);
        if (!existing) return respond(subsonicError(ERR.NOT_FOUND, "Playlist not found"), format);

        const name = params.get("name");
        if (name) await q.renamePlaylist(env.DB, id, name);

        const removeIdx = params.getAll("songIndexToRemove").map(Number);
        if (removeIdx.length) await q.removeTracksFromPlaylistByIndex(env.DB, id, removeIdx);

        const addIds = params.getAll("songIdToAdd");
        if (addIds.length) await q.addTracksToPlaylist(env.DB, id, addIds);

        return respond(subsonicSuccess(), format);
      }

      case "deletePlaylist": {
        const id = params.get("id");
        if (!id) return respond(subsonicError(ERR.MISSING_PARAM, "Missing id"), format);
        await q.deletePlaylist(env.DB, id);
        return respond(subsonicSuccess(), format);
      }

      case "getRandomSongs": {
        const size = Math.min(Number(params.get("size") ?? 10), 500);
        const genre = params.get("genre") ?? undefined;
        const fromYearParam = params.get("fromYear");
        const toYearParam = params.get("toYear");
        const [tracks, starred] = await Promise.all([
          q.getRandomSongs(env.DB, {
            size,
            genre,
            fromYear: fromYearParam ? Number(fromYearParam) : undefined,
            toYear: toYearParam ? Number(toYearParam) : undefined,
          }),
          q.getStarredIds(env.DB, auth.username),
        ]);
        return respond(
          subsonicSuccess(
            node("randomSongs", undefined, {
              lists: { song: tracks.map((t) => songNode(t, { starredAt: starred.tracks.get(t.id) })) },
            }),
          ),
          format,
        );
      }

      case "scrobble": {
        const ids = params.getAll("id");
        if (!ids.length) return respond(subsonicError(ERR.MISSING_PARAM, "Missing id"), format);
        // Per spec, submission defaults to true; only a real ("submission")
        // scrobble updates play stats — a "now playing" notification
        // (submission=false) is a no-op here, we don't track that.
        const submission = params.get("submission");
        if (submission !== "false") {
          const times = params.getAll("time");
          for (let i = 0; i < ids.length; i++) {
            const timeMs = Number(times[i]);
            const playedAt = Number.isFinite(timeMs) && times[i] ? Math.floor(timeMs / 1000) : Math.floor(Date.now() / 1000);
            await q.scrobble(env.DB, ids[i], playedAt);
          }
        }
        return respond(subsonicSuccess(), format);
      }

      case "star":
      case "unstar": {
        const fn = endpoint === "star" ? q.starItem : q.unstarItem;
        for (const id of params.getAll("id")) await fn(env.DB, auth.username, "track", id);
        for (const id of params.getAll("albumId")) await fn(env.DB, auth.username, "album", id);
        for (const id of params.getAll("artistId")) await fn(env.DB, auth.username, "artist", id);
        return respond(subsonicSuccess(), format);
      }

      case "getStarred":
      case "getStarred2": {
        const tag = endpoint === "getStarred" ? "starred" : "starred2";
        const [artists, albums, tracks, starred] = await Promise.all([
          q.getStarredArtists(env.DB, auth.username),
          q.getStarredAlbums(env.DB, auth.username),
          q.getStarredTracks(env.DB, auth.username),
          q.getStarredIds(env.DB, auth.username),
        ]);
        return respond(
          subsonicSuccess(
            node(tag, undefined, {
              lists: {
                artist: artists.map((a) => artistNode(a, { starredAt: starred.artists.get(a.id) })),
                album: albums.map((a) => albumNode(a, { starredAt: starred.albums.get(a.id) })),
                song: tracks.map((t) => songNode(t, { starredAt: starred.tracks.get(t.id) })),
              },
            }),
          ),
          format,
        );
      }

      // The endpoints below aren't part of the official Subsonic API — they
      // exist for this project's own web UI (web/), which is a first-party
      // consumer of this same /rest/* surface. Third-party Subsonic clients
      // simply won't call endpoint names they don't know about.

      case "getLibraryStats": {
        const stats = await q.getLibraryStats(env.DB);
        return respond(
          subsonicSuccess(
            node("libraryStats", {
              artistCount: stats.artist_count,
              albumCount: stats.album_count,
              songCount: stats.song_count,
              totalDuration: stats.total_duration,
            }),
          ),
          format,
        );
      }

      case "getSongs": {
        const size = Math.min(Number(params.get("size") ?? 50), 500);
        const offset = Number(params.get("offset") ?? 0);
        const sort = params.get("sort") ?? "title";
        const [{ tracks, total }, starred] = await Promise.all([
          q.listAllTracks(env.DB, { limit: size, offset, sort }),
          q.getStarredIds(env.DB, auth.username),
        ]);
        return respond(
          subsonicSuccess(
            node("songs", { total }, { lists: { song: tracks.map((t) => songNode(t, { starredAt: starred.tracks.get(t.id) })) } }),
          ),
          format,
        );
      }

      case "getRecentlyPlayed":
      case "getMostPlayed": {
        const size = Math.min(Number(params.get("size") ?? 20), 500);
        const [tracks, starred] = await Promise.all([
          endpoint === "getRecentlyPlayed" ? q.getRecentlyPlayed(env.DB, size) : q.getMostPlayed(env.DB, size),
          q.getStarredIds(env.DB, auth.username),
        ]);
        const tag = endpoint === "getRecentlyPlayed" ? "recentlyPlayed" : "mostPlayed";
        return respond(
          subsonicSuccess(
            node(tag, undefined, { lists: { song: tracks.map((t) => songNode(t, { starredAt: starred.tracks.get(t.id) })) } }),
          ),
          format,
        );
      }

      case "getFolder": {
        const path = params.get("path") ?? "";
        const [rows, explicitFolders, starred] = await Promise.all([
          q.listTracksUnderPath(env.DB, path),
          q.listFoldersUnderPath(env.DB, path),
          q.getStarredIds(env.DB, auth.username),
        ]);
        const prefixLen = path ? path.length + 1 : 0;
        const dirs = new Set<string>();
        // A dir name lands here whenever something under it goes deeper than
        // just that one segment — a track anywhere inside it, or a nested
        // folder registration — meaning deleteFolder would refuse it. Used
        // so the client only offers deleting a folder that's actually empty.
        const nonEmptyDirs = new Set<string>();
        const tracks: typeof rows = [];
        for (const row of rows) {
          const rest = (row.source_path ?? "").slice(prefixLen);
          const slashIdx = rest.indexOf("/");
          if (slashIdx === -1) tracks.push(row);
          else {
            const name = rest.slice(0, slashIdx);
            dirs.add(name);
            nonEmptyDirs.add(name);
          }
        }
        // Merge in folders that were explicitly created empty (see
        // db/schema.sql) — same "just take the next path segment" logic,
        // just against folders.path instead of a track's source_path.
        for (const { path: folderPath } of explicitFolders) {
          const rest = folderPath.slice(prefixLen);
          const slashIdx = rest.indexOf("/");
          const name = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
          dirs.add(name);
          if (slashIdx !== -1) nonEmptyDirs.add(name);
        }
        return respond(
          subsonicSuccess(
            node(
              "folder",
              { path },
              {
                lists: {
                  dir: [...dirs]
                    .sort((a, b) => a.localeCompare(b))
                    .map((name) => node("dir", { name, empty: !nonEmptyDirs.has(name) })),
                  song: tracks.map((t) => songNode(t, { starredAt: starred.tracks.get(t.id) })),
                },
              },
            ),
          ),
          format,
        );
      }

      case "uploadTrack": {
        const title = params.get("title");
        const artistName = params.get("artist");
        const albumName = params.get("album");
        const filename = params.get("filename");
        const contentType = params.get("contentType");
        if (!title || !artistName || !albumName || !filename || !contentType) {
          return respond(
            subsonicError(ERR.MISSING_PARAM, "Missing title/artist/album/filename/contentType"),
            format,
          );
        }

        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.byteLength === 0) return respond(subsonicError(0, "Empty file"), format);
        if (bytes.byteLength > MAX_UPLOAD_TRACK_BYTES) {
          return respond(
            subsonicError(0, `File exceeds ${MAX_UPLOAD_TRACK_BYTES} byte limit (Telegram getFile download cap)`),
            format,
          );
        }

        const year = params.get("year") ? Number(params.get("year")) : null;
        const genre = params.get("genre") || null;
        const trackNo = params.get("trackNumber") ? Number(params.get("trackNumber")) : null;
        const discNo = params.get("discNumber") ? Number(params.get("discNumber")) : null;
        const duration = params.get("duration") ? Math.round(Number(params.get("duration"))) : null;
        const bitrate = params.get("bitrate") ? Math.round(Number(params.get("bitrate"))) : null;
        const folder = sanitizeFolderPath(params.get("folder") ?? "");
        const sourcePath = folder ? `${folder}/${filename}` : null;
        const suffix = filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase() : "";

        // Without this, a thrown error here (most likely storage.putFile
        // hitting Telegram) would propagate as an uncaught exception —
        // Workers then returns a plain-text/HTML 500, which isn't valid
        // JSON, so the client can't show the real reason and just reports a
        // generic "Upload failed".
        try {
          const artistId = await q.ensureArtist(env.DB, artistName);
          const albumId = await q.ensureAlbum(env.DB, albumName, artistId, year, genre);
          const fileRef = await storage.putFile(bytes, filename, contentType);
          const trackId = await q.insertTrack(env.DB, {
            albumId,
            artistId,
            title,
            trackNo,
            discNo,
            duration,
            suffix,
            contentType,
            size: bytes.byteLength,
            bitrate,
            fileRef,
            sourcePath,
            filename,
          });
          const track = await q.getTrack(env.DB, trackId);
          return respond(subsonicSuccess(songNode(track!)), format);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return respond(subsonicError(0, `Upload failed: ${message}`), format);
        }
      }

      case "deleteTrack": {
        const id = params.get("id");
        if (!id) return respond(subsonicError(ERR.MISSING_PARAM, "Missing id"), format);
        const result = await q.deleteTrackCascade(env.DB, id);
        if (!result) return respond(subsonicError(ERR.NOT_FOUND, "Song not found"), format);
        try {
          await storage.deleteFile(result.fileRef);
        } catch (err) {
          console.warn(`Failed to delete Telegram message for track ${id}: ${err}`);
        }
        return respond(subsonicSuccess(), format);
      }

      case "createFolder": {
        const parentPath = params.get("path") ?? "";
        const name = params.get("name");
        if (!name) return respond(subsonicError(ERR.MISSING_PARAM, "Missing name"), format);
        if (name.includes("/") || name === "." || name === "..") {
          return respond(subsonicError(0, "Invalid folder name"), format);
        }
        const fullPath = parentPath ? `${parentPath}/${name}` : name;
        await q.createFolder(env.DB, fullPath);
        return respond(subsonicSuccess(node("folder", { path: fullPath })), format);
      }

      case "deleteFolder": {
        const path = params.get("path");
        if (!path) return respond(subsonicError(ERR.MISSING_PARAM, "Missing path"), format);
        const result = await q.deleteFolder(env.DB, path);
        if (result === "not_found") return respond(subsonicError(ERR.NOT_FOUND, "Folder not found"), format);
        if (result === "not_empty") return respond(subsonicError(0, "Folder is not empty"), format);
        return respond(subsonicSuccess(), format);
      }

      case "renameFolder": {
        const path = params.get("path");
        const name = params.get("name");
        if (!path || !name) return respond(subsonicError(ERR.MISSING_PARAM, "Missing path or name"), format);
        if (name.includes("/") || name === "." || name === "..") {
          return respond(subsonicError(0, "Invalid folder name"), format);
        }
        const parentPrefix = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        const newPath = parentPrefix ? `${parentPrefix}/${name}` : name;
        const count = await q.renameFolder(env.DB, path, newPath);
        if (count === 0) return respond(subsonicError(ERR.NOT_FOUND, "Folder not found"), format);
        return respond(subsonicSuccess(node("folder", { path: newPath })), format);
      }

      default:
        return respond(subsonicError(0, `Unsupported endpoint: ${endpoint}`), format);
    }
  },
} satisfies ExportedHandler<Env>;
