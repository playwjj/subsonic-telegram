// Creates or updates a Subsonic playlist in D1 from a .m3u/.m3u8 file, by
// matching each entry to an already-imported track via its `source_path`
// column (set by scripts/import.ts and scripts/sync-tgfs.ts). Entries that
// don't match a known track are reported and skipped — run `npm run import`
// on that music first.
//
// Both this script and `npm run import` must be pointed at the *same* music
// root (LOCAL_MUSIC_DIR by default) for source_path to line up consistently.
// Re-running against the same .m3u updates the same playlist (matched by
// name) rather than creating a duplicate.
//
// Usage: npm run import-m3u -- /path/to/playlist.m3u [--name="Custom Name"] [--owner=username] [--music-dir=/path]
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var ${name} (see .env.example)`);
    process.exit(1);
  }
  return v;
}

const CF_ACCOUNT_ID = requireEnv("CF_ACCOUNT_ID");
const CF_API_TOKEN = requireEnv("CF_API_TOKEN");
const D1_DATABASE_ID = requireEnv("D1_DATABASE_ID");

const M3U_PATH = process.argv[2];
if (!M3U_PATH || M3U_PATH.startsWith("--")) {
  console.error(
    'Usage: npm run import-m3u -- /path/to/playlist.m3u [--name="Custom Name"] [--owner=username] [--music-dir=/path]',
  );
  process.exit(1);
}

function flag(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(`--${name}=`.length) : undefined;
}

const MUSIC_DIR = flag("music-dir") ?? process.env.LOCAL_MUSIC_DIR;
if (!MUSIC_DIR) {
  console.error("Need --music-dir=/path or LOCAL_MUSIC_DIR in .env (must match what `npm run import` used)");
  process.exit(1);
}

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
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

function parseM3U(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

async function main() {
  const name = flag("name") ?? path.basename(M3U_PATH, path.extname(M3U_PATH));

  let owner = flag("owner");
  if (!owner) {
    const users = await d1<{ username: string }>("SELECT username FROM users LIMIT 1");
    if (!users.length) throw new Error("No users in D1 and --owner not given");
    owner = users[0].username;
  }

  const raw = await readFile(M3U_PATH, "utf-8");
  const entries = parseM3U(raw);
  console.log(`Found ${entries.length} entries in ${M3U_PATH}`);

  const m3uDir = path.dirname(M3U_PATH);
  const trackIds: string[] = [];
  const missing: string[] = [];

  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, "/");
    const absPath = path.isAbsolute(normalized) ? normalized : path.resolve(m3uDir, normalized);
    const sourcePath = path.relative(MUSIC_DIR, absPath).split(path.sep).join("/");
    const rows = await d1<{ id: string }>("SELECT id FROM tracks WHERE source_path = ?", [sourcePath]);
    if (rows.length) {
      trackIds.push(rows[0].id);
    } else {
      missing.push(entry);
    }
  }

  console.log(`Matched ${trackIds.length}/${entries.length} tracks; ${missing.length} not found in D1`);
  if (missing.length) {
    console.log("Not found (run `npm run import` on these first):");
    for (const m of missing.slice(0, 20)) console.log(`  ${m}`);
    if (missing.length > 20) console.log(`  ... and ${missing.length - 20} more`);
  }
  if (!trackIds.length) {
    console.log("No matched tracks, nothing to do.");
    return;
  }

  const id = md5(`playlist:${name.toLowerCase()}`);
  const now = Math.floor(Date.now() / 1000);
  await d1(
    `INSERT INTO playlists (id, name, owner, created_at, changed_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET changed_at = excluded.changed_at`,
    [id, name, owner, now, now],
  );
  await d1("DELETE FROM playlist_tracks WHERE playlist_id = ?", [id]);
  for (let i = 0; i < trackIds.length; i++) {
    await d1("INSERT INTO playlist_tracks (playlist_id, position, track_id) VALUES (?, ?, ?)", [id, i, trackIds[i]]);
  }

  console.log(`Playlist "${name}" (${id}) now has ${trackIds.length} tracks.`);
}

main();
