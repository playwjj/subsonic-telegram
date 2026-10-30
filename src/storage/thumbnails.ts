// Covers at the size they're shown, not as uploaded: embedded art is
// often 1200px and several hundred KB, while a list shows it at ~110px —
// a home page of full-size covers is megabytes on a slow connection.
//
// Resized with the Images binding (IMAGES in wrangler.toml) and kept in R2
// next to the cached songs, so each cover is resized at most once per size.
// The free plan allows 5,000 unique resizes a month; past that (or on any
// other failure) the original is served, and not stored, so it's resized
// once the quota is back.

// Requested sizes snap up to one of these, so a cover never costs more
// than two resizes. Only an explicit size above them gets the original: a
// client that doesn't say (or says nonsense) gets the largest, which is
// plenty for any screen it shows a cover on.
const THUMB_SIZES = [300, 600];

export function thumbWidth(requested: string | null): number | null {
  const size = Number(requested);
  if (!requested || !Number.isFinite(size) || size <= 0) return THUMB_SIZES[THUMB_SIZES.length - 1];
  return THUMB_SIZES.find((w) => size <= w) ?? null;
}

// R2 keys of a cover's resized copies; `baseKey` is its cacheKey().
export function thumbKeys(baseKey: string): string[] {
  return THUMB_SIZES.map((w) => thumbKey(baseKey, w));
}

function thumbKey(baseKey: string, width: number): string {
  return `thumb/${baseKey}/${width}`;
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new Response(bytes).body!;
}

// The cover at `width`, from R2 or resized from `original` (fetched only on
// a miss). null when the original can't be had either.
export async function thumbnail(
  images: ImagesBinding,
  bucket: R2Bucket | undefined,
  ctx: ExecutionContext,
  baseKey: string,
  width: number,
  original: () => Promise<Response>,
): Promise<Response | null> {
  const key = thumbKey(baseKey, width);
  const stored = await bucket?.get(key);
  if (stored) {
    return new Response(stored.body, {
      headers: { "content-type": stored.httpMetadata?.contentType ?? "image/webp" },
    });
  }

  const source = await original();
  if (!source.ok) return null;
  const sourceType = source.headers.get("content-type") ?? "image/jpeg";
  const bytes = new Uint8Array(await source.arrayBuffer());

  let out: { bytes: Uint8Array; type: string } | null = null;
  try {
    const info = await images.info(streamOf(bytes)); // free, unlike a resize
    if (!("width" in info) || info.width <= width) {
      out = { bytes, type: sourceType }; // already small enough (or SVG)
    } else {
      const result = await images
        .input(streamOf(bytes))
        .transform({ width, height: width, fit: "scale-down" })
        .output({ format: "image/webp", quality: 82 });
      out = { bytes: new Uint8Array(await new Response(result.image()).arrayBuffer()), type: result.contentType() };
    }
  } catch (err) {
    console.warn(`Cover resize failed, serving the original: ${err}`);
  }

  if (!out) return new Response(bytes, { headers: { "content-type": sourceType } });
  if (bucket) {
    ctx.waitUntil(
      bucket
        .put(key, out.bytes, { httpMetadata: { contentType: out.type } })
        .catch((err) => console.warn(`Storing resized cover failed: ${err}`)),
    );
  }
  return new Response(out.bytes, { headers: { "content-type": out.type } });
}
