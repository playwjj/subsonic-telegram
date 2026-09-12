<script setup lang="ts">
import { reactive, ref } from "vue";
import { uploadTrack, MAX_UPLOAD_TRACK_BYTES, SubsonicError, type Song } from "../api/subsonic";

const AUDIO_EXTENSIONS = [".mp3", ".flac", ".m4a", ".ogg", ".opus", ".wav"];

const form = reactive({
  title: "",
  artist: "",
  album: "",
  year: undefined as number | undefined,
  genre: "",
  trackNumber: undefined as number | undefined,
  discNumber: undefined as number | undefined,
  folder: "",
});

const file = ref<File | null>(null);
const duration = ref<number | undefined>(undefined);
const bitrate = ref<number | undefined>(undefined);
const parsing = ref(false);
const uploading = ref(false);
const error = ref("");
const uploaded = ref<Song | null>(null);

function extensionOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx).toLowerCase();
}

function resetForm() {
  form.title = "";
  form.artist = "";
  form.album = "";
  form.year = undefined;
  form.genre = "";
  form.trackNumber = undefined;
  form.discNumber = undefined;
  form.folder = "";
  duration.value = undefined;
  bitrate.value = undefined;
}

async function handleFileChange(e: Event) {
  error.value = "";
  uploaded.value = null;
  const input = e.target as HTMLInputElement;
  const picked = input.files?.[0] ?? null;
  file.value = null;
  if (!picked) return;

  const ext = extensionOf(picked.name);
  if (!AUDIO_EXTENSIONS.includes(ext)) {
    error.value = `Unsupported file type. Expected one of: ${AUDIO_EXTENSIONS.join(", ")}`;
    input.value = "";
    return;
  }
  if (picked.size > MAX_UPLOAD_TRACK_BYTES) {
    error.value = `File is too large (max ${Math.floor(MAX_UPLOAD_TRACK_BYTES / (1024 * 1024))}MB — Telegram's download limit).`;
    input.value = "";
    return;
  }

  file.value = picked;
  resetForm();
  form.title = picked.name.slice(0, picked.name.length - ext.length);

  // Tag parsing is a convenience, not a requirement — leave whatever's
  // already prefilled (just the title, from the filename) and let the user
  // fill in the rest by hand if this fails or the file has no tags.
  parsing.value = true;
  try {
    const { parseBlob } = await import("music-metadata");
    const meta = await parseBlob(picked);
    const common = meta.common;
    if (common.title) form.title = common.title;
    if (common.albumartist || common.artist) form.artist = common.albumartist || common.artist || "";
    if (common.album) form.album = common.album;
    if (common.year) form.year = common.year;
    if (common.genre?.[0]) form.genre = common.genre[0];
    if (common.track?.no) form.trackNumber = common.track.no;
    if (common.disk?.no) form.discNumber = common.disk.no;
    if (meta.format.duration) duration.value = Math.round(meta.format.duration);
    if (meta.format.bitrate) bitrate.value = Math.round(meta.format.bitrate / 1000);
  } catch {
    // no-op, see comment above
  } finally {
    parsing.value = false;
  }
}

async function submit() {
  if (!file.value) return;
  error.value = "";
  uploading.value = true;
  try {
    uploaded.value = await uploadTrack(file.value, {
      title: form.title,
      artist: form.artist,
      album: form.album,
      year: form.year,
      genre: form.genre || undefined,
      trackNumber: form.trackNumber,
      discNumber: form.discNumber,
      duration: duration.value,
      bitrate: bitrate.value,
      folder: form.folder || undefined,
    });
    file.value = null;
    resetForm();
  } catch (e) {
    error.value = e instanceof SubsonicError ? e.message : "Upload failed";
  } finally {
    uploading.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-xl">
    <h1 class="mb-4 text-xl font-semibold">Upload</h1>

    <div class="glass space-y-4 p-4">
      <div>
        <input type="file" accept=".mp3,.flac,.m4a,.ogg,.opus,.wav" @change="handleFileChange" />
        <p v-if="parsing" class="mt-1 text-sm text-[var(--text-dim)]">Reading tags…</p>
      </div>

      <form v-if="file" class="space-y-3" @submit.prevent="submit">
        <label class="block text-sm">
          Title
          <input v-model="form.title" required class="mt-1 w-full" />
        </label>
        <label class="block text-sm">
          Artist
          <input v-model="form.artist" required class="mt-1 w-full" />
        </label>
        <label class="block text-sm">
          Album
          <input v-model="form.album" required class="mt-1 w-full" />
        </label>
        <div class="flex gap-3">
          <label class="block flex-1 text-sm">
            Year
            <input v-model.number="form.year" type="number" class="mt-1 w-full" />
          </label>
          <label class="block flex-1 text-sm">
            Genre
            <input v-model="form.genre" class="mt-1 w-full" />
          </label>
        </div>
        <div class="flex gap-3">
          <label class="block flex-1 text-sm">
            Track #
            <input v-model.number="form.trackNumber" type="number" class="mt-1 w-full" />
          </label>
          <label class="block flex-1 text-sm">
            Disc #
            <input v-model.number="form.discNumber" type="number" class="mt-1 w-full" />
          </label>
        </div>
        <label class="block text-sm">
          Folder <span class="text-[var(--text-dim)]">(optional — shows up under Folders if set, e.g. "80s/Rock")</span>
          <input v-model="form.folder" placeholder="80s/Rock" class="mt-1 w-full" />
        </label>

        <button type="submit" :disabled="uploading">{{ uploading ? "Uploading…" : "Upload" }}</button>
      </form>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="uploaded" class="text-sm">
        Uploaded "{{ uploaded.title }}" —
        <RouterLink :to="{ name: 'album', params: { id: uploaded.albumId } }" class="underline">view album</RouterLink>
      </p>
    </div>
  </div>
</template>
