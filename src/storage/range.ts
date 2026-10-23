// Shared by every StorageBackend that serves bytes it already has in hand
// (as opposed to Telegram's file CDN, which doesn't reliably honor Range
// itself — see telegram.ts) into a proper 206 Partial Content response.

export interface ByteRange {
  start: number;
  end: number; // inclusive
}

// Parses a `Range: bytes=start-end` header against a known total length.
// Returns null for "no range requested" (caller should send the whole body),
// "unsatisfiable" for a range that starts past the end (caller should answer
// 416 via rangeNotSatisfiable). A suffix longer than the file means all of it.
export function parseRange(total: number, rangeHeader: string | null): ByteRange | "unsatisfiable" | null {
  const match = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader) : null;
  if (!match || !(match[1] || match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (suffix === 0 || total === 0) return "unsatisfiable";
    return { start: Math.max(total - suffix, 0), end: total - 1 };
  }
  const start = Number(match[1]);
  // "500-100" isn't a valid range at all: ignored, like no Range header.
  if (match[2] && Number(match[2]) < start) return null;
  if (start >= total) return "unsatisfiable";
  return { start, end: match[2] ? Math.min(Number(match[2]), total - 1) : total - 1 };
}

export function rangeNotSatisfiable(total: number): Response {
  return new Response(null, { status: 416, headers: { "content-range": `bytes */${total}` } });
}

export function rangeHeaders(contentType: string, total: number, range: ByteRange | null): Headers {
  const headers = new Headers();
  headers.set("content-type", contentType);
  headers.set("accept-ranges", "bytes");
  if (range) {
    headers.set("content-length", String(range.end - range.start + 1));
    headers.set("content-range", `bytes ${range.start}-${range.end}/${total}`);
  } else {
    headers.set("content-length", String(total));
  }
  return headers;
}
