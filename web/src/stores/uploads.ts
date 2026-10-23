// The batch upload queue. Lives outside any view so uploads keep going while
// the user browses elsewhere; UploadPanel shows it, UploadDialog fills it.
import { computed, reactive } from "vue";
import { setCoverArt, uploadTrack, UploadError, MAX_UPLOAD_TRACK_BYTES, type Song, type UploadTrackMetadata } from "../api/subsonic";
import { baseName, joinPath } from "../utils/format";
import { prepareCover } from "../utils/image";
import { extensionOf, isAudio, type PickedFile } from "../utils/pickFiles";

// Two at a time: enough to overlap one file's trip to the Worker with the
// other's trip on to Telegram. More would mostly just hit Telegram's limit
// of ~20 messages a minute per channel sooner.
const CONCURRENCY = 2;

export interface Tags {
  title?: string;
  artist?: string;
  album?: string;
  year?: number;
  genre?: string;
  trackNumber?: number;
  discNumber?: number;
  duration?: number;
  bitrate?: number;
}

// Applied to every file of a batch, over what its tags say.
export interface Overrides {
  artist?: string;
  album?: string;
  genre?: string;
  year?: number;
}

export type UploadStatus =
  | "staged" // in the upload dialog, not queued yet
  | "queued"
  | "uploading" // bytes going to the Worker
  | "processing" // Worker passing it on to Telegram
  | "done"
  | "skipped" // a same-named file was already there
  | "failed"
  | "cancelled";

export interface UploadItem {
  id: number;
  file: File;
  // Folder relative to the batch's target (from a dropped folder's structure).
  relDir: string;
  // Final destination, set when queued.
  folder: string;
  tags: Tags | null; // null until read
  // Why it can't be uploaded at all (too large); such items are never queued.
  invalid?: string;
  status: UploadStatus;
  progress: number;
  error?: string;
  song?: Song;
  overrides?: Overrides;
  onConflict?: "rename" | "skip";
}

export const uploads = reactive({
  items: [] as UploadItem[],
  // Telegram said to slow down: nothing starts before this (ms timestamp).
  pausedUntil: 0,
  // Bumped after each finished upload; views watch it to refresh.
  completed: 0,
});

export const activeCount = computed(
  () => uploads.items.filter((i) => i.status === "queued" || i.status === "uploading" || i.status === "processing").length,
);

// Where a file goes when nothing else says: dropped loose at the root, or
// from the Upload page without a folder. A folder per month keeps uploads
// visible under Folders instead of in no folder at all.
export function defaultUploadFolder(now = new Date()): string {
  return `Uploads/${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

let nextId = 1;

// Non-audio files (cover.jpg, .lrc, .cue…) that came along with a dropped
// folder are dropped here and only counted.
export function stage(picked: PickedFile[]): { items: UploadItem[]; ignored: number } {
  const audio = picked.filter((p) => isAudio(p.file.name));
  const items = audio.map<UploadItem>((p) =>
    reactive({
      id: nextId++,
      file: p.file,
      relDir: p.relDir,
      folder: "",
      tags: null,
      invalid:
        p.file.size > MAX_UPLOAD_TRACK_BYTES
          ? `Too large (max ${Math.floor(MAX_UPLOAD_TRACK_BYTES / (1024 * 1024))} MB, Telegram's download limit)`
          : undefined,
      status: "staged",
      progress: 0,
    }) as UploadItem,
  );
  return { items, ignored: picked.length - audio.length };
}

// Tags are a convenience, never a requirement: on failure the upload just
// falls back to the file name / folder name (see metadataFor).
export async function readTags(item: UploadItem): Promise<void> {
  if (item.tags) return;
  try {
    const { parseBlob } = await import("music-metadata");
    const { common, format } = await parseBlob(item.file, { skipCovers: true });
    item.tags = {
      title: common.title,
      artist: common.albumartist || common.artist,
      album: common.album,
      year: common.year,
      genre: common.genre?.[0],
      trackNumber: common.track?.no ?? undefined,
      discNumber: common.disk?.no ?? undefined,
      duration: format.duration ? Math.round(format.duration) : undefined,
      bitrate: format.bitrate ? Math.round(format.bitrate / 1000) : undefined,
    };
  } catch {
    item.tags = {};
  }
}

export function stem(name: string): string {
  const ext = extensionOf(name);
  return ext ? name.slice(0, -ext.length) : name;
}

// Album name for a file without an album tag: the folder it's in, skipping
// disc folders ("CD1", "Disc 2") in favor of their parent, and never the
// automatic Uploads/YYYY-MM folder (a month isn't an album).
function albumFromFolder(folder: string): string | undefined {
  if (!folder || /^Uploads\/\d{4}-\d{2}$/.test(folder)) return undefined;
  const segments = folder.split("/");
  while (segments.length > 1 && /^(cd|disc|disk)\s*\d+$/i.test(segments[segments.length - 1])) segments.pop();
  return baseName(segments.join("/"));
}

function metadataFor(item: UploadItem): UploadTrackMetadata {
  const t = item.tags ?? {};
  const o = item.overrides ?? {};
  return {
    title: t.title || stem(item.file.name),
    artist: o.artist || t.artist || "Unknown Artist",
    album: o.album || t.album || albumFromFolder(item.folder) || "Unknown Album",
    year: o.year ?? t.year,
    genre: o.genre || t.genre,
    trackNumber: t.trackNumber,
    discNumber: t.discNumber,
    duration: t.duration,
    bitrate: t.bitrate,
    folder: item.folder,
    onConflict: item.onConflict,
  };
}

export function enqueue(
  items: UploadItem[],
  opts: { folder: string; overrides: Overrides; onConflict: "rename" | "skip" },
): void {
  for (const item of items) {
    if (item.invalid) continue;
    item.folder = joinPath(opts.folder, item.relDir) || defaultUploadFolder();
    item.overrides = opts.overrides;
    item.onConflict = opts.onConflict;
    item.status = "queued";
    uploads.items.push(item);
  }
  pump();
}

const aborts = new Map<number, () => void>();
let running = 0;
let resumeTimer: ReturnType<typeof setTimeout> | undefined;

function pump() {
  const wait = uploads.pausedUntil - Date.now();
  if (wait > 0) {
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(pump, wait);
    return;
  }
  while (running < CONCURRENCY) {
    const item = uploads.items.find((i) => i.status === "queued");
    if (!item) return;
    running++;
    void run(item).finally(() => {
      running--;
      pump();
    });
  }
}

async function run(item: UploadItem) {
  item.status = "uploading";
  item.progress = 0;
  item.error = undefined;
  await readTags(item);
  if (item.status !== "uploading") return; // cancelled while reading tags

  const { done, abort } = uploadTrack(item.file, metadataFor(item), (fraction) => {
    item.progress = fraction;
    if (fraction >= 1 && item.status === "uploading") item.status = "processing";
  });
  aborts.set(item.id, abort);
  try {
    item.song = await done;
    item.status = "done";
    uploads.completed++;
    // Still holding this upload slot: the cover is one more Telegram message.
    await addEmbeddedCover(item, item.song);
  } catch (e) {
    // cancel() may have flipped it meanwhile (TS can't see that across the await).
    if ((item.status as UploadStatus) === "cancelled") return;
    if (e instanceof UploadError && e.retryAfter) {
      // Back in line (it's still first among the queued) and hold the whole
      // queue: the limit is per channel, so every upload would hit it.
      item.status = "queued";
      item.progress = 0;
      uploads.pausedUntil = Math.max(uploads.pausedUntil, Date.now() + e.retryAfter * 1000 + 500);
    } else if (e instanceof UploadError && e.exists) {
      item.status = "skipped";
      item.error = "Already exists";
    } else {
      item.status = "failed";
      item.error = e instanceof Error ? e.message : String(e);
    }
  } finally {
    aborts.delete(item.id);
  }
}

// Albums this page has already given (or tried to give) an embedded cover,
// so a 12-track album sends its picture once, not 12 times.
const coveredAlbums = new Set<string>();

// The file's embedded front cover becomes its album's cover, unless the
// album already has one (onlyIfMissing, checked by the Worker). Only for a
// real album (from the tags or the batch's album override), not one named
// after a folder: a folder of loose songs would get whichever song's
// picture came first. Best effort — the song itself is already uploaded.
async function addEmbeddedCover(item: UploadItem, song: Song): Promise<void> {
  if (!(item.overrides?.album || item.tags?.album) || coveredAlbums.has(song.albumId)) return;
  coveredAlbums.add(song.albumId);
  try {
    const { parseBlob } = await import("music-metadata");
    const { common } = await parseBlob(item.file, { skipPostHeaders: true });
    const pictures = common.picture ?? [];
    const picture = pictures.find((p) => p.type === "Cover (front)") ?? pictures[0];
    // "AutoGenerated": placeholder art some tagging tools write (see
    // scripts/import.ts), worse than none.
    if (!picture || picture.description === "AutoGenerated") return;
    const type = picture.format.startsWith("image/") ? picture.format : "image/jpeg";
    const blob = await prepareCover(new Blob([new Uint8Array(picture.data)], { type }));
    await setCoverArt(song.albumId, blob, { onlyIfMissing: true });
  } catch {
    // Unreadable picture, Telegram's rate limit…: the song just goes
    // without, as before. Let a later song of the album try again.
    coveredAlbums.delete(song.albumId);
  }
}

export function cancel(item: UploadItem): void {
  if (item.status !== "queued" && item.status !== "uploading" && item.status !== "processing") return;
  item.status = "cancelled";
  aborts.get(item.id)?.();
}

export function cancelAll(): void {
  for (const item of uploads.items) cancel(item);
}

export function retry(item: UploadItem): void {
  if (item.status !== "failed" && item.status !== "cancelled") return;
  item.status = "queued";
  item.error = undefined;
  pump();
}

export function retryFailed(): void {
  for (const item of uploads.items) if (item.status === "failed") item.status = "queued";
  pump();
}

export function clearFinished(): void {
  uploads.items = uploads.items.filter((i) => i.status === "queued" || i.status === "uploading" || i.status === "processing");
}

// Closing the tab mid-batch would silently drop the rest.
window.addEventListener("beforeunload", (e) => {
  if (activeCount.value) e.preventDefault();
});
