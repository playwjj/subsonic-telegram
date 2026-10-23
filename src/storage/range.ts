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

// The requested part of a file whose bytes arrive as a stream from offset 0
// (Telegram's file CDN, see telegram.ts): bytes before the range are
// dropped as they pass, and reading stops once the range is complete — so
// playback starts on the first chunk instead of after the whole download.
export function rangeResponse(
  body: ReadableStream<Uint8Array>,
  total: number,
  contentType: string,
  rangeHeader: string | null,
): Response {
  const range = parseRange(total, rangeHeader);
  if (range === "unsatisfiable") {
    void body.cancel();
    return rangeNotSatisfiable(total);
  }
  const length = range ? range.end - range.start + 1 : total;
  const part = range ? sliceStream(body, range.start, range.end) : body;
  // FixedLengthStream so the response carries Content-Length, not chunked
  // encoding — players need it to know how far they can seek.
  return new Response(part.pipeThrough(new FixedLengthStream(length)), {
    status: range ? 206 : 200,
    headers: rangeHeaders(contentType, total, range),
  });
}

function sliceStream(body: ReadableStream<Uint8Array>, start: number, end: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const from = Math.max(start - offset, 0);
        const to = Math.min(end + 1 - offset, chunk.byteLength);
        offset += chunk.byteLength;
        if (from < to) controller.enqueue(chunk.subarray(from, to));
        if (offset > end) controller.terminate();
      },
    }),
  );
}
