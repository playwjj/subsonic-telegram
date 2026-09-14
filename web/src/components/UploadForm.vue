<script setup lang="ts">
import { reactive, ref } from "vue";
import { uploadTrack, MAX_UPLOAD_TRACK_BYTES, SubsonicError, type Song } from "../api/subsonic";

const AUDIO_EXTENSIONS = [".mp3", ".flac", ".m4a", ".ogg", ".opus", ".wav"];

// Shared by the standalone Upload page and the "Upload here" modal opened
// from Folders — presetFolder pins the folder field so uploading several
// files in a row (via resetForm) stays targeted at the same place.
const props = defineProps<{ presetFolder?: string }>();
const emit = defineEmits<{ uploaded: [song: Song] }>();

const form = reactive({
  title: "",
  artist: "",
  album: "",
  year: undefined as number | undefined,
  genre: "",
  trackNumber: undefined as number | undefined,
  discNumber: undefined as number | undefined,
  folder: props.presetFolder ?? "",
});

const file = ref<File | null>(null);
const duration = ref<number | undefined>(undefined);
const bitrate = ref<number | undefined>(undefined);
const parsing = ref(false);
const uploading = ref(false);
const dragging = ref(false);
const error = ref("");
const uploaded = ref<Song | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

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
  form.folder = props.presetFolder ?? "";
  duration.value = undefined;
  bitrate.value = undefined;
}

async function loadFile(picked: File | null) {
  error.value = "";
  uploaded.value = null;
  file.value = null;
  if (!picked) return;

  const ext = extensionOf(picked.name);
  if (!AUDIO_EXTENSIONS.includes(ext)) {
    error.value = `Unsupported file type. Expected one of: ${AUDIO_EXTENSIONS.join(", ")}`;
    return;
  }
  if (picked.size > MAX_UPLOAD_TRACK_BYTES) {
    error.value = `File is too large (max ${Math.floor(MAX_UPLOAD_TRACK_BYTES / (1024 * 1024))}MB — Telegram's download limit).`;
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

function handleFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  loadFile(input.files?.[0] ?? null);
  input.value = "";
}

function handleDrop(e: DragEvent) {
  dragging.value = false;
  loadFile(e.dataTransfer?.files?.[0] ?? null);
}

function openPicker() {
  fileInput.value?.click();
}

async function submit() {
  if (!file.value) return;
  error.value = "";
  uploading.value = true;
  try {
    const song = await uploadTrack(file.value, {
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
    uploaded.value = song;
    file.value = null;
    resetForm();
    emit("uploaded", song);
  } catch (e) {
    error.value = e instanceof SubsonicError ? e.message : "Upload failed";
  } finally {
    uploading.value = false;
  }
}
</script>

<template>
  <div class="space-y-4">
    <div
      v-if="!file"
      class="dropzone"
      :class="{ dragging }"
      @click="openPicker"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="handleDrop"
    >
      <div class="dropzone-icon">⬆</div>
      <p class="font-medium">Drag and drop an audio file here</p>
      <p class="text-sm text-[var(--text-dim)]">or click to browse</p>
      <p class="mt-2 text-xs text-[var(--text-dim)]">
        {{ AUDIO_EXTENSIONS.join(", ") }} · up to {{ Math.floor(MAX_UPLOAD_TRACK_BYTES / (1024 * 1024)) }}MB
      </p>
      <input
        ref="fileInput"
        type="file"
        accept=".mp3,.flac,.m4a,.ogg,.opus,.wav"
        class="sr-only"
        @change="handleFileChange"
      />
    </div>

    <div v-else class="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
      <span class="truncate">🎵 {{ file.name }}</span>
      <button type="button" class="shrink-0" @click="file = null">Change file</button>
    </div>
    <p v-if="parsing" class="flex items-center gap-2 text-sm text-[var(--text-dim)]">
      <span class="spinner"></span> Reading tags…
    </p>

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

      <button type="submit" class="inline-flex items-center gap-2" :disabled="uploading">
        <span v-if="uploading" class="spinner"></span> {{ uploading ? "Uploading…" : "Upload" }}
      </button>
    </form>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="uploaded" class="text-sm">
      Uploaded "{{ uploaded.title }}" —
      <RouterLink :to="{ name: 'album', params: { id: uploaded.albumId } }" class="underline">view album</RouterLink>
    </p>
  </div>
</template>

<style scoped>
.dropzone {
  cursor: pointer;
  border: 2px dashed var(--border);
  border-radius: 16px;
  padding: 2.5rem 1.5rem;
  text-align: center;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease;
}
.dropzone:hover,
.dropzone.dragging {
  border-color: var(--accent);
  background: rgba(125, 211, 192, 0.06);
}
.dropzone-icon {
  margin-bottom: 0.5rem;
  font-size: 1.75rem;
  opacity: 0.8;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
