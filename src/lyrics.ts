// Lyrics lookup via LRCLIB (https://lrclib.net) — free, keyless, no rate-limit
// tier to configure. We only ever ask for an exact artist+title match (no
// fuzzy /api/search fallback): with messy tags (e.g. compilation folders
// where the artist field is wrong or "Various Artists"), a title-only fuzzy
// search returns confident-looking wrong matches (covers, live versions,
// same-titled songs) more often than it helps, so Subsonic's classic
// getLyrics just returns empty in that case rather than guessing.
const LRCLIB_USER_AGENT = "subsonic-telegram (https://github.com/playwjj/subsonic-telegram)";

interface LrclibResponse {
  plainLyrics: string | null;
  syncedLyrics: string | null;
  instrumental: boolean;
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

  const data = (await res.json()) as LrclibResponse;
  if (data.instrumental) return "";
  if (data.plainLyrics) return data.plainLyrics;
  if (data.syncedLyrics) return stripLrcTimestamps(data.syncedLyrics);
  return null;
}
