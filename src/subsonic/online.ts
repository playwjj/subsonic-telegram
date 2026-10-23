// Online metadata lookup for the web UI's "Find online…" (album and song
// edit dialogs): searches iTunes and MusicBrainz for candidates the user
// picks from — nothing here writes to the library on its own. Picking one
// just fills the edit form; saving goes through updateTracks/setCoverArt
// like any manual edit. Same sources as scripts/fix-covers.ts, but one
// interactive round instead of its slow, rate-limit-paced batch loop.
import { Converter } from "opencc-js/t2cn";
import { MetadataError, MAX_COVER_BYTES } from "./metadata";

export interface OnlineMatch {
  source: "itunes" | "musicbrainz";
  // iTunes: "<storefront>:<collectionId>" (a lookup only answers in the
  // storefront the album was found in); MusicBrainz: the release MBID.
  // For songs, the album the hit is on — what getOnlineAlbumTracks takes.
  albumRef?: string;
  title?: string; // songs only
  artist: string;
  album?: string;
  year?: number;
  genre?: string;
  track?: number;
  disc?: number;
  trackCount?: number;
  duration?: number; // seconds, songs only
  coverUrl?: string;
  thumbUrl?: string;
  score: number; // 0..1, how well it matches what was searched for
}

export interface OnlineTrack {
  title: string;
  track?: number;
  disc?: number;
  duration?: number;
  // Index into the `local` titles getOnlineAlbumTracks was given.
  match?: number;
}

const USER_AGENT = "subsonic-telegram (https://github.com/playwjj/subsonic-telegram)";

// --- text matching ---

const toSimplified = Converter({ from: "tw", to: "cn" });

// Traditional/simplified, case, punctuation and bracketed suffixes
// ("(Deluxe Edition)", "[Live]") don't count as differences.
export function normalize(s: string): string {
  return toSimplified(s)
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]|（.*?）|【.*?】/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

// Character-bigram Dice coefficient: works the same for CJK titles (no
// word boundaries) and Latin ones.
function dice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const n = grams.get(g) ?? 0;
    if (n > 0) {
      shared++;
      grams.set(g, n - 1);
    }
  }
  return (2 * shared) / (a.length + b.length - 2);
}

// Bracketed parts only, e.g. "(Live)" — to tell a version apart from the
// original it otherwise normalizes the same as.
const versionOf = (s: string) =>
  normalize((s.match(/\(.*?\)|\[.*?\]|（.*?）|【.*?】/g) ?? []).join("").replace(/[()[\]（）【】]/g, " "));

function similarity(want: string, got: string): number {
  const w = normalize(want);
  const g = normalize(got);
  if (!w || !g) return 0;
  if (w === g) return versionOf(want) === versionOf(got) ? 1 : 0.9;
  if (g.includes(w) || w.includes(g)) return 0.8;
  return dice(w, g) * 0.7;
}

// Fields left empty in the search don't count either way.
function score(pairs: [want: string, got: string | undefined, weight: number][]): number {
  let total = 0;
  let weights = 0;
  for (const [want, got, weight] of pairs) {
    if (!want.trim()) continue;
    total += similarity(want, got ?? "") * weight;
    weights += weight;
  }
  return weights ? Math.round((total / weights) * 100) / 100 : 0;
}

// Import-time junk in local titles ("06.", "06 - ") that would only skew
// the search and the title comparison.
export function cleanTitle(title: string): string {
  return title.replace(/^\d{1,3}\s*[.\-_、]\s*/, "").trim() || title;
}

function yearOf(date: string | undefined): number | undefined {
  const y = date ? Number(date.slice(0, 4)) : NaN;
  return Number.isInteger(y) && y > 0 ? y : undefined;
}

// --- iTunes Search API ---

// A release only shows up in the storefronts it was distributed to; pick a
// few by the script the search is written in rather than trying them all
// (Apple rate-limits this endpoint to roughly 20 requests a minute).
function storefronts(text: string): string[] {
  if (/[぀-ヿ]/.test(text)) return ["jp"];
  if (/[가-힯]/.test(text)) return ["kr"];
  if (/\p{Script=Han}/u.test(text)) return ["cn", "tw", "hk"];
  return ["us"];
}

class SourceError extends Error {}

// Apple rate-limits per IP, and a Worker's outgoing requests share IPs with
// everyone else's Workers: measured from production, about half of all
// iTunes requests were refused even at one every 10 seconds. A retry soon
// after often leaves through another IP and gets through, so rate-limited
// requests are retried a couple of times before giving up.
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_RETRY_MS = 400;
// Successful answers are cached at Cloudflare's edge for a day, so opening
// the same search again doesn't spend any of that quota.
const CACHE_SECONDS = 86400;

async function getJson<T>(url: string, source: string): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": CACHE_SECONDS, "300-599": 0 } },
      });
    } catch {
      throw new SourceError(`${source} unreachable`);
    }
    // Apple answers its rate limit with 403 or 429 depending on the edge.
    if (res.status === 403 || res.status === 429 || res.status === 503) {
      if (attempt < RATE_LIMIT_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_RETRY_MS * (attempt + 1)));
        continue;
      }
      throw new SourceError(`${source} is rate-limiting, try again in a minute`);
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new SourceError(`${source} error ${res.status}`);
    return (await res.json()) as T;
  }
}

interface ItunesItem {
  wrapperType?: string;
  collectionId: number;
  collectionName: string;
  artistName: string;
  collectionArtistName?: string;
  trackName?: string;
  trackNumber?: number;
  discNumber?: number;
  trackCount?: number;
  trackTimeMillis?: number;
  releaseDate?: string;
  primaryGenreName?: string;
  artworkUrl100?: string;
}

function itunesArtwork(url: string | undefined, size: number): string | undefined {
  return url?.replace(/\d+x\d+bb/, `${size}x${size}bb`);
}

async function searchItunes(kind: "album" | "song", artist: string, name: string): Promise<OnlineMatch[]> {
  const term = [artist, name].filter(Boolean).join(" ");
  const countries = storefronts(term);
  const results = await Promise.allSettled(
    countries.map(async (country) => {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=${kind}&limit=10&country=${country}`;
      const data = await getJson<{ results: ItunesItem[] }>(url, "iTunes");
      return (data?.results ?? []).map((r) => ({ country, r }));
    }),
  );
  // Only an error if every storefront failed.
  if (results.every((r) => r.status === "rejected")) throw (results[0] as PromiseRejectedResult).reason;

  const seen = new Set<string>();
  const out: OnlineMatch[] = [];
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const { country, r } of result.value) {
      const key = kind === "album" ? String(r.collectionId) : `${r.collectionId}:${r.trackName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const common = {
        source: "itunes" as const,
        albumRef: `${country}:${r.collectionId}`,
        album: r.collectionName,
        year: yearOf(r.releaseDate),
        genre: r.primaryGenreName,
        trackCount: r.trackCount,
        coverUrl: itunesArtwork(r.artworkUrl100, 1200),
        thumbUrl: itunesArtwork(r.artworkUrl100, 200),
      };
      if (kind === "album") {
        out.push({ ...common, artist: r.artistName, score: score([[artist, r.artistName, 2], [name, r.collectionName, 3]]) });
      } else {
        out.push({
          ...common,
          title: r.trackName,
          artist: r.artistName,
          track: r.trackNumber,
          disc: r.discNumber,
          duration: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : undefined,
          score: score([[artist, r.artistName, 2], [name, r.trackName, 3]]),
        });
      }
    }
  }
  return out;
}

// --- MusicBrainz (+ Cover Art Archive) ---

// Better coverage than iTunes for a lot of regional releases, but no
// genres, and cover art only where someone uploaded it — so its covers may
// simply not load (the dialog hides those).
interface MbCredit {
  name: string;
  joinphrase?: string;
}
interface MbRelease {
  id: string;
  title: string;
  date?: string;
  status?: string;
  "artist-credit"?: MbCredit[];
  "release-group"?: { id: string };
  "track-count"?: number;
  media?: { position?: number; track?: { number?: string; title?: string }[]; tracks?: MbTrack[]; "track-count"?: number }[];
}
interface MbTrack {
  number?: string;
  position?: number;
  title: string;
  length?: number;
}
interface MbRecording {
  id: string;
  title: string;
  length?: number;
  "first-release-date"?: string;
  "artist-credit"?: MbCredit[];
  releases?: MbRelease[];
}

const credits = (c: MbCredit[] | undefined) => (c ?? []).map((a) => a.name + (a.joinphrase ?? "")).join("");

// Lucene field query; the parentheses keep every word in that field.
function field(name: string, value: string): string {
  const escaped = value.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, "\\$1").trim();
  return escaped ? `${name}:(${escaped})` : "";
}

// Covers per release group: a release group (the album across all its
// editions) much more often has art than any one release of it.
function caaCover(release: MbRelease, size: 250 | 1200): string {
  const group = release["release-group"]?.id;
  return group
    ? `https://coverartarchive.org/release-group/${group}/front-${size}`
    : `https://coverartarchive.org/release/${release.id}/front-${size}`;
}

async function searchMusicBrainz(kind: "album" | "song", artist: string, name: string): Promise<OnlineMatch[]> {
  const query = [field("artist", artist), field(kind === "album" ? "release" : "recording", name)].filter(Boolean).join(" AND ");
  const entity = kind === "album" ? "release" : "recording";
  const data = await getJson<{ releases?: MbRelease[]; recordings?: MbRecording[] }>(
    `https://musicbrainz.org/ws/2/${entity}?query=${encodeURIComponent(query)}&fmt=json&limit=15`,
    "MusicBrainz",
  );
  const out: OnlineMatch[] = [];
  const seen = new Set<string>();
  if (kind === "album") {
    for (const rel of data?.releases ?? []) {
      // One entry per album, not per edition/pressing.
      const key = rel["release-group"]?.id ?? rel.id;
      if (seen.has(key)) continue;
      seen.add(key);
      const relArtist = credits(rel["artist-credit"]);
      out.push({
        source: "musicbrainz",
        albumRef: rel.id,
        artist: relArtist,
        album: rel.title,
        year: yearOf(rel.date),
        trackCount: rel["track-count"],
        coverUrl: caaCover(rel, 1200),
        thumbUrl: caaCover(rel, 250),
        score: score([[artist, relArtist, 2], [name, rel.title, 3]]),
      });
    }
  } else {
    for (const rec of data?.recordings ?? []) {
      const recArtist = credits(rec["artist-credit"]);
      const releases = rec.releases ?? [];
      const rel = releases.find((r) => r.status === "Official") ?? releases[0];
      const key = `${rec.title}:${recArtist}:${rel?.["release-group"]?.id ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const medium = rel?.media?.[0];
      const trackNo = Number(medium?.track?.[0]?.number);
      out.push({
        source: "musicbrainz",
        albumRef: rel?.id,
        title: rec.title,
        artist: recArtist,
        album: rel?.title,
        year: yearOf(rec["first-release-date"] ?? rel?.date),
        track: Number.isInteger(trackNo) && trackNo > 0 ? trackNo : undefined,
        disc: medium?.position,
        trackCount: medium?.["track-count"],
        duration: rec.length ? Math.round(rec.length / 1000) : undefined,
        coverUrl: rel ? caaCover(rel, 1200) : undefined,
        thumbUrl: rel ? caaCover(rel, 250) : undefined,
        score: score([[artist, recArtist, 2], [name, rec.title, 3]]),
      });
    }
  }
  return out;
}

// --- entry points ---

const MAX_MATCHES = 16;

// Both sources at once; one failing (rate limit, outage) still returns the
// other's matches, with the failure in `errors`.
export async function searchOnline(
  kind: "album" | "song",
  artist: string,
  name: string,
): Promise<{ matches: OnlineMatch[]; errors: string[] }> {
  artist = artist.trim();
  name = kind === "song" ? cleanTitle(name.trim()) : name.trim();
  if (!artist && !name) throw new MetadataError("Nothing to search for");
  const results = await Promise.allSettled([searchItunes(kind, artist, name), searchMusicBrainz(kind, artist, name)]);
  const matches: OnlineMatch[] = [];
  const errors: string[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") matches.push(...r.value);
    else errors.push(r.reason instanceof SourceError ? r.reason.message : String(r.reason));
  }
  // Stable sort: on a tie iTunes (listed first) wins — it has genres and
  // covers that reliably exist.
  matches.sort((a, b) => b.score - a.score);
  // Searched in simplified Chinese, but iTunes' tw/hk storefronts (often
  // the only ones carrying an album) and MusicBrainz answer in traditional:
  // keep the library's script.
  const query = artist + name;
  if (/\p{Script=Han}/u.test(query) && toSimplified(query) === query) {
    for (const m of matches) {
      for (const key of ["title", "artist", "album", "genre"] as const) {
        if (m[key]) m[key] = toSimplified(m[key]!);
      }
    }
  }
  return { matches: matches.slice(0, MAX_MATCHES), errors };
}

// The track list of a match's album, each matched (by title) to one of the
// library's songs, so an album match can fill in track/disc numbers.
export async function getOnlineAlbumTracks(albumRef: string, local: string[]): Promise<OnlineTrack[]> {
  let tracks: OnlineTrack[];
  const itunes = /^([a-z]{2}):(\d+)$/.exec(albumRef);
  if (itunes) {
    const data = await getJson<{ results: ItunesItem[] }>(
      `https://itunes.apple.com/lookup?id=${itunes[2]}&entity=song&country=${itunes[1]}`,
      "iTunes",
    ).catch(rethrow);
    tracks = (data?.results ?? [])
      .filter((r) => r.wrapperType === "track" && r.trackName)
      .map((r) => ({
        title: r.trackName!,
        track: r.trackNumber,
        disc: r.discNumber,
        duration: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : undefined,
      }));
  } else if (/^[0-9a-f-]{36}$/.test(albumRef)) {
    const data = await getJson<MbRelease>(`https://musicbrainz.org/ws/2/release/${albumRef}?inc=recordings&fmt=json`, "MusicBrainz").catch(
      rethrow,
    );
    tracks = (data?.media ?? []).flatMap((m) =>
      (m.tracks ?? []).map((t) => ({
        title: t.title,
        track: t.position,
        disc: m.position,
        duration: t.length ? Math.round(t.length / 1000) : undefined,
      })),
    );
  } else throw new MetadataError("Invalid album reference");

  // Exact (normalized) titles first, then the closest remaining one above a
  // threshold; each local song is used at most once.
  const localNorm = local.map((t) => normalize(cleanTitle(t)));
  const used = new Set<number>();
  for (const t of tracks) {
    const i = localNorm.findIndex((l, i) => !used.has(i) && l && l === normalize(t.title));
    if (i >= 0) {
      t.match = i;
      used.add(i);
    }
  }
  for (const t of tracks) {
    if (t.match !== undefined) continue;
    let best = -1;
    let bestScore = 0.6;
    localNorm.forEach((l, i) => {
      if (used.has(i)) return;
      const s = similarity(l, t.title);
      if (s >= bestScore) [best, bestScore] = [i, s];
    });
    if (best >= 0) {
      t.match = best;
      used.add(best);
    }
  }
  return tracks;
}

function rethrow(err: unknown): never {
  throw err instanceof SourceError ? new MetadataError(err.message) : err;
}

// Covers are only fetched from the hosts the searches above link to, so
// setCoverArt's url param can't be pointed at anything else.
const IMAGE_HOSTS = [/(^|\.)mzstatic\.com$/, /^coverartarchive\.org$/, /(^|\.)archive\.org$/];

export async function fetchCoverImage(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const allowed = (u: string) => {
    try {
      const parsed = new URL(u);
      return parsed.protocol === "https:" && IMAGE_HOSTS.some((h) => h.test(parsed.hostname));
    } catch {
      return false;
    }
  };
  if (!allowed(url)) throw new MetadataError("Cover URL not from a supported source");
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  } catch {
    throw new MetadataError("Couldn't download the cover");
  }
  // Cover Art Archive redirects to archive.org.
  if (!allowed(res.url || url)) throw new MetadataError("Cover URL not from a supported source");
  if (res.status === 404) throw new MetadataError("That match has no cover image");
  if (!res.ok) throw new MetadataError(`Couldn't download the cover (${res.status})`);
  const contentType = (res.headers.get("Content-Type") ?? "").split(";")[0].trim();
  if (!contentType.startsWith("image/")) throw new MetadataError("Cover URL isn't an image");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_COVER_BYTES) throw new MetadataError("Cover image too large (max 10 MB)");
  return { bytes, contentType };
}
