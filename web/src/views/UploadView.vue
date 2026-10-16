<script setup lang="ts">
import { ref } from "vue";
import { useRoute } from "vue-router";
import { MAX_UPLOAD_TRACK_BYTES } from "../api/subsonic";
import { defaultUploadFolder } from "../stores/uploads";
import { AUDIO_EXTENSIONS, fromDataTransfer, fromFileList, type PickedFile } from "../utils/pickFiles";
import UploadDialog from "../components/upload/UploadDialog.vue";

// `?folder=` pre-fills the destination; otherwise this month's Uploads
// folder, so uploads show up under Folders.
const route = useRoute();
const folder = typeof route.query.folder === "string" ? route.query.folder : defaultUploadFolder();

const picked = ref<PickedFile[] | null>(null);
const dragging = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const folderInput = ref<HTMLInputElement | null>(null);

function onPicked(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = fromFileList(input.files);
  input.value = "";
  if (files.length) picked.value = files;
}

async function onDrop(e: DragEvent) {
  dragging.value = false;
  if (!e.dataTransfer) return;
  const files = await fromDataTransfer(e.dataTransfer);
  if (files.length) picked.value = files;
}
</script>

<template>
  <div class="mx-auto max-w-xl">
    <h1 class="mb-1 text-xl font-semibold">Upload</h1>
    <p class="mb-4 text-sm text-[var(--text-dim)]">
      Drop audio files or whole folders below. Tags (title, artist, album…) are read automatically, folders keep their
      structure, and uploads continue in the background while you browse. To upload straight into a folder, use
      “Upload” on the Folders page instead — or drop files onto it.
    </p>

    <div
      class="dropzone glass"
      :class="{ dragging }"
      @click="fileInput?.click()"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <div class="dropzone-icon">⬆</div>
      <p class="font-medium">Drag and drop audio files or folders here</p>
      <p class="text-sm text-[var(--text-dim)]">
        or
        <button class="link" @click.stop="fileInput?.click()">choose files</button>
        /
        <button class="link" @click.stop="folderInput?.click()">choose a folder</button>
      </p>
      <p class="mt-2 text-xs text-[var(--text-dim)]">
        {{ AUDIO_EXTENSIONS.join(", ") }} · up to {{ Math.floor(MAX_UPLOAD_TRACK_BYTES / (1024 * 1024)) }}MB each
      </p>
      <input ref="fileInput" type="file" multiple :accept="AUDIO_EXTENSIONS.join(',')" hidden @change="onPicked" />
      <input ref="folderInput" type="file" webkitdirectory hidden @change="onPicked" />
    </div>

    <UploadDialog v-if="picked" :picked="picked" :folder="folder" @close="picked = null" />
  </div>
</template>

<style scoped>
.dropzone {
  cursor: pointer;
  border: 2px dashed var(--border);
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
.link {
  padding: 0;
  border: none;
  background: none;
  color: var(--accent);
  text-decoration: underline;
}
.link:hover {
  background: none;
}
</style>
