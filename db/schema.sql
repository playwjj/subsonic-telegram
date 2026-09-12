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
  source_path  TEXT             -- path relative to the local music dir at import time, if known;
                                 -- lets scripts/import-m3u.ts match .m3u entries to a track
);
CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_id);
CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist_id);
CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
CREATE INDEX IF NOT EXISTS idx_tracks_source_path ON tracks(source_path);

CREATE TABLE IF NOT EXISTS playlists (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  owner      TEXT NOT NULL REFERENCES users(username),
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

-- Subsonic legacy token auth (t = md5(password + salt)) needs the plaintext
-- password server-side to recompute the hash, so it's stored as-is here.
-- This is a single-user/personal deployment; do not reuse these passwords elsewhere.
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password TEXT NOT NULL
);
