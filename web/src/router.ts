import { createRouter, createWebHistory } from "vue-router";
import { isLoggedIn } from "./stores/auth";

const routes = [
  { path: "/login", name: "login", component: () => import("./views/LoginView.vue") },
  { path: "/", name: "artists", component: () => import("./views/ArtistsView.vue") },
  { path: "/artists/:id", name: "artist", component: () => import("./views/ArtistDetailView.vue"), props: true },
  { path: "/albums/:id", name: "album", component: () => import("./views/AlbumDetailView.vue"), props: true },
  { path: "/search", name: "search", component: () => import("./views/SearchView.vue") },
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
  if (to.name === "login" && isLoggedIn()) return { name: "artists" };
});

export default router;
