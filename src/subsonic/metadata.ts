// Tag editing, cover art replacement and duplicate finding for the web UI.
// Tags here are the library's own metadata in D1 — the audio files in
// Telegram are never rewritten.
import { md5Hex } from "../md5";
import * as q from "../db/queries";
import type { StorageBackend } from "../storage/types";
import { deleteFilesOrQueue } from "./folders";

export class MetadataError extends Error {}

// A field left undefined is kept as is. null clears it (year, genre, track,
// disc). Year and genre live on the album, so they change for every song
// of the album(s) the edited songs end up in.
export interface TagEdits {
  title?: string;
  artist?: string;
  album?: string;
  year?: number | null;
  genre?: string | null;
  track?: number | null;
  disc?: number | null;
}

interface EditRow {
  id: string;
  album_id: string;
  artist_id: string;
  album_name: string;
  album_artist_id: string;
  album_artist_name: string;
}

// Same natural-key ids as ensureArtist/ensureAlbum (and scripts/import.ts),
// so an edited song lands in the very album an upload of the same name would.
const artistIdFor = (name: string) => md5Hex(`artist:${name.toLowerCase()}`);
const albumIdFor = (artistId: string, name: string) => md5Hex(`album:${artistId}:${name.toLowerCase()}`);
const sortName = (name: string) => name.replace(/^(the|a|an)\s+/i, "");

async function rowsFor(db: D1Database, ids: string[], paths: string[]): Promise<EditRow[]> {
  const select = `SELECT t.id, t.album_id, t.artist_id, al.name as album_name, al.artist_id as album_artist_id,
                         ar.name as album_artist_name
                  FROM tracks t JOIN albums al ON al.id = t.album_id JOIN artists ar ON ar.id = al.artist_id`;
  const byId = new Map<string, EditRow>();
  if (ids.length) {
    const { results } = await db
      .prepare(`${select} WHERE t.id IN (SELECT value FROM json_each(?))`)
      .bind(JSON.stringify(ids))
      .all<EditRow>();
    for (const r of results) byId.set(r.id, r);
  }
  for (const path of paths) {
    if (!path) throw new MetadataError("Can't edit the whole library at once");
    const under = q.underPrefix("t.source_path", path);
    const { results } = await db
      .prepare(`${select} WHERE ${under.sql}`)
      .bind(...under.binds)
      .all<EditRow>();
    for (const r of results) byId.set(r.id, r);
  }
  return [...byId.values()];
}

// Edits songs (by id, and/or everything under folder paths) in one batch.
// Song ids never change, so stars, ratings, playlists, play counts and the
// play queue all follow along. Changing artist/album moves the songs to the
// album with that name (creating it, with the old album's year/genre/cover,
// if needed); albums and artists left empty are removed, their stars moved
// to where the songs went.
export async function updateTracks(
  db: D1Database,
  ids: string[],
  paths: string[],
  edits: TagEdits,
): Promise<{ updated: number; albumIds: string[] }> {
  const rows = await rowsFor(db, ids, paths);
  if (!rows.length) return { updated: 0, albumIds: [] };

  const rekey = edits.artist !== undefined || edits.album !== undefined;
  const newArtistId = edits.artist !== undefined ? artistIdFor(edits.artist) : null;

  // Old album -> where its (edited) songs go.
  const albumMap = new Map<string, { id: string; name: string; artistId: string }>();
  for (const r of rows) {
    if (albumMap.has(r.album_id)) continue;
    if (!rekey) {
      albumMap.set(r.album_id, { id: r.album_id, name: r.album_name, artistId: r.album_artist_id });
      continue;
    }
    const artistId = newArtistId ?? r.album_artist_id;
    const name = edits.album ?? r.album_name;
    albumMap.set(r.album_id, { id: albumIdFor(artistId, name), name, artistId });
  }
  const mapping = [...albumMap].map(([old, to]) => ({ old, ...to }));
  const mappingJson = JSON.stringify(mapping);
  const targetIds = JSON.stringify([...new Set(mapping.map((m) => m.id))]);
  const trackIds = JSON.stringify(rows.map((r) => r.id));
  const statements: D1PreparedStatement[] = [];

  if (edits.artist !== undefined) {
    // The typed spelling wins, also over an existing artist that only
    // differs in case (same id).
    statements.push(
      db
        .prepare(
          `INSERT INTO artists (id, name, sort_name) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, sort_name = excluded.sort_name`,
        )
        .bind(newArtistId, edits.artist, sortName(edits.artist)),
    );
  }

  if (rekey) {
    // Target albums, created from the album the songs came from (keeping its
    // year, genre, cover and "added" date). An existing one keeps its own
    // cover unless it had none; its name takes the typed spelling.
    statements.push(
      db
        .prepare(
          `INSERT INTO albums (id, name, artist_id, year, genre, cover_ref, created_at)
           SELECT json_extract(m.value, '$.id'), json_extract(m.value, '$.name'), json_extract(m.value, '$.artistId'),
                  al.year, al.genre, al.cover_ref, al.created_at
           FROM json_each(?) m JOIN albums al ON al.id = json_extract(m.value, '$.old')
           WHERE true
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             cover_ref = COALESCE(albums.cover_ref, excluded.cover_ref)`,
        )
        .bind(mappingJson),
    );
  }

  const sets: string[] = [];
  const binds: (string | number | null)[] = [];
  if (rekey) {
    sets.push(
      `album_id = (SELECT json_extract(value, '$.id') FROM json_each(?) WHERE json_extract(value, '$.old') = tracks.album_id)`,
    );
    binds.push(mappingJson);
  }
  if (newArtistId) {
    sets.push("artist_id = ?");
    binds.push(newArtistId);
  }
  if (edits.title !== undefined) {
    sets.push("title = ?");
    binds.push(edits.title);
  }
  if (edits.track !== undefined) {
    sets.push("track_no = ?");
    binds.push(edits.track);
  }
  if (edits.disc !== undefined) {
    sets.push("disc_no = ?");
    binds.push(edits.disc);
  }
  if (sets.length) {
    statements.push(
      db
        .prepare(`UPDATE tracks SET ${sets.join(", ")} WHERE id IN (SELECT value FROM json_each(?))`)
        .bind(...binds, trackIds),
    );
  }

  const albumSets: string[] = [];
  const albumBinds: (string | number | null)[] = [];
  if (edits.year !== undefined) {
    albumSets.push("year = ?");
    albumBinds.push(edits.year);
  }
  if (edits.genre !== undefined) {
    albumSets.push("genre = ?");
    albumBinds.push(edits.genre);
  }
  if (albumSets.length) {
    statements.push(
      db
        .prepare(`UPDATE albums SET ${albumSets.join(", ")} WHERE id IN (SELECT value FROM json_each(?))`)
        .bind(...albumBinds, targetIds),
    );
  }

  if (rekey) {
    // A star on an album (artist) that's about to disappear moves to the
    // one its songs went to. OR IGNORE: if that one is starred already, the
    // old star just goes away with its album below.
    statements.push(
      db
        .prepare(
          `UPDATE OR IGNORE starred SET item_id = (
             SELECT json_extract(value, '$.id') FROM json_each(?1) WHERE json_extract(value, '$.old') = starred.item_id
           )
           WHERE item_type = 'album'
             AND item_id IN (SELECT json_extract(value, '$.old') FROM json_each(?1) WHERE json_extract(value, '$.old') <> json_extract(value, '$.id'))
             AND NOT EXISTS (SELECT 1 FROM tracks WHERE album_id = starred.item_id)`,
        )
        .bind(mappingJson),
    );
  }
  const oldArtistIds = [...new Set(rows.flatMap((r) => [r.artist_id, r.album_artist_id]))];
  if (newArtistId) {
    statements.push(
      db
        .prepare(
          `UPDATE OR IGNORE starred SET item_id = ?
           WHERE item_type = 'artist' AND item_id IN (SELECT value FROM json_each(?)) AND item_id <> ?
             AND NOT EXISTS (SELECT 1 FROM albums WHERE artist_id = starred.item_id)
             AND NOT EXISTS (SELECT 1 FROM tracks WHERE artist_id = starred.item_id)`,
        )
        .bind(newArtistId, JSON.stringify(oldArtistIds), newArtistId),
    );
  }
  if (rekey) statements.push(...q.pruneEmptyStatements(db, [...albumMap.keys()], oldArtistIds));

  if (statements.length) await db.batch(statements);
  return { updated: rows.length, albumIds: [...new Set(mapping.map((m) => m.id))] };
}

export function parseTagEdits(params: URLSearchParams): TagEdits {
  const edits: TagEdits = {};
  const text = (key: "title" | "artist" | "album") => {
    if (!params.has(key)) return;
    const value = params.get(key)!.trim();
    if (!value) throw new MetadataError(`${key[0].toUpperCase()}${key.slice(1)} can't be empty`);
    edits[key] = value;
  };
  const number = (key: "year" | "track" | "disc", max: number) => {
    if (!params.has(key)) return;
    const raw = params.get(key)!.trim();
    if (!raw) return void (edits[key] = null);
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > max) throw new MetadataError(`Invalid ${key}: ${raw}`);
    edits[key] = n;
  };
  text("title");
  text("artist");
  text("album");
  number("year", 9999);
  number("track", 9999);
  number("disc", 999);
  if (params.has("genre")) edits.genre = params.get("genre")!.trim() || null;
  return edits;
}

// --- cover art ---

export const MAX_COVER_BYTES = 10 * 1024 * 1024;

// Whether anything still points at a Telegram file: albums, artists, tracks,
// or a trash entry that would bring one back. In trash_rows the ref sits
// JSON-encoded inside a JSON string, hence matching its escaped form.
async function coverInUse(db: D1Database, ref: string): Promise<boolean> {
  const escaped = JSON.stringify(ref).slice(1, -1);
  const row = await db
    .prepare(
      `SELECT EXISTS(SELECT 1 FROM albums WHERE cover_ref = ?1)
           OR EXISTS(SELECT 1 FROM artists WHERE cover_ref = ?1)
           OR EXISTS(SELECT 1 FROM tracks WHERE cover_ref = ?1)
           OR EXISTS(SELECT 1 FROM trash_rows WHERE instr(data, ?2) > 0) as used`,
    )
    .bind(ref, escaped)
    .first<{ used: number }>();
  return !!row?.used;
}

// Replaces (bytes) or removes (null) the cover of an album, or the photo of
// an artist. The old image is deleted from Telegram unless still in use.
export async function setCoverArt(
  db: D1Database,
  storage: StorageBackend,
  id: string,
  image: { bytes: Uint8Array; contentType: string } | null,
): Promise<"album" | "artist"> {
  const album = await db.prepare(`SELECT cover_ref FROM albums WHERE id = ?`).bind(id).first<{ cover_ref: string | null }>();
  const artist = album
    ? null
    : await db.prepare(`SELECT cover_ref FROM artists WHERE id = ?`).bind(id).first<{ cover_ref: string | null }>();
  const table = album ? "albums" : artist ? "artists" : null;
  if (!table) throw new MetadataError("Album or artist not found");
  const oldRef = (album ?? artist)!.cover_ref;

  // Storage errors (Telegram's rate limit in particular) propagate as is.
  const ext = image?.contentType === "image/png" ? "png" : image?.contentType === "image/webp" ? "webp" : "jpg";
  const newRef = image ? await storage.putFile(image.bytes, `cover-${id}.${ext}`, image.contentType) : null;
  await db.prepare(`UPDATE ${table} SET cover_ref = ? WHERE id = ?`).bind(newRef, id).run();

  if (oldRef && oldRef !== newRef && !(await coverInUse(db, oldRef))) {
    await deleteFilesOrQueue(db, storage, [oldRef]);
  }
  return album ? "album" : "artist";
}

// --- duplicates ---

// Durations further apart than this aren't the same recording (a live
// version, a remix, a radio edit…) even with the same title and artist.
const DURATION_TOLERANCE = 3;

export async function findDuplicates(db: D1Database, mode: "tags" | "size"): Promise<q.TrackRow[][]> {
  const rows = await q.listDuplicateTracks(db, mode);
  const keyOf =
    mode === "size"
      ? (t: q.TrackRow) => `${t.size}:${t.suffix}`
      : (t: q.TrackRow) => `${t.title.trim().toLowerCase()}\u0000${t.artist_id}`;
  const groups: q.TrackRow[][] = [];
  let current: q.TrackRow[] = [];
  let currentKey: string | null = null;
  const flush = () => {
    if (current.length > 1) groups.push(current);
    current = [];
  };
  for (const t of rows) {
    const key = keyOf(t);
    const prev = current[current.length - 1];
    // Rows come sorted by duration within a title+artist key, so a gap
    // between neighbors starts a new group.
    const split =
      key !== currentKey ||
      (mode === "tags" &&
        prev.duration !== null &&
        t.duration !== null &&
        t.duration - prev.duration > DURATION_TOLERANCE);
    if (split) {
      flush();
      currentKey = key;
    }
    current.push(t);
  }
  flush();
  return groups;
}
