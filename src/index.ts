import type { Env } from "./types";
import { authenticate } from "./auth";
import { respond, subsonicError, subsonicSuccess } from "./subsonic/response";
import { node } from "./subsonic/node";
import { artistNode, albumNode, songNode, playlistNode, playlistEntryNode } from "./subsonic/mappers";
import * as browsing from "./subsonic/browsing";
import * as media from "./subsonic/media";
import * as q from "./db/queries";
import { TelegramStorage } from "./storage/telegram";

const ERR = {
  MISSING_PARAM: 10,
  NOT_FOUND: 70,
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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

    const auth = await authenticate(env.DB, params);
    if (!auth.ok) return respond(subsonicError(auth.code, auth.message), format);

    if (endpoint === "ping") {
      return respond(subsonicSuccess(), format);
    }
    if (endpoint === "getLicense") {
      return respond(subsonicSuccess(node("license", { valid: true })), format);
    }

    const storage = new TelegramStorage(env.TG_BOT_TOKEN, env.TG_CHANNEL_ID);

    switch (endpoint) {
      case "getMusicFolders":
        return respond(subsonicSuccess(browsing.getMusicFolders()), format);

      case "getIndexes":
        return respond(subsonicSuccess(await browsing.getIndexes(env.DB)), format);

      case "getArtists":
        return respond(subsonicSuccess(await browsing.getArtists(env.DB)), format);

      case "getGenres":
        return respond(subsonicSuccess(await browsing.getGenres(env.DB)), format);

      case "getArtist": {
        const id = params.get("id");
        if (!id) return respond(subsonicError(ERR.MISSING_PARAM, "Missing id"), format);
        const result = await browsing.getArtist(env.DB, id);
        if (!result) return respond(subsonicError(ERR.NOT_FOUND, "Artist not found"), format);
        return respond(subsonicSuccess(result), format);
      }

      case "getAlbum": {
        const id = params.get("id");
        if (!id) return respond(subsonicError(ERR.MISSING_PARAM, "Missing id"), format);
        const result = await browsing.getAlbum(env.DB, id);
        if (!result) return respond(subsonicError(ERR.NOT_FOUND, "Album not found"), format);
        return respond(subsonicSuccess(result), format);
      }

      case "getSong": {
        const id = params.get("id");
        if (!id) return respond(subsonicError(ERR.MISSING_PARAM, "Missing id"), format);
        const track = await q.getTrack(env.DB, id);
        if (!track) return respond(subsonicError(ERR.NOT_FOUND, "Song not found"), format);
        return respond(subsonicSuccess(songNode(track)), format);
      }

      case "getAlbumList2": {
        const type = params.get("type") ?? "newest";
        const size = Math.min(Number(params.get("size") ?? 20), 500);
        const offset = Number(params.get("offset") ?? 0);
        return respond(subsonicSuccess(await browsing.getAlbumList2(env.DB, type, size, offset)), format);
      }

      case "search3": {
        const query = params.get("query") ?? "";
        const artistCount = Number(params.get("artistCount") ?? 20);
        const albumCount = Number(params.get("albumCount") ?? 20);
        const songCount = Number(params.get("songCount") ?? 20);
        const results = await q.search3(env.DB, query, artistCount, albumCount, songCount);
        return respond(
          subsonicSuccess(
            node("searchResult3", undefined, {
              lists: {
                artist: results.artists.map(artistNode),
                album: results.albums.map((a) => albumNode(a)),
                song: results.songs.map(songNode),
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
        const tracks = await q.listPlaylistTracks(env.DB, id);
        return respond(subsonicSuccess(playlistNode(playlist, { entries: tracks.map(playlistEntryNode) })), format);
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
        const tracks = await q.listPlaylistTracks(env.DB, id);
        return respond(subsonicSuccess(playlistNode(playlist, { entries: tracks.map(playlistEntryNode) })), format);
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
        const tracks = await q.getRandomSongs(env.DB, {
          size,
          genre,
          fromYear: fromYearParam ? Number(fromYearParam) : undefined,
          toYear: toYearParam ? Number(toYearParam) : undefined,
        });
        return respond(subsonicSuccess(node("randomSongs", undefined, { lists: { song: tracks.map(songNode) } })), format);
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
        const [artists, albums, tracks] = await Promise.all([
          q.getStarredArtists(env.DB, auth.username),
          q.getStarredAlbums(env.DB, auth.username),
          q.getStarredTracks(env.DB, auth.username),
        ]);
        return respond(
          subsonicSuccess(
            node(tag, undefined, {
              lists: {
                artist: artists.map((a) => artistNode(a)),
                album: albums.map((a) => albumNode(a)),
                song: tracks.map(songNode),
              },
            }),
          ),
          format,
        );
      }

      default:
        return respond(subsonicError(0, `Unsupported endpoint: ${endpoint}`), format);
    }
  },
} satisfies ExportedHandler<Env>;
