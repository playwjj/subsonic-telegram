// iTunes Search API, called from the browser rather than the Worker: Apple
// rate-limits per IP, and Workers share their outgoing IPs with everyone
// else's, so from production most requests were refused, while the user's
// own browser gets through (Apple allows any origin). The answers are
// handed to the Worker (searchOnline / getOnlineAlbumTracks), which does
// the matching, scoring and traditional→simplified conversion for them
// along with MusicBrainz's.

// Only what src/subsonic/online.ts reads (ItunesItem), to keep the request
// to the Worker small.
const FIELDS = [
  "wrapperType",
  "collectionId",
  "collectionName",
  "artistName",
  "collectionArtistName",
  "trackName",
  "trackNumber",
  "discNumber",
  "trackCount",
  "trackTimeMillis",
  "releaseDate",
  "primaryGenreName",
  "artworkUrl100",
] as const;

type Item = Partial<Record<(typeof FIELDS)[number], unknown>>;

export interface ItunesBatch {
  country: string;
  results: Item[];
}

const RATE_LIMITED = "iTunes is rate-limiting, try again in a minute";

// Same choice as the Worker's storefronts() in src/subsonic/online.ts:
// tw, then hk only if tw has nothing (cn never answers these searches).
function storefronts(text: string): string[] {
  if (/[぀-ヿ]/.test(text)) return ["jp"];
  if (/[가-힯]/.test(text)) return ["kr"];
  if (/\p{Script=Han}/u.test(text)) return ["tw", "hk"];
  return ["us"];
}

async function get(url: string): Promise<Item[]> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error("iTunes unreachable");
  }
  // 403 or 429, depending on which of Apple's edges answers.
  if (res.status === 403 || res.status === 429) throw new Error(RATE_LIMITED);
  if (!res.ok) throw new Error(`iTunes error ${res.status}`);
  const data = (await res.json()) as { results?: Record<string, unknown>[] };
  return (data.results ?? []).map((r) => Object.fromEntries(FIELDS.filter((f) => f in r).map((f) => [f, r[f]])));
}

// Search results, or the error to pass on (the Worker reports it next to
// MusicBrainz's matches).
export async function itunesSearch(
  kind: "album" | "song",
  term: string,
): Promise<{ batches: ItunesBatch[]; error?: string }> {
  try {
    for (const country of storefronts(term)) {
      const results = await get(
        `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=${kind}&limit=10&country=${country}`,
      );
      if (results.length) return { batches: [{ country, results }] };
    }
    return { batches: [] };
  } catch (e) {
    return { batches: [], error: e instanceof Error ? e.message : String(e) };
  }
}

// An album's track list; `albumRef` is "<storefront>:<collectionId>".
export async function itunesAlbumTracks(albumRef: string): Promise<Item[]> {
  const [country, id] = albumRef.split(":");
  return get(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=song&country=${encodeURIComponent(country)}`);
}

// Covers on Apple's image CDN, downloaded here for the same reason; null
// when that doesn't work (the Worker then tries itself).
export async function fetchCoverBlob(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.type.startsWith("image/") ? blob : null;
  } catch {
    return null;
  }
}
