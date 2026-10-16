<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { coverArtUrl, getTrackStorage, type FolderDir, type Song, type TrackStorage } from "../../api/subsonic";
import { baseName, formatBytes, formatDate, formatDuration, parentOf } from "../../utils/format";
import Modal from "../Modal.vue";

const props = defineProps<{ song?: Song; folder?: FolderDir & { path: string } }>();
const emit = defineEmits<{ close: [] }>();

const storage = ref<TrackStorage | null>(null);
const storageError = ref(false);

onMounted(async () => {
  if (!props.song) return;
  try {
    storage.value = await getTrackStorage(props.song.id);
  } catch {
    storageError.value = true;
  }
});

const rows = computed<[string, string | undefined][]>(() => {
  const s = props.song;
  if (s) {
    return [
      ["File name", s.path ? baseName(s.path) : undefined],
      ["Folder", s.path ? parentOf(s.path) || "(root)" : "(not in a folder)"],
      ["Title", s.title],
      ["Artist", s.artist],
      ["Album", s.album],
      ["Year", s.year?.toString()],
      ["Genre", s.genre],
      ["Track / disc", s.track ? `${s.track}${s.discNumber ? ` / ${s.discNumber}` : ""}` : undefined],
      ["Duration", formatDuration(s.duration)],
      ["Size", `${formatBytes(s.size)} (${s.size.toLocaleString()} bytes)`],
      ["Format", `${s.suffix.toUpperCase()} · ${s.contentType}${s.bitRate ? ` · ${s.bitRate} kbps` : ""}`],
      ["Added", formatDate(s.created)],
      ["Plays", `${s.playCount ?? 0}${s.played ? ` · last ${formatDate(s.played)}` : ""}`],
      ["Rating", s.userRating ? "★".repeat(s.userRating) : undefined],
    ];
  }
  const f = props.folder!;
  return [
    ["Path", f.path],
    ["Songs", f.songCount.toLocaleString()],
    ["Size", formatBytes(f.size)],
    ["Total length", formatDuration(f.duration)],
  ];
});
</script>

<template>
  <Modal :title="song ? song.title : folder?.name" @close="emit('close')">
    <div class="flex gap-4">
      <img v-if="song" :src="coverArtUrl(song.coverArt)" class="h-20 w-20 shrink-0 rounded-lg object-cover" alt="" />
      <div v-else class="text-5xl">📁</div>
    </div>
    <dl class="mt-4 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-sm">
      <template v-for="[label, value] in rows" :key="label">
        <template v-if="value">
          <dt class="text-[var(--text-dim)]">{{ label }}</dt>
          <dd class="break-all">{{ value }}</dd>
        </template>
      </template>
      <template v-if="song">
        <dt class="text-[var(--text-dim)]">Telegram</dt>
        <dd>
          <span v-if="storageError" class="text-[var(--text-dim)]">unavailable</span>
          <span v-else-if="!storage" class="spinner"></span>
          <template v-else>
            <a v-if="storage.link" :href="storage.link" target="_blank" rel="noopener" class="underline">
              message #{{ storage.messageId }}
            </a>
            <span v-else>message #{{ storage.messageId }}</span>
          </template>
        </dd>
        <template v-if="storage && storage.cached !== undefined">
          <dt class="text-[var(--text-dim)]">R2 cache</dt>
          <dd>{{ storage.cached ? "Cached" : "Not cached" }}</dd>
        </template>
      </template>
    </dl>
  </Modal>
</template>
