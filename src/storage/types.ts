// A storage backend turns bytes into an opaque, JSON-serializable ref string
// stored in D1 (tracks.file_ref / albums.cover_ref), and turns that ref back
// into an HTTP response (with Range support) on demand. Keeping this as the
// only surface the rest of the app talks to means swapping Telegram for R2/S3
// later only means writing a new class here — no schema or route changes.
export interface StorageBackend {
  putFile(bytes: Uint8Array, filename: string, mimeType: string): Promise<string>;
  getFileResponse(ref: string, rangeHeader: string | null, contentType?: string): Promise<Response>;
}
