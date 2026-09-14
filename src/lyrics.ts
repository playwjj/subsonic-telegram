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

async function rawGet(artist: string, title: string): Promise<LrclibResponse | null> {
  const url = new URL("https://lrclib.net/api/get");
  url.searchParams.set("artist_name", artist);
  url.searchParams.set("track_name", title);

  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": LRCLIB_USER_AGENT } });
  } catch {
    return null;
  }
  if (!res.ok) return null;
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

async function lookupRaw(artist: string, title: string): Promise<LrclibResponse | null> {
  const direct = await rawGet(artist, title);
  if (direct) return direct;

  const cleanedArtist = firstArtist(artist);
  const cleanedTitle = stripDecorations(title);
  if (!cleanedTitle || (cleanedArtist === artist && cleanedTitle === title)) return null;
  return rawGet(cleanedArtist, cleanedTitle);
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
