-- Subsonic-Telegram metadata schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS artists (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  sort_name TEXT NOT NULL,
  cover_ref TEXT              -- JSON: telegram file ref for an artist photo (scripts/fix-covers.ts), or NULL
);
-- Existing databases created before cover_ref existed need, once:
--   ALTER TABLE artists ADD COLUMN cover_ref TEXT;
CREATE INDEX IF NOT EXISTS idx_artists_sort_name ON artists(sort_name);
-- Album and song lists sorted by artist walk artists in this order (see
-- listAlbumList2 / listAllTracks in src/db/queries.ts).
CREATE INDEX IF NOT EXISTS idx_artists_name_nocase ON artists(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS albums (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  artist_id  TEXT NOT NULL REFERENCES artists(id),
  year       INTEGER,
  genre      TEXT,
  cover_ref  TEXT,             -- JSON: telegram file ref for embedded cover art, or NULL
  created_at INTEGER NOT NULL  -- unix seconds, used for "recently added"
);
CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist_id);
-- getAlbumList2's orderings. D1 bills every row a query reads, so a list
-- that sorts the whole table to return 20 albums costs the whole table.
CREATE INDEX IF NOT EXISTS idx_albums_created ON albums(created_at);
CREATE INDEX IF NOT EXISTS idx_albums_name_nocase ON albums(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_albums_year ON albums(year);

CREATE TABLE IF NOT EXISTS tracks (
  id           TEXT PRIMARY KEY,
  album_id     TEXT NOT NULL REFERENCES albums(id),
  artist_id    TEXT NOT NULL REFERENCES artists(id),
  title        TEXT NOT NULL,
  track_no     INTEGER,
  disc_no      INTEGER,
  duration     INTEGER,        -- seconds
  suffix       TEXT NOT NULL,  -- e.g. "mp3", "flac"
  content_type TEXT NOT NULL,  -- e.g. "audio/mpeg"
  size         INTEGER NOT NULL,
  bitrate      INTEGER,
  file_ref     TEXT NOT NULL,  -- JSON: {"messageId":123,"fileId":"..."}
  created_at   INTEGER NOT NULL,
  source_path  TEXT,            -- path relative to the local music dir at import time, if known;
                                 -- lets scripts/import-m3u.ts match .m3u entries to a track
  play_count   INTEGER NOT NULL DEFAULT 0,
  last_played  INTEGER,         -- unix seconds, set by the scrobble endpoint
  rating       INTEGER NOT NULL DEFAULT 0, -- 0-5 stars, set by the setRating endpoint; 0 = unrated
  cover_ref    TEXT,            -- JSON: telegram file ref for a song-specific cover, or NULL.
                                 -- Only set for tracks whose album is really a compilation of
                                 -- unrelated songs (see scripts/fix-covers.ts) -- otherwise the
                                 -- track just falls back to its album's cover_ref (see
                                 -- src/subsonic/mappers.ts songNode / src/subsonic/media.ts).
  -- Parent folder of source_path ("a/b" for "a/b/c.mp3", "" for a file at the
  -- root, NULL when source_path is NULL). The inner rtrim strips every
  -- trailing non-"/" character (i.e. the file name), the outer one the "/".
  -- Lets the Folders view list one directory via an index instead of
  -- scanning everything under it (see getFolder in src/index.ts).
  dir          TEXT GENERATED ALWAYS AS (rtrim(rtrim(source_path, replace(source_path, '/', '')), '/')) VIRTUAL
);
-- Existing databases created before dir existed need, once (before running
-- the rest of this file, since idx_tracks_dir below depends on it):
--   ALTER TABLE tracks ADD COLUMN dir TEXT GENERATED ALWAYS AS (rtrim(rtrim(source_path, replace(source_path, '/', '')), '/')) VIRTUAL;
CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_id);
CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist_id);
CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
CREATE INDEX IF NOT EXISTS idx_tracks_source_path ON tracks(source_path);
-- Covering index: getFolder/getFolderTree aggregate per-folder counts/sizes
-- straight from it without touching the table rows.
CREATE INDEX IF NOT EXISTS idx_tracks_dir ON tracks(dir, size, duration);
-- The Songs page's sort orders, recently/most played and the Storage page's
-- largest songs: each reads just the page it shows instead of every track.
CREATE INDEX IF NOT EXISTS idx_tracks_title_nocase ON tracks(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_tracks_created ON tracks(created_at);
CREATE INDEX IF NOT EXISTS idx_tracks_last_played ON tracks(last_played);
CREATE INDEX IF NOT EXISTS idx_tracks_play_count ON tracks(play_count);
CREATE INDEX IF NOT EXISTS idx_tracks_size ON tracks(size);

-- owner is the single AUTH_USERNAME (see wrangler secrets), not a DB-managed
-- account, so it's a plain string rather than a users(username) FK.
CREATE TABLE IF NOT EXISTS playlists (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  owner      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  changed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id TEXT NOT NULL REFERENCES playlists(id),
  position    INTEGER NOT NULL,
  track_id    TEXT NOT NULL REFERENCES tracks(id),
  PRIMARY KEY (playlist_id, position)
);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id);

-- Favorites (star/unstar/getStarred). item_type is 'artist', 'album', or
-- 'track'; item_id references the matching table's id (not enforced via FK
-- since it varies by item_type).
CREATE TABLE IF NOT EXISTS starred (
  owner      TEXT NOT NULL,
  item_type  TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  starred_at INTEGER NOT NULL,
  PRIMARY KEY (owner, item_type, item_id)
);

-- Auth credentials live in the AUTH_USERNAME/AUTH_PASSWORD Worker secrets
-- (see wrangler.toml), not in D1 — see src/auth.ts.

-- Folders are normally just derived from tracks.source_path (see
-- listTracksUnderPath/getFolder) — there's no row here unless a folder was
-- explicitly created empty (via the Web UI's "New folder") before any track
-- was uploaded into it. getFolder merges both sources when listing a
-- directory's children.
CREATE TABLE IF NOT EXISTS folders (
  path       TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- getPlayQueue/savePlayQueue — one row per owner (single-user, so no need for
-- a history of past queues). track_ids is a JSON array of track ids in queue
-- order; current_id/position_ms track where playback was within that queue.
CREATE TABLE IF NOT EXISTS play_queue (
  owner       TEXT PRIMARY KEY,
  track_ids   TEXT NOT NULL,
  current_id  TEXT,
  position_ms INTEGER NOT NULL DEFAULT 0,
  changed_at  INTEGER NOT NULL,
  changed_by  TEXT
);

-- Accounting for the optional R2 read-through cache (src/storage/cached.ts).
-- Only populated when the CACHE_BUCKET binding is configured; harmless
-- empty table otherwise. `key` is the sha256 hex of the file_ref/cover_ref
-- being cached, doubling as the R2 object key.
CREATE TABLE IF NOT EXISTS cache_entries (
  key           TEXT PRIMARY KEY,
  size          INTEGER NOT NULL,
  content_type  TEXT NOT NULL,
  last_accessed INTEGER NOT NULL  -- unix seconds; eviction removes oldest first
);
CREATE INDEX IF NOT EXISTS idx_cache_entries_last_accessed ON cache_entries(last_accessed);

-- Trash (recycle bin) for the web UI's deletes — see src/subsonic/trash.ts.
-- One entry per deleted folder (everything that was under it) or per
-- individually deleted song. Rows removed from the live tables are kept in
-- trash_rows as JSON objects of their columns (tbl = source table name), so
-- an entry can be restored exactly, including the albums/artists, stars,
-- playlist positions and folder registrations that went with it. The
-- Telegram files stay untouched until an entry is purged (by hand, or by the
-- daily cron after TRASH_RETENTION_DAYS).
CREATE TABLE IF NOT EXISTS trash (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,     -- 'folder' | 'track'
  name       TEXT NOT NULL,     -- folder name or file name, for display
  path       TEXT,              -- original folder path / source_path (NULL: song wasn't in a folder)
  song_count INTEGER NOT NULL,
  size       INTEGER NOT NULL,
  deleted_at INTEGER NOT NULL   -- unix seconds
);
CREATE INDEX IF NOT EXISTS idx_trash_deleted_at ON trash(deleted_at);

CREATE TABLE IF NOT EXISTS trash_rows (
  trash_id TEXT NOT NULL REFERENCES trash(id),
  tbl      TEXT NOT NULL,       -- 'tracks' | 'albums' | 'artists' | 'playlist_tracks' | 'starred' | 'folders'
  data     TEXT NOT NULL        -- JSON object: column -> value
);
CREATE INDEX IF NOT EXISTS idx_trash_rows_trash ON trash_rows(trash_id, tbl);

-- Telegram files whose deletion failed (bot lacked "Delete messages", API
-- error, ...). The daily cron retries them, so a purge never silently leaves
-- an orphaned message behind.
CREATE TABLE IF NOT EXISTS pending_deletes (
  file_ref   TEXT PRIMARY KEY,
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL
);

-- Songs whose Telegram message caption (file path + song id, see
-- src/subsonic/captions.ts) needs to be (re)written: after a move or rename,
-- or for every song once the backfill is started from the Storage page.
-- Worked off a few at a time by a cron, to stay well under Telegram's rate
-- limits. attempts >= 5 means it gave up (last_error says why).
CREATE TABLE IF NOT EXISTS caption_queue (
  track_id   TEXT PRIMARY KEY,
  queued_at  INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
-- The cron's next batch, without reading the rest of the queue.
CREATE INDEX IF NOT EXISTS idx_caption_queue_next ON caption_queue(attempts, queued_at);
