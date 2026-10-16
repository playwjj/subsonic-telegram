import * as q from "../db/queries";
import type { StorageBackend } from "../storage/types";
import { cacheKey } from "../storage/cached";

export async function streamTrack(
  db: D1Database,
  storage: StorageBackend,
  id: string,
  rangeHeader: string | null,
  asAttachment = false,
): Promise<Response> {
  const track = await q.getTrack(db, id);
  if (!track) return new Response("Not found", { status: 404 });
  const response = await storage.getFileResponse(track.file_ref, rangeHeader, track.content_type);
  if (!asAttachment || !response.ok) return response;
  // `download` saves under the track's real file name instead of the
  // browser's guess ("download.view"). filename* (RFC 6266/5987) carries
  // non-ASCII names; the plain filename is an ASCII fallback.
  const name = track.source_path?.slice(track.source_path.lastIndexOf("/") + 1) ?? `${track.title}.${track.suffix}`;
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const withName = new Response(response.body, response);
  withName.headers.set(
    "Content-Disposition",
    `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`,
  );
  return withName;
}

// Covers rarely change, and every fetch of one means a round trip to
// Telegram (or R2): let clients keep them a day, then keep showing the old
// copy while they revalidate in the background for up to a month — a
// revalidation of an unchanged cover is a 304 off one D1 lookup, using the
// cover's file ref as the ETag. "private": the URL carries the user's auth.
const COVER_CACHE = "private, max-age=86400, stale-while-revalidate=2592000";
// The placeholder (no cover yet, or Telegram failing) only briefly, so a
// cover added meanwhile shows up soon.
const PLACEHOLDER_CACHE = "private, max-age=300";

function withHeaders(response: Response, headers: Record<string, string>): Response {
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

export async function getCoverArt(
  db: D1Database,
  storage: StorageBackend,
  assets: Fetcher,
  id: string,
  ifNoneMatch: string | null,
): Promise<Response> {
  const placeholder = async () =>
    withHeaders(await assets.fetch(new Request("https://subsonic-telegram.invalid/music-cover.jpg")), {
      "Cache-Control": PLACEHOLDER_CACHE,
    });
  const album = await q.getAlbum(db, id);
  // Album, track and artist ids are md5s of different natural keys, so one
  // id never matches more than one of these.
  const coverRef =
    album?.cover_ref ?? (await q.getTrack(db, id))?.cover_ref ?? (album ? null : await q.getArtistCoverRef(db, id));
  if (!coverRef) return placeholder();

  const etag = `"${(await cacheKey(coverRef)).slice(0, 24)}"`;
  if (ifNoneMatch && ifNoneMatch.split(",").some((tag) => tag.trim().replace(/^W\//, "") === etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": COVER_CACHE } });
  }
  const response = await storage.getFileResponse(coverRef, null);
  if (!response.ok) return placeholder();
  return withHeaders(response, { ETag: etag, "Cache-Control": COVER_CACHE });
}
