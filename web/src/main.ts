import { createApp } from "vue";
import App from "./App.vue";
import router, { prefetchViews } from "./router";
import "./style.css";

createApp(App).use(router).mount("#app");
void router.isReady().then(prefetchViews);
