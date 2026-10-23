<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { isLoggedIn, logout } from "./stores/auth";
import { playerState, currentTrack } from "./stores/player";
import AppLogo from "./components/AppLogo.vue";
import PlayerBar from "./components/PlayerBar.vue";
import UploadPanel from "./components/upload/UploadPanel.vue";
import TagEditorDialog from "./components/TagEditorDialog.vue";
import { songEdits, songSaved } from "./stores/songEdits";

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

// The phone nav scrolls sideways, so bring the current page's link into view
// (e.g. after following an in-page link to Playlists).
const linksEl = ref<HTMLElement | null>(null);
watch(
  () => route.path,
  async () => {
    await nextTick();
    linksEl.value?.querySelector(".router-link-active")?.scrollIntoView({ block: "nearest", inline: "center" });
  },
);

// A thin bar along the top while a page is being opened, so a slow
// connection reads as "loading" rather than "the click did nothing". Only
// shown past a short delay, so instant navigations don't flash it.
const navigating = ref(false);
let navTimer: ReturnType<typeof setTimeout> | undefined;
router.beforeEach(() => {
  clearTimeout(navTimer);
  navTimer = setTimeout(() => (navigating.value = true), 120);
});
function navDone() {
  clearTimeout(navTimer);
  navigating.value = false;
}
router.afterEach(navDone);
router.onError(navDone);

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

    <div v-if="navigating" class="nav-progress" aria-hidden="true"></div>

    <!-- One row at every width: on phones the links scroll sideways (with a
         faded right edge as the hint) instead of wrapping into a second row. -->
    <nav
      v-if="isLoggedIn() && route.name !== 'login'"
      class="glass sticky top-2 z-20 mx-3 mt-3 flex items-center gap-3 rounded-2xl bg-[rgba(23,26,33,0.85)] px-3 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.35)] sm:mx-4 sm:gap-5 sm:px-4 sm:py-3"
    >
      <RouterLink to="/" class="-my-1 flex shrink-0 items-center gap-2 text-sm font-semibold text-[var(--text)]" title="Subgram">
        <AppLogo class="h-7 w-7" :spinning="playerState.isPlaying" />
        <span class="max-[760px]:hidden">Subgram</span>
      </RouterLink>
      <div
        ref="linksEl"
        class="flex min-w-0 flex-1 gap-x-1 overflow-x-auto [scrollbar-width:none] max-[600px]:gap-x-0.5 [mask-image:linear-gradient(to_right,#000_calc(100%_-_2rem),transparent)] [&::-webkit-scrollbar]:hidden"
      >
        <RouterLink
          v-for="link in navLinks"
          :key="link.to"
          :to="link.to"
          class="shrink-0 rounded-full px-3 py-1 text-sm whitespace-nowrap text-[var(--text-dim)] transition-colors hover:bg-white/5 hover:text-[var(--text)] max-[600px]:px-2.5 [&.router-link-active]:bg-white/[0.12] [&.router-link-active]:font-medium [&.router-link-active]:text-[var(--text)] [&.router-link-active]:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
        >
          {{ link.label }}
        </RouterLink>
        <!-- Keeps the last link clear of the fade when scrolled to the end. -->
        <span class="w-4 shrink-0"></span>
      </div>
      <button
        class="shrink-0 border-none bg-transparent p-0 text-sm text-[var(--text-dim)] hover:bg-transparent hover:text-[var(--text)]"
        title="Logout"
        @click="handleLogout"
      >
        <span class="max-[600px]:hidden">Logout</span>
        <svg class="h-5 w-5 min-[601px]:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
        </svg>
      </button>
    </nav>

    <!-- Folders gets more room: it's a file manager with a sidebar tree. -->
    <main
      class="mx-auto px-4 py-5"
      :class="[route.name === 'folders' ? 'max-w-7xl' : 'max-w-5xl', { 'pb-24 max-[760px]:pb-32': isLoggedIn() && currentTrack && playerState.view === 'bar' }]"
    >
      <RouterView />
    </main>

    <UploadPanel v-if="isLoggedIn() && route.name !== 'login'" />
    <TagEditorDialog
      v-if="songEdits.identifying"
      :key="songEdits.identifying.id"
      :songs="[songEdits.identifying]"
      :song-ids="[songEdits.identifying.id]"
      :count="1"
      start-searching
      @close="songEdits.identifying = null"
      @saved="songSaved(songEdits.identifying!)"
    />
    <PlayerBar v-if="isLoggedIn() && route.name !== 'login'" />
  </div>
</template>

<style scoped>
.nav-progress {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 60;
  height: 2px;
  width: 100%;
  background: linear-gradient(to right, transparent, var(--accent), transparent);
  background-size: 40% 100%;
  background-repeat: no-repeat;
  animation: nav-progress 1s ease-in-out infinite;
}
@keyframes nav-progress {
  from {
    background-position: -40% 0;
  }
  to {
    background-position: 140% 0;
  }
}
</style>
