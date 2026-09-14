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

export async function getCoverArt(db: D1Database, storage: StorageBackend, id: string): Promise<Response> {
  const album = await q.getAlbum(db, id);
  if (album) {
    if (!album.cover_ref) return new Response("Not found", { status: 404 });
    return storage.getFileResponse(album.cover_ref, null);
  }
  // Not an album id -- id spaces are disjoint (see scripts/import.ts's md5()
  // calls), so this can only be a track with its own song-specific cover
  // (see songNode in mappers.ts).
  const track = await q.getTrack(db, id);
  if (!track?.cover_ref) return new Response("Not found", { status: 404 });
  return storage.getFileResponse(track.cover_ref, null);
}
