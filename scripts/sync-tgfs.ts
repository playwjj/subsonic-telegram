// Pulls tracks that were uploaded via the alice-creator/TGFS pipeline (a
// separate Telegram-as-storage project) into this project's own D1 metadata,
// without re-uploading any audio bytes.
//
// How it works: TGFS keeps its file index as a git repo (empty placeholder
// blobs named "<original filename>.<message_id>", mirroring the real
// directory tree) pushed to a GitHub repo. Each placeholder's message_id
// points at a Telegram message containing a JSON "file descriptor"
// ({"type":"F","versions":[{"messageIds":[...],"size":...}]}); the
// messageIds it lists are the messages that actually hold the audio
// document. Since TGFS and this project use the *same* bot and the *same*
// channel, we can call Telegram's forwardMessage on those message ids to
// obtain a document/file_id this project's bot can stream directly via
// getFile — no bytes ever pass through this script.
//
// Already-synced tracks (by deterministic id, same scheme as import.ts) are
// skipped without touching Telegram, so this is safe to re-run any time new
// files show up in the TGFS metadata repo.
//
// Usage: npm run sync-tgfs [-- --dry-run] [-- --limit=N]
import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { parseFile } from "music-metadata";

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
const TGFS_GITHUB_REPO = requireEnv("TGFS_GITHUB_REPO"); // e.g. "playwjj/music-metadata"
const TGFS_GITHUB_TOKEN = requireEnv("TGFS_GITHUB_TOKEN");
// Optional: local copy of the same music library, used to fill in
// duration/bitrate/tags that TGFS's metadata doesn't carry. If a matching
// local file isn't found, falls back to parsing the folder/file names.
const LOCAL_MUSIC_DIR = process.env.LOCAL_MUSIC_DIR;

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT = (() => {
  const arg = process.argv.find((a) => a.startsWith("--limit="));
  return arg ? Number(arg.split("=", 2)[1]) : undefined;
})();

const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  opus: "audio/opus",
  wav: "audio/wav",
};

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

function stripArticle(name: string): string {
  return name.replace(/^(the|a|an)\s+/i, "");
}

async function d1<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${CF_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
    },
  );
  const data = (await res.json()) as any;
  if (!data.success) throw new Error(`D1 query failed: ${JSON.stringify(data.errors)}`);
  return data.result[0]?.results ?? [];
}

async function tg(method: string, params: Record<string, string | number>, retries = 5): Promise<any> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params as Record<string, string>),
    });
    const data = (await res.json()) as any;
    if (data.ok) return data.result;
    if (res.status === 429 && data.parameters?.retry_after) {
      const wait = data.parameters.retry_after + 1;
      console.log(`  rate limited, sleeping ${wait}s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    throw new Error(`telegram ${method} failed: ${JSON.stringify(data)}`);
  }
  throw new Error(`telegram ${method} failed after ${retries} retries`);
}

interface GhTreeEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
}

async function fetchTgfsTree(): Promise<GhTreeEntry[]> {
  const repoRes = await fetch(`https://api.github.com/repos/${TGFS_GITHUB_REPO}`, {
    headers: { Authorization: `token ${TGFS_GITHUB_TOKEN}` },
  });
  const repo = (await repoRes.json()) as any;
  if (!repo.default_branch) throw new Error(`Could not read repo ${TGFS_GITHUB_REPO}: ${JSON.stringify(repo)}`);

  const treeRes = await fetch(
    `https://api.github.com/repos/${TGFS_GITHUB_REPO}/git/trees/${repo.default_branch}?recursive=1`,
    { headers: { Authorization: `token ${TGFS_GITHUB_TOKEN}` } },
  );
  const tree = (await treeRes.json()) as any;
  if (!tree.tree) throw new Error(`Could not read tree: ${JSON.stringify(tree)}`);
  if (tree.truncated) console.warn("WARNING: GitHub tree response was truncated, some files may be missed");
  return tree.tree as GhTreeEntry[];
}

interface ParsedTrack {
  relPath: string; // path within the metadata repo, minus the trailing message id
  artist: string;
  album: string;
  title: string;
  year: number | null;
  ext: string;
  filename: string; // original filename, e.g. "周杰伦 - 伊斯坦堡.mp3"
  descriptorMsgId: number;
  localPath: string | null;
}

function isRealTrack(p: string): boolean {
  if (p.startsWith("navidrome-backup/")) return false; // Navidrome DB backup, unrelated to file storage
  if (p.endsWith(".gitkeep")) return false;
  return /\.\d+$/.test(p);
}

function parseTracks(tree: GhTreeEntry[]): ParsedTrack[] {
  const blobs = tree.filter((t) => t.type === "blob").map((t) => t.path);
  const real = blobs.filter(isRealTrack);

  const tracks: ParsedTrack[] = [];
  for (const p of real) {
    const parts = p.split("/");
    const filenameWithId = parts[parts.length - 1];
    const m = filenameWithId.match(/^(.*)\.(\d+)$/);
    if (!m) continue;
    const filename = m[1];
    const descriptorMsgId = Number(m[2]);
    const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
    const titleStem = ext ? filename.slice(0, -(ext.length + 1)) : filename;

    let artist: string;
    let album: string;
    let title: string;
    let year: number | null = null;

    if (parts.length === 3) {
      // artist/album/file.ext
      artist = parts[0];
      album = parts[1];
      title = titleStem.startsWith(artist + " - ") ? titleStem.slice(artist.length + 3) : titleStem;
    } else if (parts.length === 2) {
      // chart-folder/Artist-Title.ext
      album = parts[0];
      if (titleStem.includes("-")) {
        const idx = titleStem.indexOf("-");
        artist = titleStem.slice(0, idx).trim();
        title = titleStem.slice(idx + 1).trim();
      } else {
        artist = "群星";
        title = titleStem;
      }
      const ym = album.match(/(\d{4})\d{2}$/);
      year = ym ? Number(ym[1]) : null;
    } else {
      console.warn(`  SKIP (unexpected path depth): ${p}`);
      continue;
    }

    const localPath = LOCAL_MUSIC_DIR ? path.join(LOCAL_MUSIC_DIR, ...parts.slice(0, -1), filename) : null;

    tracks.push({
      relPath: p,
      artist,
      album,
      title,
      year,
      ext,
      filename,
      descriptorMsgId,
      localPath: localPath && existsSync(localPath) ? localPath : null,
    });
  }
  return tracks;
}

interface LocalTags {
  artist?: string;
  album?: string;
  title?: string;
  genre?: string;
  year?: number;
  trackNo?: number;
  discNo?: number;
  duration?: number;
  bitrate?: number;
  size?: number;
}

async function readLocalTags(localPath: string | null): Promise<LocalTags> {
  if (!localPath) return {};
  try {
    const meta = await parseFile(localPath);
    const common = meta.common;
    return {
      artist: common.albumartist || common.artist || undefined,
      album: common.album || undefined,
      title: common.title || undefined,
      genre: common.genre?.[0],
      year: common.year ?? undefined,
      trackNo: common.track?.no ?? undefined,
      discNo: common.disk?.no ?? undefined,
      duration: meta.format.duration ? Math.round(meta.format.duration) : undefined,
      bitrate: meta.format.bitrate ? Math.round(meta.format.bitrate / 1000) : undefined,
      size: statSync(localPath).size,
    };
  } catch (e) {
    console.warn(`    (tag read failed for ${localPath}: ${e})`);
    return {};
  }
}

interface ResolvedFile {
  fileId: string;
  fileSize: number;
  forwardedMessageId: number;
}

async function resolveFile(descriptorMsgId: number): Promise<ResolvedFile | { error: string }> {
  const desc = await tg("forwardMessage", {
    chat_id: TG_CHANNEL_ID,
    from_chat_id: TG_CHANNEL_ID,
    message_id: descriptorMsgId,
  });
  const text = desc.text as string | undefined;
  if (!text) return { error: `descriptor msg ${descriptorMsgId} has no text` };

  let meta: any;
  try {
    meta = JSON.parse(text);
  } catch {
    return { error: `descriptor msg ${descriptorMsgId} text not JSON` };
  }
  const versions = meta.versions ?? [];
  if (!versions.length) return { error: `descriptor msg ${descriptorMsgId} has no versions` };
  const latest = versions[versions.length - 1];
  const messageIds: number[] = latest.messageIds ?? [];
  if (messageIds.length !== 1) return { error: `multi-part (${messageIds.length} parts), skipping` };

  const chunk = await tg("forwardMessage", {
    chat_id: TG_CHANNEL_ID,
    from_chat_id: TG_CHANNEL_ID,
    message_id: messageIds[0],
  });
  const doc = chunk.document ?? chunk.audio;
  if (!doc) return { error: `chunk msg ${messageIds[0]} has no document/audio` };
  return {
    fileId: doc.file_id,
    fileSize: doc.file_size ?? latest.size ?? 0,
    forwardedMessageId: chunk.message_id,
  };
}

async function ensureArtist(cache: Map<string, string>, name: string): Promise<string> {
  const cached = cache.get(name);
  if (cached) return cached;
  const id = md5(`artist:${name.toLowerCase()}`);
  if (!DRY_RUN) {
    await d1(
      "INSERT INTO artists (id, name, sort_name) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
      [id, name, stripArticle(name)],
    );
  }
  cache.set(name, id);
  return id;
}

async function ensureAlbum(
  cache: Map<string, string>,
  name: string,
  artistId: string,
  year: number | null,
  genre: string | null,
): Promise<string> {
  const key = `${artistId}:${name}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const id = md5(`album:${artistId}:${name.toLowerCase()}`);
  if (!DRY_RUN) {
    await d1(
      `INSERT INTO albums (id, name, artist_id, year, genre, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         year=COALESCE(excluded.year, albums.year),
         genre=COALESCE(excluded.genre, albums.genre)`,
      [id, name, artistId, year, genre, Math.floor(Date.now() / 1000)],
    );
  }
  cache.set(key, id);
  return id;
}

async function main() {
  console.log("Fetching TGFS file index from GitHub...");
  const tree = await fetchTgfsTree();
  let tracks = parseTracks(tree);
  console.log(`Found ${tracks.length} track placeholders in TGFS metadata`);

  console.log("Loading already-synced track ids from D1...");
  const existing = await d1<{ id: string }>("SELECT id FROM tracks");
  const existingIds = new Set(existing.map((r) => r.id));

  // The id actually written to D1 uses ID3-tag-enriched artist/album names
  // (when a local copy is found), not the folder/filename-derived ones — so
  // tags must be read (cheap: local disk only) before computing the id used
  // to decide what's already synced. Only tracks that come out "new" go on
  // to call Telegram (forwardMessage has side effects).
  const pending: { track: ParsedTrack; tags: LocalTags }[] = [];

  for (const t of tracks) {
    const tags = await readLocalTags(t.localPath);
    const artistId = md5(`artist:${(tags.artist ?? t.artist).toLowerCase()}`);
    const albumId = md5(`album:${artistId}:${(tags.album ?? t.album).toLowerCase()}`);
    const trackId = md5(`track:${albumId}:${t.filename}`);
    if (existingIds.has(trackId)) continue;
    pending.push({ track: t, tags });
  }
  console.log(`${tracks.length - pending.length} already synced, ${pending.length} new`);

  const artistCache = new Map<string, string>();
  const albumCache = new Map<string, string>();

  const toProcess = LIMIT ? pending.slice(0, LIMIT) : pending;
  console.log(`Processing ${toProcess.length} tracks (dry_run=${DRY_RUN})`);

  let imported = 0;
  const skipped: { track: ParsedTrack; reason: string }[] = [];

  for (let i = 0; i < toProcess.length; i++) {
    const { track: t, tags } = toProcess[i];
    const label = `[${i + 1}/${toProcess.length}] ${t.artist} / ${t.album} / ${t.title}`;
    try {
      const result = await resolveFile(t.descriptorMsgId);
      if ("error" in result) {
        console.log(`${label} -> SKIP: ${result.error}`);
        skipped.push({ track: t, reason: result.error });
        continue;
      }

      const artistName = tags.artist ?? t.artist;
      const albumName = tags.album ?? t.album;
      const title = tags.title ?? t.title;
      const year = tags.year ?? t.year;

      const artistId = await ensureArtist(artistCache, artistName);
      const albumId = await ensureAlbum(albumCache, albumName, artistId, year, tags.genre ?? null);
      const trackId = md5(`track:${albumId}:${t.filename}`);
      const mime = AUDIO_MIME[t.ext] ?? "application/octet-stream";
      const fileRef = JSON.stringify({ messageId: result.forwardedMessageId, fileId: result.fileId });
      const size = tags.size ?? result.fileSize;

      if (!DRY_RUN) {
        await d1(
          `INSERT INTO tracks
             (id, album_id, artist_id, title, track_no, disc_no, duration, suffix, content_type, size, bitrate, file_ref, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             title=excluded.title, track_no=excluded.track_no, disc_no=excluded.disc_no,
             duration=excluded.duration, size=excluded.size, bitrate=excluded.bitrate,
             file_ref=excluded.file_ref`,
          [
            trackId,
            albumId,
            artistId,
            title,
            tags.trackNo ?? null,
            tags.discNo ?? null,
            tags.duration ?? null,
            t.ext,
            mime,
            size,
            tags.bitrate ?? null,
            fileRef,
            Math.floor(Date.now() / 1000),
          ],
        );
      }
      console.log(`${label} -> OK (${tags.duration ? "local tags" : "folder/filename only"})`);
      imported++;
      await new Promise((r) => setTimeout(r, 300));
    } catch (e) {
      console.error(`${label} -> ERROR: ${e}`);
      skipped.push({ track: t, reason: String(e) });
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.log(`\nDone. Imported ${imported}, skipped ${skipped.length}, already synced ${tracks.length - pending.length}`);
  if (skipped.length) {
    console.log("Skipped:");
    for (const s of skipped) console.log(`  ${s.track.relPath}: ${s.reason}`);
  }
}

main();
