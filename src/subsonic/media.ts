import * as q from "../db/queries";
import type { StorageBackend } from "../storage/types";

export async function streamTrack(
  db: D1Database,
  storage: StorageBackend,
  id: string,
  rangeHeader: string | null,
): Promise<Response> {
  const track = await q.getTrack(db, id);
  if (!track) return new Response("Not found", { status: 404 });
  return storage.getFileResponse(track.file_ref, rangeHeader, track.content_type);
}

export async function getCoverArt(
  db: D1Database,
  storage: StorageBackend,
  assets: Fetcher,
  id: string,
): Promise<Response> {
  const placeholder = () => assets.fetch(new Request("https://subsonic-telegram.invalid/music-cover.jpg"));
  const album = await q.getAlbum(db, id);
  const coverRef = album?.cover_ref ?? (await q.getTrack(db, id))?.cover_ref;
  if (!coverRef) return placeholder();

  const response = await storage.getFileResponse(coverRef, null);
  return response.ok ? response : placeholder();
}
