// Shared by every StorageBackend that serves bytes it already has in hand
// (as opposed to Telegram's file CDN, which doesn't reliably honor Range
// itself — see telegram.ts) into a proper 206 Partial Content response.

export interface ByteRange {
  start: number;
  end: number; // inclusive
}

// Parses a `Range: bytes=start-end` header against a known total length.
// Returns null for "no range requested" (caller should send the whole body).
export function parseRange(total: number, rangeHeader: string | null): ByteRange | null {
  const match = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader) : null;
  if (!match || !(match[1] || match[2])) return null;
  const start = match[1] ? Number(match[1]) : total - Number(match[2]);
  const end = match[1] && match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
  return { start, end };
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
