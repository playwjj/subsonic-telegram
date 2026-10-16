<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from "vue";

export interface MenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
  // Draws a divider above this item.
  separated?: boolean;
}

const props = defineProps<{ x: number; y: number; items: MenuItem[] }>();
const emit = defineEmits<{ close: [] }>();

const menu = ref<HTMLElement | null>(null);
const pos = ref({ left: props.x, top: props.y });

// Flip back inside the viewport when opened near the right/bottom edge.
onMounted(async () => {
  await nextTick();
  const rect = menu.value?.getBoundingClientRect();
  if (!rect) return;
  pos.value = {
    left: Math.max(8, Math.min(props.x, window.innerWidth - rect.width - 8)),
    top: Math.max(8, Math.min(props.y, window.innerHeight - rect.height - 8)),
  };
});

function onOutside(e: Event) {
  if (!menu.value?.contains(e.target as Node)) emit("close");
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close");
}
const close = () => emit("close");

onMounted(() => {
  document.addEventListener("pointerdown", onOutside, true);
  document.addEventListener("keydown", onKeydown);
  window.addEventListener("scroll", close, true);
  window.addEventListener("resize", close);
});
onUnmounted(() => {
  document.removeEventListener("pointerdown", onOutside, true);
  document.removeEventListener("keydown", onKeydown);
  window.removeEventListener("scroll", close, true);
  window.removeEventListener("resize", close);
});

function choose(item: MenuItem) {
  if (item.disabled) return;
  emit("close");
  item.action();
}
</script>

<template>
  <Teleport to="body">
    <div ref="menu" class="context-menu" :style="{ left: `${pos.left}px`, top: `${pos.top}px` }" @contextmenu.prevent>
      <template v-for="item in items" :key="item.label">
        <hr v-if="item.separated" />
        <button class="option" :class="{ danger: item.danger }" :disabled="item.disabled" @click="choose(item)">
          {{ item.label }}
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 60;
  min-width: 12rem;
  padding: 0.35rem;
  background: rgba(23, 26, 33, 0.96);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.option {
  display: block;
  width: 100%;
  text-align: left;
  font-size: 0.875rem;
  padding: 0.4rem 0.6rem;
  background: none;
  border: none;
  border-radius: 6px;
}
.option:hover:not(:disabled) {
  background: var(--surface-hover);
}
.option.danger {
  color: var(--danger);
}
hr {
  margin: 0.3rem 0;
  border: none;
  border-top: 1px solid var(--border);
}
</style>
