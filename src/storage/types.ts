// A storage backend turns bytes into an opaque, JSON-serializable ref string
// stored in D1 (tracks.file_ref / albums.cover_ref), and turns that ref back
// into an HTTP response (with Range support) on demand. Keeping this as the
// only surface the rest of the app talks to means swapping Telegram for R2/S3
// later only means writing a new class here — no schema or route changes.
export interface StorageBackend {
  // `caption`: text stored alongside the file where the backend can (a
  // Telegram message caption), so the storage stays readable on its own.
  putFile(bytes: Uint8Array, filename: string, mimeType: string, caption?: string): Promise<string>;
  getFileResponse(ref: string, rangeHeader: string | null, contentType?: string): Promise<Response>;
  deleteFile(ref: string): Promise<void>;
  // Bulk version of deleteFile for folder/multi-select deletes. Doesn't
  // throw on failure: reports which refs couldn't be deleted (and why) so the
  // caller can queue them for a retry.
  deleteFiles(refs: string[]): Promise<DeleteFilesResult>;
  // Whether a file can still be fetched (without downloading it).
  checkFile(ref: string): Promise<FileCheck>;
}

export type FileCheck = { ok: true; size?: number } | { ok: false; error: string };

// A backend that can also hand back a whole file's raw bytes in one shot.
// CachedStorage (cached.ts) needs this from whatever backend it wraps, to
// populate its cache on a miss — TelegramStorage implements it.
export interface SourceStorage extends StorageBackend {
  getFileBytes(ref: string, contentType?: string): Promise<{ bytes: Uint8Array; contentType: string }>;
}

export interface DeleteFilesResult {
  failed: string[];
  error?: string;
}
