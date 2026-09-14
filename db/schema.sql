-- Subsonic-Telegram metadata schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS artists (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  sort_name TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artists_sort_name ON artists(sort_name);

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
  cover_ref    TEXT             -- JSON: telegram file ref for a song-specific cover, or NULL.
                                 -- Only set for tracks whose album is really a compilation of
                                 -- unrelated songs (see scripts/fix-covers.ts) -- otherwise the
                                 -- track just falls back to its album's cover_ref (see
                                 -- src/subsonic/mappers.ts songNode / src/subsonic/media.ts).
);
CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_id);
CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist_id);
CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
CREATE INDEX IF NOT EXISTS idx_tracks_source_path ON tracks(source_path);

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
