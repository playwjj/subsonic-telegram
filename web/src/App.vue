<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import { isLoggedIn, logout } from "./stores/auth";
import { playerState, currentTrack } from "./stores/player";
import AppLogo from "./components/AppLogo.vue";
import PlayerBar from "./components/PlayerBar.vue";
import UploadPanel from "./components/upload/UploadPanel.vue";

// A file dropped anywhere that isn't a drop zone would make the browser
// open it, navigating away from the app (and any running uploads).
for (const type of ["dragover", "drop"]) {
  window.addEventListener(type, (e) => {
    if ((e as DragEvent).dataTransfer?.types.includes("Files")) e.preventDefault();
  });
}

const route = useRoute();
const router = useRouter();

const navLinks = [
  { to: "/", label: "Home" },
  { to: "/artists", label: "Artists" },
  { to: "/songs", label: "Songs" },
  { to: "/folders", label: "Folders" },
  { to: "/favorites", label: "Favorites" },
  { to: "/search", label: "Search" },
  { to: "/playlists", label: "Playlists" },
  { to: "/upload", label: "Upload" },
];

async function handleLogout() {
  logout();
  await router.push({ name: "login" });
}
</script>

<template>
  <div>
    <!-- Fixed aurora background: soft blurred gradient blobs behind everything. -->
    <div aria-hidden="true" class="fixed inset-0 -z-10 overflow-hidden bg-[var(--bg)]">
      <div class="absolute -top-40 -left-32 h-[34rem] w-[34rem] rounded-full bg-teal-500/20 blur-[110px]"></div>
      <div class="absolute top-1/4 -right-40 h-[38rem] w-[38rem] rounded-full bg-violet-500/20 blur-[120px]"></div>
      <div class="absolute bottom-[-10rem] left-1/4 h-[30rem] w-[30rem] rounded-full bg-pink-500/10 blur-[110px]"></div>
    </div>

    <nav
      v-if="isLoggedIn() && route.name !== 'login'"
      class="glass sticky top-0 z-20 mx-3 mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl px-4 py-3 sm:mx-4"
    >
      <RouterLink to="/" class="-my-1 mr-1 flex items-center gap-2 text-sm font-semibold text-[var(--text)]" title="Subsonic Telegram">
        <AppLogo class="h-7 w-7" :spinning="playerState.isPlaying" />
        <span class="max-[600px]:hidden">Subsonic Telegram</span>
      </RouterLink>
      <RouterLink
        v-for="link in navLinks"
        :key="link.to"
        :to="link.to"
        class="text-sm text-[var(--text-dim)] transition-colors hover:text-[var(--text)] [&.router-link-exact-active]:font-semibold [&.router-link-exact-active]:text-[var(--text)]"
      >
        {{ link.label }}
      </RouterLink>
      <button class="ml-auto border-none bg-transparent p-0 text-sm text-[var(--text-dim)] hover:bg-transparent hover:text-[var(--text)]" @click="handleLogout">
        Logout
      </button>
    </nav>

    <!-- Folders gets more room: it's a file manager with a sidebar tree. -->
    <main
      class="mx-auto px-4 py-5"
      :class="[route.name === 'folders' ? 'max-w-7xl' : 'max-w-5xl', { 'pb-24 max-[600px]:pb-32': isLoggedIn() && currentTrack && playerState.view === 'bar' }]"
    >
      <RouterView />
    </main>

    <UploadPanel v-if="isLoggedIn() && route.name !== 'login'" />
    <PlayerBar v-if="isLoggedIn() && route.name !== 'login'" />
  </div>
</template>
