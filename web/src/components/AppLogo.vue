<script setup lang="ts">
// The project logo: a simplified version of the full-screen player's
// cassette player. Inlined (rather than an <img>) so the reels can turn.
import logo from "../assets/logo.svg?raw";

defineProps<{ spinning?: boolean }>();
</script>

<template>
  <span class="app-logo" :class="{ spinning }" role="img" aria-label="Subgram" v-html="logo"></span>
</template>

<style scoped>
.app-logo {
  display: inline-block;
  line-height: 0;
}
.app-logo :deep(svg) {
  width: 100%;
  height: 100%;
}
.app-logo :deep(.reel) {
  transform-box: fill-box;
  transform-origin: center;
  animation: spin 2.4s linear infinite;
  animation-play-state: paused;
}
.app-logo.spinning :deep(.reel) {
  animation-play-state: running;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .app-logo :deep(.reel) {
    animation: none;
  }
}
</style>
