<script setup lang="ts">
import { useRoute } from "vue-router";
import UploadForm from "../components/UploadForm.vue";

// Arriving from Folders' "Upload here" button carries the current folder as
// a query param — UploadForm keeps it pinned across uploads.
const route = useRoute();
const presetFolder = typeof route.query.folder === "string" ? route.query.folder : "";
</script>

<template>
  <div class="mx-auto max-w-xl">
    <h1 class="mb-1 text-xl font-semibold">Upload</h1>
    <p class="mb-4 text-sm text-[var(--text-dim)]">
      Add a track to your library. Drop an audio file below or click to browse — title, artist, album and other
      tags are read automatically when available, so you'll usually just need to hit Upload.
    </p>

    <div class="glass p-4">
      <UploadForm :preset-folder="presetFolder" />
    </div>
  </div>
</template>
