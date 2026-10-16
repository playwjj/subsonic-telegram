// Turns what the user picked or dropped — files, or whole folders — into a
// flat list of files, each with the folder it sat in relative to what was
// dropped ("Album/CD1" for Album/CD1/01.mp3 when "Album" was dropped), so a
// batch upload can recreate the structure under the target folder.

export interface PickedFile {
  file: File;
  relDir: string;
}

export const AUDIO_EXTENSIONS = [".mp3", ".flac", ".m4a", ".ogg", ".opus", ".wav"];

export function extensionOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx).toLowerCase();
}

export function isAudio(name: string): boolean {
  return AUDIO_EXTENSIONS.includes(extensionOf(name));
}

function dirOf(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(0, -1).join("/");
}

// <input type="file" multiple> or <input webkitdirectory>; the latter fills
// in webkitRelativePath ("Album/CD1/01.mp3").
export function fromFileList(list: FileList | null): PickedFile[] {
  return [...(list ?? [])].map((file) => ({ file, relDir: dirOf(file.webkitRelativePath || file.name) }));
}

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  // readEntries hands back at most ~100 entries per call — keep calling
  // until it returns an empty batch.
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const next = () =>
      reader.readEntries((batch) => {
        if (!batch.length) return resolve(all);
        all.push(...batch);
        next();
      }, reject);
    next();
  });
}

async function walk(entry: FileSystemEntry, out: PickedFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ file, relDir: dirOf(entry.fullPath) });
  } else if (entry.isDirectory) {
    for (const child of await readAllEntries((entry as FileSystemDirectoryEntry).createReader())) await walk(child, out);
  }
}

// A drop from the OS. Folders are only reachable through the entries API,
// which has to be read synchronously during the drop event — so grab every
// entry up front, then walk them.
export async function fromDataTransfer(dt: DataTransfer): Promise<PickedFile[]> {
  const entries = [...dt.items]
    .filter((item) => item.kind === "file")
    .map((item) => item.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return fromFileList(dt.files);
  const out: PickedFile[] = [];
  for (const entry of entries) await walk(entry, out);
  return out;
}

// Whether a drag carries files from the OS (as opposed to rows dragged
// within the page).
export function isFileDrag(e: DragEvent): boolean {
  return !!e.dataTransfer?.types.includes("Files");
}
