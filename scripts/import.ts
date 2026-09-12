// Scans a local music directory, uploads each audio file to Telegram (as a
// Bot API document), and writes the resulting artist/album/track metadata to
// D1 over Cloudflare's HTTP API (D1 bindings only exist inside a Worker, so a
// plain Node script has to go through the REST API instead of wrangler).
//
// Usage: npm run import -- /path/to/music
import "dotenv/config";
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseFile } from "music-metadata";

const MUSIC_DIR = process.argv[2];
if (!MUSIC_DIR) {
  console.error("Usage: npm run import -- /path/to/music");
  process.exit(1);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var ${name} (see .env.example)`);
    process.exit(1);
  }
  return v;
}

const TG_BOT_TOKEN = requireEnv("TG_BOT_TOKEN");
const TG_CHANNEL_ID = requireEnv("TG_CHANNEL_ID");
const CF_ACCOUNT_ID = requireEnv("CF_ACCOUNT_ID");
const CF_API_TOKEN = requireEnv("CF_API_TOKEN");
const D1_DATABASE_ID = requireEnv("D1_DATABASE_ID");

// Bot API hard limits: 50MB upload via sendDocument, 20MB download via
// getFile. Skip anything that would fail on the read side later.
const MAX_FILE_BYTES = 19 * 1024 * 1024;

const AUDIO_EXT: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".wav": "audio/wav",
};

const STATE_FILE = path.join(process.cwd(), ".import-state.json");

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

function stripArticle(name: string): string {
  return name.replace(/^(the|a|an)\s+/i, "");
}

async function loadState(): Promise<Set<string>> {
  try {
    const raw = await readFile(STATE_FILE, "utf-8");
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

async function saveState(done: Set<string>): Promise<void> {
  await writeFile(STATE_FILE, JSON.stringify([...done]));
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (AUDIO_EXT[path.extname(entry.name).toLowerCase()]) yield full;
  }
}

async function d1<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    },
  );
  const data = (await res.json()) as any;
  if (!data.success) {
    throw new Error(`D1 query failed: ${JSON.stringify(data.errors)}`);
  }
  return data.result[0]?.results ?? [];
}

async function telegramSendDocument(bytes: Uint8Array, filename: string, mimeType: string) {
  const form = new FormData();
  form.set("chat_id", TG_CHANNEL_ID);
  form.set("document", new Blob([bytes], { type: mimeType }), filename);
  const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendDocument`, {
    method: "POST",
    body: form,
  });
  const data = (await res.json()) as any;
  if (!data.ok) throw new Error(`Telegram upload failed for ${filename}: ${JSON.stringify(data)}`);
  return data.result;
}

async function ensureArtist(name: string): Promise<string> {
  const id = md5(`artist:${name.toLowerCase()}`);
  await d1(`INSERT INTO artists (id, name, sort_name) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING`, [
    id,
    name,
    stripArticle(name),
  ]);
  return id;
}

async function ensureAlbum(name: string, artistId: string, year: number | null, genre: string | null): Promise<string> {
  const id = md5(`album:${artistId}:${name.toLowerCase()}`);
  await d1(
    `INSERT INTO albums (id, name, artist_id, year, genre, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    [id, name, artistId, year, genre, Math.floor(Date.now() / 1000)],
  );
  return id;
}

async function ensureCoverArt(albumId: string, picture: { data: Uint8Array; format: string }): Promise<void> {
  const existing = await d1<{ cover_ref: string | null }>(`SELECT cover_ref FROM albums WHERE id = ?`, [albumId]);
  if (existing[0]?.cover_ref) return;
  const result = await telegramSendDocument(picture.data, `cover-${albumId}.jpg`, picture.format);
  const fileId = result.document?.file_id;
  if (!fileId) return;
  const ref = JSON.stringify({ messageId: result.message_id, fileId });
  await d1(`UPDATE albums SET cover_ref = ? WHERE id = ?`, [ref, albumId]);
}

async function main() {
  const done = await loadState();
  let imported = 0;
  let skipped = 0;

  for await (const file of walk(MUSIC_DIR)) {
    if (done.has(file)) continue;

    const stats = await stat(file);
    if (stats.size > MAX_FILE_BYTES) {
      console.warn(`Skipping (exceeds ${MAX_FILE_BYTES} bytes, Telegram Bot API getFile limit): ${file}`);
      skipped++;
      continue;
    }

    try {
      const meta = await parseFile(file);
      const common = meta.common;
      const ext = path.extname(file).toLowerCase();
      const mimeType = AUDIO_EXT[ext] ?? "application/octet-stream";
      const artistName = common.albumartist || common.artist || "Unknown Artist";
      const albumName = common.album || "Unknown Album";
      const title = common.title || path.basename(file, ext);

      const artistId = await ensureArtist(artistName);
      const albumId = await ensureAlbum(albumName, artistId, common.year ?? null, common.genre?.[0] ?? null);

      console.log(`Uploading: ${artistName} / ${albumName} / ${title}`);
      const bytes = await readFile(file);
      const message = await telegramSendDocument(bytes, path.basename(file), mimeType);
      const fileId = message.document?.file_id ?? message.audio?.file_id;
      if (!fileId) throw new Error("Telegram response missing file_id");

      const trackId = md5(`track:${albumId}:${path.basename(file)}`);
      const sourcePath = path.relative(MUSIC_DIR, file).split(path.sep).join("/");
      await d1(
        `INSERT INTO tracks
           (id, album_id, artist_id, title, track_no, disc_no, duration, suffix, content_type, size, bitrate, file_ref, created_at, source_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        [
          trackId,
          albumId,
          artistId,
          title,
          common.track?.no ?? null,
          common.disk?.no ?? null,
          Math.round(meta.format.duration ?? 0),
          ext.slice(1),
          mimeType,
          stats.size,
          meta.format.bitrate ? Math.round(meta.format.bitrate / 1000) : null,
          JSON.stringify({ messageId: message.message_id, fileId }),
          Math.floor(Date.now() / 1000),
          sourcePath,
        ],
      );

      const picture = common.picture?.[0];
      if (picture) {
        await ensureCoverArt(albumId, { data: picture.data, format: picture.format });
      }

      done.add(file);
      imported++;
      if (imported % 20 === 0) await saveState(done);
    } catch (err) {
      console.error(`Failed: ${file}`, err);
    }
  }

  await saveState(done);
  console.log(`Done. Imported ${imported} new tracks, skipped ${skipped} (too large).`);
}

main();
