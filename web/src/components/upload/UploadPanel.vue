<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import {
  activeCount,
  cancel,
  cancelAll,
  clearFinished,
  retry,
  retryFailed,
  uploads,
  type UploadItem,
} from "../../stores/uploads";
import { formatBytes } from "../../utils/format";

// Floating progress panel for the batch upload queue (stores/uploads.ts).
// Mounted once in App.vue, so it stays put while the user browses.
const collapsed = ref(false);

const counts = computed(() => {
  const c = { done: 0, failed: 0, skipped: 0, cancelled: 0 };
  for (const i of uploads.items) if (i.status in c) c[i.status as keyof typeof c]++;
  return c;
});

const title = computed(() => {
  const total = uploads.items.length;
  const finished = total - activeCount.value;
  if (activeCount.value) return `Uploading — ${finished} of ${total} finished`;
  const parts = [`${counts.value.done} uploaded`];
  if (counts.value.skipped) parts.push(`${counts.value.skipped} skipped`);
  if (counts.value.failed) parts.push(`${counts.value.failed} failed`);
  return parts.join(" · ");
});

// Countdown while Telegram's rate limit holds the queue.
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | undefined;
watch(
  () => uploads.pausedUntil,
  (until) => {
    clearInterval(ticker);
    if (until <= Date.now()) return;
    now.value = Date.now();
    ticker = setInterval(() => {
      now.value = Date.now();
      if (now.value >= until) clearInterval(ticker);
    }, 1000);
  },
);
onUnmounted(() => clearInterval(ticker));
const waitSeconds = computed(() => Math.max(0, Math.ceil((uploads.pausedUntil - now.value) / 1000)));

function statusText(item: UploadItem): string {
  switch (item.status) {
    case "queued":
      return "Waiting";
    case "uploading":
      return item.progress ? `${Math.round(item.progress * 100)}%` : "Starting…";
    case "processing":
      return "Sending to Telegram…";
    case "done":
      return (
        (item.song && item.song.path && !item.song.path.endsWith(`/${item.file.name}`) ? "Done (renamed)" : "Done") +
        (item.note ? ` · ${item.note}` : "")
      );
    case "skipped":
      return "Skipped — already exists";
    case "cancelled":
      return "Cancelled";
    default:
      return item.error ?? "Failed";
  }
}

// Newest work first: what's running, then what's queued, then the rest.
const ORDER: Record<string, number> = { uploading: 0, processing: 0, queued: 1, failed: 2 };
const sortedItems = computed(() =>
  [...uploads.items].sort((a, b) => (ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3)),
);
</script>

<template>
  <div v-if="uploads.items.length" class="upload-panel glass">
    <div class="header">
      <span v-if="activeCount" class="spinner"></span>
      <span class="truncate font-medium">{{ title }}</span>
      <button class="icon" :title="collapsed ? 'Expand' : 'Collapse'" @click="collapsed = !collapsed">
        {{ collapsed ? "▴" : "▾" }}
      </button>
      <button v-if="!activeCount" class="icon" title="Close" @click="clearFinished">✕</button>
    </div>
    <div v-if="activeCount" class="overall">
      <div class="bar" :style="{ width: `${((uploads.items.length - activeCount) / uploads.items.length) * 100}%` }"></div>
    </div>
    <p v-if="waitSeconds && activeCount" class="notice">
      Telegram rate limit — resuming in {{ waitSeconds }}s
    </p>

    <template v-if="!collapsed">
      <div class="items">
        <div v-for="item in sortedItems" :key="item.id" class="item" :class="item.status">
          <div class="min-w-0 flex-1">
            <div class="truncate">{{ item.file.name }}</div>
            <div class="status truncate" :title="item.error">
              {{ statusText(item) }} <span class="dim">· {{ formatBytes(item.file.size) }} · {{ item.folder }}</span>
            </div>
            <div v-if="item.status === 'uploading'" class="progress">
              <div class="bar" :style="{ width: `${item.progress * 100}%` }"></div>
            </div>
          </div>
          <button
            v-if="item.status === 'queued' || item.status === 'uploading' || item.status === 'processing'"
            class="icon"
            title="Cancel"
            @click="cancel(item)"
          >
            ✕
          </button>
          <button v-else-if="item.status === 'failed'" class="icon" title="Retry" @click="retry(item)">↻</button>
          <span v-else-if="item.status === 'done'" class="ok">✓</span>
        </div>
      </div>
      <div class="footer">
        <button v-if="counts.failed" @click="retryFailed">Retry failed</button>
        <button v-if="activeCount" @click="cancelAll">Cancel all</button>
        <button v-if="uploads.items.length > activeCount" @click="clearFinished">Clear finished</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.upload-panel {
  position: fixed;
  right: 1rem;
  bottom: 6.5rem;
  z-index: 35;
  width: 24rem;
  max-width: calc(100vw - 1rem);
  font-size: 0.8rem;
  background: rgba(23, 26, 33, 0.96);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}
@media (max-width: 600px) {
  .upload-panel {
    right: 0.5rem;
    left: 0.5rem;
    width: auto;
    bottom: 8.5rem;
  }
}
.header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  font-size: 0.875rem;
}
.header .truncate {
  flex: 1;
}
.icon {
  width: 1.6rem;
  height: 1.6rem;
  padding: 0;
  border-radius: 50%;
  flex-shrink: 0;
  font-size: 0.75rem;
}
.overall,
.progress {
  height: 3px;
  background: rgba(255, 255, 255, 0.08);
}
.progress {
  margin-top: 0.3rem;
  border-radius: 2px;
  overflow: hidden;
}
.bar {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s ease;
}
.notice {
  padding: 0.4rem 0.75rem;
  color: var(--accent);
}
.items {
  max-height: 16rem;
  overflow-y: auto;
  border-top: 1px solid var(--border);
}
.item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.75rem;
}
.item + .item {
  border-top: 1px solid var(--border);
}
.status {
  color: var(--text-dim);
}
.item.failed .status {
  color: var(--danger);
}
.item.done,
.item.skipped,
.item.cancelled {
  opacity: 0.6;
}
.dim {
  opacity: 0.7;
}
.ok {
  color: var(--accent);
  width: 1.6rem;
  text-align: center;
}
.footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--border);
}
.footer:empty {
  display: none;
}
.footer button {
  padding: 0.25rem 0.6rem;
  font-size: 0.8rem;
}
</style>
