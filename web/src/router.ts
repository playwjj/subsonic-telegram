import { createRouter, createWebHistory } from "vue-router";
import { isLoggedIn } from "./stores/auth";

const routes = [
  { path: "/login", name: "login", component: () => import("./views/LoginView.vue") },
  { path: "/", name: "home", component: () => import("./views/HomeView.vue") },
  { path: "/artists", name: "artists", component: () => import("./views/ArtistsView.vue") },
  { path: "/artists/:id", name: "artist", component: () => import("./views/ArtistDetailView.vue"), props: true },
  { path: "/albums/:id", name: "album", component: () => import("./views/AlbumDetailView.vue"), props: true },
  { path: "/songs", name: "songs", component: () => import("./views/SongsView.vue") },
  {
    path: "/folders/:path*",
    name: "folders",
    component: () => import("./views/FoldersView.vue"),
    props: true,
  },
  { path: "/trash", name: "trash", component: () => import("./views/TrashView.vue") },
  { path: "/storage", name: "storage", component: () => import("./views/StorageView.vue") },
  { path: "/duplicates", name: "duplicates", component: () => import("./views/DuplicatesView.vue") },
  { path: "/favorites", name: "favorites", component: () => import("./views/FavoritesView.vue") },
  { path: "/search", name: "search", component: () => import("./views/SearchView.vue") },
  { path: "/upload", name: "upload", component: () => import("./views/UploadView.vue") },
  { path: "/playlists", name: "playlists", component: () => import("./views/PlaylistsView.vue") },
  {
    path: "/playlists/:id",
    name: "playlist",
    component: () => import("./views/PlaylistDetailView.vue"),
    props: true,
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  if (to.name !== "login" && !isLoggedIn()) return { name: "login", query: { redirect: to.fullPath } };
  if (to.name === "login" && isLoggedIn()) return { name: "home" };
});

// Every deploy renames the view chunks, and a missing one comes back as the
// SPA's index.html — so a tab opened before the deploy fails to load the
// next page it navigates to, and the click just seems to do nothing. Load
// that page fresh instead (once per target, so a real outage can't loop).
router.onError((err, to) => {
  const message = err instanceof Error ? err.message : String(err);
  if (!/dynamically imported module|Importing a module script|module script|Loading chunk|MIME type/i.test(message)) return;
  const key = `chunk-reload:${to.fullPath}`;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, "1");
  window.location.assign(to.fullPath);
});

// Fetch every page's code once the first one is up, so later navigation
// doesn't wait on the network for it (the views are small).
export function prefetchViews() {
  const run = () => {
    for (const route of routes) void (route.component as () => Promise<unknown>)().catch(() => {});
  };
  if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 1500);
}

export default router;
