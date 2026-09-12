<script setup lang="ts">
import { ref } from "vue";
import { search3, coverArtUrl, type Artist, type Album, type Song } from "../api/subsonic";
import { playQueue } from "../stores/player";
import TrackRow from "../components/TrackRow.vue";

const query = ref("");
const artists = ref<Artist[]>([]);
const albums = ref<Album[]>([]);
const songs = ref<Song[]>([]);
const searched = ref(false);
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function onInput() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runSearch, 300);
}

async function runSearch() {
  const q = query.value.trim();
  if (!q) {
    artists.value = [];
    albums.value = [];
    songs.value = [];
    searched.value = false;
    return;
  }
  const result = await search3(q);
  artists.value = result.artist;
  albums.value = result.album;
  songs.value = result.song;
  searched.value = true;
}
</script>

<template>
  <div class="search">
    <input v-model="query" placeholder="Search artists, albums, songs…" autofocus @input="onInput" />

    <p v-if="searched && !artists.length && !albums.length && !songs.length">No results.</p>

    <section v-if="artists.length">
      <h2>Artists</h2>
      <ul>
        <li v-for="a in artists" :key="a.id">
          <RouterLink :to="{ name: 'artist', params: { id: a.id } }">{{ a.name }}</RouterLink>
        </li>
      </ul>
    </section>

    <section v-if="albums.length">
      <h2>Albums</h2>
      <div class="albums">
        <RouterLink
          v-for="al in albums"
          :key="al.id"
          :to="{ name: 'album', params: { id: al.id } }"
          class="album-card glass p-2 transition-transform hover:scale-[1.03]"
        >
          <img v-if="al.coverArt" :src="coverArtUrl(al.coverArt)" :alt="al.name" />
          <div class="title">{{ al.name }}</div>
        </RouterLink>
      </div>
    </section>

    <section v-if="songs.length">
      <h2>Songs</h2>
      <TrackRow v-for="(s, i) in songs" :key="s.id" :song="s" @play="playQueue(songs, i)" />
    </section>
  </div>
</template>

<style scoped>
input {
  width: 100%;
  margin-bottom: 1.5rem;
}
section {
  margin-bottom: 1.5rem;
}
h2 {
  font-size: 0.9rem;
  opacity: 0.6;
  margin-bottom: 0.4rem;
}
ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
li {
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--border);
}
.albums {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
  gap: 1rem;
}
.album-card {
  color: inherit;
  text-decoration: none;
}
.album-card img {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 6px;
  object-fit: cover;
}
.title {
  font-size: 0.85rem;
  margin-top: 0.3rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
