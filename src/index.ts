import type { Env } from "./types";
import { authenticate } from "./auth";
import { respond, subsonicError, subsonicSuccess } from "./subsonic/response";
import { node } from "./subsonic/node";
import { artistNode, albumNode, songNode } from "./subsonic/mappers";
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

      default:
        return respond(subsonicError(0, `Unsupported endpoint: ${endpoint}`), format);
    }
  },
} satisfies ExportedHandler<Env>;
