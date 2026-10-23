// Lyrics lookup via LRCLIB (https://lrclib.net) — free, keyless, no rate-limit
// tier to configure. We only ever ask for an exact artist+title match (no
// fuzzy /api/search fallback): with messy tags (e.g. compilation folders
// where the artist field is wrong or "Various Artists"), a title-only fuzzy
// search returns confident-looking wrong matches (covers, live versions,
// same-titled songs) more often than it helps, so a non-exact match just
// returns nothing rather than guessing.
const LRCLIB_USER_AGENT = "subsonic-telegram (https://github.com/playwjj/subsonic-telegram)";

interface LrclibResponse {
  plainLyrics: string | null;
  syncedLyrics: string | null;
  instrumental: boolean;
}

// null: LRCLIB answered that it doesn't have the song. Throws when the
// lookup itself failed (network, 5xx, rate limit), so that isn't cached as a
// miss.
async function rawGet(artist: string, title: string): Promise<LrclibResponse | null> {
  const url = new URL("https://lrclib.net/api/get");
  url.searchParams.set("artist_name", artist);
  url.searchParams.set("track_name", title);

  const res = await fetch(url, { headers: { "User-Agent": LRCLIB_USER_AGENT } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB ${res.status}`);
  return (await res.json()) as LrclibResponse;
}

// Drops decorative suffixes tacked onto an otherwise-correct title, e.g.
// "情火（DJ）" -> "情火", "演员 (男女和声氛围版)" -> "演员". Still an exact
// match against whatever's left, not a fuzzy search — measured against a
// sample of this project's own library, this recovers only a handful of
// otherwise-missed tracks (most misses are LRCLIB just not having the song
// at all), but it's free to try before giving up.
function stripDecorations(title: string): string {
  return title
    .replace(/[(（\[].*?[)）\]]/g, "")
    .replace(/-\s*(DJ|Remix|伴奏|Live|现场)[^-]*$/i, "")
    .trim();
}

// Multiple performers are often joined into one tag ("张紫宁、李鑫一",
// "河图&叶玮庭") — LRCLIB indexes tracks under a single artist, usually the
// first-billed one, so that's the only part worth retrying with.
function firstArtist(artist: string): string {
  return artist.split(/[&、/,，]/)[0].trim();
}

async function lookupUncached(artist: string, title: string): Promise<LrclibResponse | null> {
  const direct = await rawGet(artist, title);
  if (direct) return direct;

  const cleanedArtist = firstArtist(artist);
  const cleanedTitle = stripDecorations(title);
  if (!cleanedTitle || (cleanedArtist === artist && cleanedTitle === title)) return null;
  return rawGet(cleanedArtist, cleanedTitle);
}

// LRCLIB's answer for a song rarely changes, and a player asks for it every
// time the song comes up — so it's kept in the edge cache (Cache API: this
// colo only, and a no-op on *.workers.dev). Misses are kept shorter, in case
// the song gets added there.
const FOUND_CACHE = "max-age=2592000";
const MISSING_CACHE = "max-age=604800";

async function lookupRaw(artist: string, title: string): Promise<LrclibResponse | null> {
  const key = new Request(`https://lyrics-cache.invalid/?${new URLSearchParams({ artist, title })}`);
  const cache = caches.default;
  const cached = await cache.match(key).catch(() => undefined);
  if (cached) return (await cached.json()) as LrclibResponse | null;

  let data: LrclibResponse | null;
  try {
    data = await lookupUncached(artist, title);
  } catch {
    return null;
  }
  const response = new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", "Cache-Control": data ? FOUND_CACHE : MISSING_CACHE },
  });
  await cache.put(key, response).catch(() => {});
  return data;
}

// Synced lyrics are LRC-formatted ("[01:23.45]line"); classic Subsonic
// getLyrics only has room for plain text, so strip the timestamps.
function stripLrcTimestamps(synced: string): string {
  return synced
    .split("\n")
    .map((line) => line.replace(/^\[\d{2}:\d{2}(?:\.\d{2,3})?\]\s*/, ""))
    .join("\n")
    .trim();
}

export async function fetchLyrics(artist: string, title: string): Promise<string | null> {
  const data = await lookupRaw(artist, title);
  if (!data) return null;
  if (data.instrumental) return "";
  if (data.plainLyrics) return data.plainLyrics;
  if (data.syncedLyrics) return stripLrcTimestamps(data.syncedLyrics);
  return null;
}

export interface StructuredLyrics {
  synced: boolean;
  lines: { start?: number; value: string }[];
}

function parseLrcLines(lrc: string): { start: number; value: string }[] {
  const lines: { start: number; value: string }[] = [];
  for (const raw of lrc.split("\n")) {
    const m = raw.match(/^\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]\s*(.*)$/);
    if (!m) continue;
    const [, mm, ss, frac, text] = m;
    const ms = (Number(mm) * 60 + Number(ss)) * 1000 + (frac ? Number(frac.padEnd(3, "0")) : 0);
    lines.push({ start: ms, value: text });
  }
  return lines;
}

// For OpenSubsonic's getLyricsBySongId, which (unlike classic getLyrics) has
// a field for per-line timing — worth passing through when LRCLIB has it, so
// clients that support scrolling synced lyrics (e.g. Amperfy) actually get
// the nicer experience instead of a flat text blob.
export async function fetchStructuredLyrics(artist: string, title: string): Promise<StructuredLyrics | null> {
  const data = await lookupRaw(artist, title);
  if (!data) return null;
  if (data.instrumental) return { synced: false, lines: [] };
  if (data.syncedLyrics) return { synced: true, lines: parseLrcLines(data.syncedLyrics) };
  if (data.plainLyrics) return { synced: false, lines: data.plainLyrics.split("\n").map((value) => ({ value })) };
  return null;
}
