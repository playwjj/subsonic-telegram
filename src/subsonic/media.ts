import * as q from "../db/queries";
import type { StorageBackend } from "../storage/types";

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

export async function getCoverArt(
  db: D1Database,
  storage: StorageBackend,
  assets: Fetcher,
  id: string,
): Promise<Response> {
  const placeholder = () => assets.fetch(new Request("https://subsonic-telegram.invalid/music-cover.jpg"));
  const album = await q.getAlbum(db, id);
  // Album, track and artist ids are md5s of different natural keys, so one
  // id never matches more than one of these.
  const coverRef =
    album?.cover_ref ?? (await q.getTrack(db, id))?.cover_ref ?? (album ? null : await q.getArtistCoverRef(db, id));
  if (!coverRef) return placeholder();

  const response = await storage.getFileResponse(coverRef, null);
  return response.ok ? response : placeholder();
}
