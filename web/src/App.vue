<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import { isLoggedIn, logout } from "./stores/auth";
import PlayerBar from "./components/PlayerBar.vue";

const route = useRoute();
const router = useRouter();

async function handleLogout() {
  logout();
  await router.push({ name: "login" });
}
</script>

<template>
  <div class="app">
    <nav v-if="isLoggedIn() && route.name !== 'login'" class="nav">
      <RouterLink to="/">Library</RouterLink>
      <RouterLink to="/search">Search</RouterLink>
      <RouterLink to="/playlists">Playlists</RouterLink>
      <button class="logout" @click="handleLogout">Logout</button>
    </nav>
    <main class="content" :class="{ 'with-player': isLoggedIn() }">
      <RouterView />
    </main>
    <PlayerBar v-if="isLoggedIn() && route.name !== 'login'" />
  </div>
</template>

<style scoped>
.nav {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  background: var(--bg);
  z-index: 15;
}
.nav a {
  color: inherit;
  text-decoration: none;
  opacity: 0.7;
}
.nav a.router-link-active {
  opacity: 1;
  font-weight: 600;
}
.logout {
  margin-left: auto;
  background: none;
  border: none;
  color: inherit;
  opacity: 0.7;
  cursor: pointer;
}
.content {
  max-width: 60rem;
  margin: 0 auto;
  padding: 1.25rem 1rem;
}
.content.with-player {
  padding-bottom: 5rem;
}
</style>
