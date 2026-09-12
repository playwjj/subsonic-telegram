# web

The web UI for `subsonic-telegram` — Vue 3 + Vite, talking directly to the Worker's `/rest/*` Subsonic API. See the [root README](../README.md#web-ui) for how this gets built and deployed.

```bash
npm install
npm run dev     # proxies /rest to a local `wrangler dev` (localhost:8787) by default;
                 # set VITE_API_PROXY_TARGET to point at a deployed Worker instead
npm run build    # outputs to dist/, which wrangler.toml's [assets] serves
```
