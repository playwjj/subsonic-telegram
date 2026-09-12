<script setup lang="ts">
import { ref, onMounted } from "vue";
import { search3, coverArtUrl, getArtists, getRandomSongs, type Artist, type Album, type Song } from "../api/subsonic";
import { playQueue } from "../stores/player";
import TrackRow from "../components/TrackRow.vue";

const query = ref("");
const artists = ref<Artist[]>([]);
const albums = ref<Album[]>([]);
const songs = ref<Song[]>([]);
const searched = ref(false);
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

// Shown before a query is typed, and again as a fallback below "No results."
// so the page never renders as a dead end.
const discoverArtists = ref<Artist[]>([]);
const discoverSongs = ref<Song[]>([]);

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

function sample<T>(items: T[], count: number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

onMounted(async () => {
  const [index, random] = await Promise.all([getArtists(), getRandomSongs(8)]);
  discoverArtists.value = sample(
    index.flatMap((group) => group.artist),
    8,
  );
  discoverSongs.value = random;
});
</script>

<template>
  <div class="search">
    <input v-model="query" placeholder="Search artists, albums, songs…" autofocus @input="onInput" />

    <template v-if="!searched">
      <section v-if="discoverArtists.length" class="discover">
        <h2 class="mb-3 text-sm font-medium text-[var(--text-dim)]">Browse Artists</h2>
        <div class="flex flex-wrap gap-2">
          <RouterLink
            v-for="a in discoverArtists"
            :key="a.id"
            :to="{ name: 'artist', params: { id: a.id } }"
            class="glass px-3 py-1.5 text-sm transition-transform hover:scale-[1.03]"
          >
            {{ a.name }}
          </RouterLink>
        </div>
      </section>

      <section v-if="discoverSongs.length" class="discover">
        <h2 class="mb-3 text-sm font-medium text-[var(--text-dim)]">Random Songs</h2>
        <div class="glass p-2">
          <TrackRow v-for="(s, i) in discoverSongs" :key="s.id" :song="s" @play="playQueue(discoverSongs, i)" />
        </div>
      </section>
    </template>

    <template v-else>
      <template v-if="!artists.length && !albums.length && !songs.length">
        <p>No results.</p>

        <section v-if="discoverSongs.length" class="discover">
          <h2 class="mb-3 text-sm font-medium text-[var(--text-dim)]">You might like</h2>
          <div class="glass p-2">
            <TrackRow v-for="(s, i) in discoverSongs" :key="s.id" :song="s" @play="playQueue(discoverSongs, i)" />
          </div>
        </section>
      </template>

      <section v-if="artists.length">
        <h2 class="legacy">Artists</h2>
        <ul>
          <li v-for="a in artists" :key="a.id">
            <RouterLink :to="{ name: 'artist', params: { id: a.id } }">{{ a.name }}</RouterLink>
          </li>
        </ul>
      </section>

      <section v-if="albums.length">
        <h2 class="legacy">Albums</h2>
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
        <h2 class="legacy">Songs</h2>
        <TrackRow v-for="(s, i) in songs" :key="s.id" :song="s" @play="playQueue(songs, i)" />
      </section>
    </template>
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
h2.legacy {
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
}
li + li {
  border-top: 1px solid var(--border);
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
