# Subsonic Telegram

*English | [中文](README-CN.md)*

Turn Telegram into a free, effectively unlimited-capacity personal music cloud: a Cloudflare Worker that directly implements the [Subsonic REST API](http://www.subsonic.org/pages/api.jsp). Audio files themselves live in a private Telegram channel (via the official Bot API — no rclone/WebDAV middleman), while metadata lives in Cloudflare D1. Any Subsonic-compatible client (Amperfy, DSub, Ultrasonic, substreamer, ...) can connect directly to browse, play, and manage playlists.

There's no long-running server in this setup — the Worker is invoked per-request, D1 and Telegram are both managed services, and seeking/scrubbing during playback rides on the standard HTTP Range support that Telegram's file-download endpoint natively provides (verified in practice), no extra workarounds needed.

**Current limitation**: a single audio file must be under 20MB (a hard limit of the Telegram Bot API's `getFile`); larger files are skipped during import. If larger files (e.g. lossless albums) need to be supported down the line, chunking or switching to MTProto/another storage backend would be the way to go.

## Requirements

- A Telegram account (to create a bot and a private channel — see [Prerequisite](#prerequisite-create-a-telegram-bot-and-channel) below)
- A Cloudflare account (Workers + D1 are both on the free tier for personal-scale use)
- Node.js 22+ and npm, for local scripts and building the Web UI
- The [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`, or use `npx wrangler`), logged in with `wrangler login`

## Contents

- [Architecture](#architecture)
- [Project layout](#project-layout)
- [Implemented endpoints](#implemented-endpoints)
- [Prerequisite: create a Telegram bot and channel](#prerequisite-create-a-telegram-bot-and-channel)
- [Deployment: Cloudflare Git integration](#deployment-cloudflare-git-integration-workers-builds)
- [Importing a local music library](#importing-a-local-music-library)
- [Playlists](#playlists)
- [Web UI](#web-ui)
- [Local development / testing](#local-development--testing)
- [Security / single-user assumptions](#security--single-user-assumptions)
- [Contributing](#contributing)
- [License](#license)

## Architecture

```
Subsonic client
   ↕ HTTPS /rest/*.view
Cloudflare Worker (src/index.ts — routing + auth + Subsonic response building)
   ↕
Cloudflare D1 (artists/albums/tracks/playlists metadata)
   ↕ file_ref (JSON: {messageId, fileId})
Telegram Bot API (sendDocument to upload / getFile + file CDN to download, Range supported)
```

The storage layer is an interface (`src/storage/types.ts`), currently with a single Telegram implementation (`src/storage/telegram.ts`). Swapping in R2/S3/etc. later just means writing a new class that implements this interface — routing and the DB schema don't need to change.

## Project layout

| Path | Purpose |
|---|---|
| `src/index.ts` | Worker entry point, routes by `/rest/<endpoint>.view`, authenticates before dispatching |
| `src/auth.ts` | Subsonic auth (token or plaintext password); credentials come from the `AUTH_USERNAME`/`AUTH_PASSWORD` Worker secrets, never stored in a database. `src/md5.ts` is the accompanying dependency-free MD5 implementation (Web Crypto doesn't support MD5) |
| `src/subsonic/` | Response building (`node.ts`/`response.ts` — one tree that serializes to either JSON or XML) and per-endpoint business logic |
| `src/db/queries.ts` | All D1 queries |
| `src/storage/` | Storage backend interface + the Telegram implementation |
| `db/schema.sql` | D1 table definitions |
| `scripts/import.ts` | Local import script: scans a local music directory, reads tags, uploads to Telegram, writes to D1 |
| `scripts/import-m3u.ts` | Builds/updates Subsonic playlists from local `.m3u`/`.m3u8` files |
| `web/` | The bundled Web UI (Vue 3 + Vite), served alongside the API by Workers Static Assets once built — see [Web UI](#web-ui) below |

## Implemented endpoints

`ping` `getLicense` `getMusicFolders` `getIndexes` `getArtists` `getArtist` `getAlbum` `getSong` `getAlbumList2` `getGenres` `search3` `stream` `download` `getCoverArt` `getPlaylists` `getPlaylist` `createPlaylist` `updatePlaylist` `deletePlaylist` `getRandomSongs` `scrobble` `star` `unstar` `getStarred` `getStarred2`

`scrobble` (`submission=true`, the default) increments the track's `play_count` and updates `last_played`; `submission=false` ("now playing" notifications) is currently ignored outright. `star`/`unstar` accept any combination of `id` (track) / `albumId` / `artistId`. `getStarred`/`getStarred2` return the same favorites data, just under a different top-level tag (`starred` vs `starred2`) — both use this project's native ID3 structure.

**Client compatibility note**: some Subsonic clients (confirmed with Amperfy) probe the bare server root `/` before making any real API calls, and treat a non-2xx response as "server doesn't exist," which makes login fail with a 404. Since `/` (along with any other non-`/rest/*` path) is now served by the Web UI's static assets, it's naturally a `200`, which incidentally fixes this compatibility issue too — see [Web UI](#web-ui) below.

## Prerequisite: create a Telegram bot and channel

This is the step newcomers get stuck on most — it has nothing to do with Cloudflare, it's pure Telegram setup. By the end you'll have two values, `TG_BOT_TOKEN` and `TG_CHANNEL_ID`, which you'll enter as Worker secrets during deployment (step 4 below).

1. **Create a bot**: open [@BotFather](https://t.me/BotFather) in Telegram and send `/newbot`. Follow the prompts to pick a display name and a username (the username must end in `bot`). BotFather replies with a string like `123456789:AAH...` — that's your `TG_BOT_TOKEN`. Keep it safe; whoever has it has full control of the bot. Never commit it to the repo.
2. **Create a private channel**: in your Telegram client, create a new Channel and set its type to **Private** (this channel exists purely to store audio files — it doesn't need to be, and shouldn't be, public). Once created, add the bot from step 1 as a channel administrator (Administrators → Add Admin), and make sure it has at least the "Post Messages" permission — otherwise uploads will fail.
3. **Get the channel's `chat_id` (i.e. `TG_CHANNEL_ID`)**: a channel's chat_id is a large negative number starting with `-100` — it's not the same thing as the channel's `@username`, so you need this numeric form. Two ways to get it:
   - Easiest: post any message in the channel, then forward that message to [@getidsbot](https://t.me/getidsbot) (or any similar "get chat id" bot) — it will reply with the full chat_id, `-100` prefix included.
   - Or manually: make sure the bot is already a channel admin, post a message in the channel, then open `https://api.telegram.org/bot<TG_BOT_TOKEN>/getUpdates` in a browser. Look for `channel_post.chat.id` in the returned JSON — that's your `TG_CHANNEL_ID`.
4. Keep both values handy — you'll need them during deployment (step 4 below) or for local development (`.env`/`.dev.vars`).

## Deployment: Cloudflare Git integration (Workers Builds)

This project is deployed by connecting the Worker to this GitHub repo through the Cloudflare Dashboard — **not** by running `wrangler deploy` locally. The effect: every push to `main` gets automatically pulled by Cloudflare, `npm install`ed, and built/deployed per `wrangler.toml`, with no manual trigger needed.

That only solves "how the code gets published," though. The following are things **the Git integration will never do for you and that you must do by hand once** — because they're either stateful resources (databases, secrets) or simply aren't triggered by code changes:

`wrangler.toml` in this repo already has a real `database_id` (deployment is up and running). Steps 1–2 below are only relevant **when setting up a brand-new instance from scratch**, kept here for reference:

**1. Create the D1 database** (do this manually, under the **same** Cloudflare account the Git integration is connected to — Cloudflare doesn't create the database automatically):

```bash
wrangler d1 create subsonic-telegram
```

**2. Write the returned `database_id` back into `wrangler.toml`, then commit + push**

The Git integration reads its config from `wrangler.toml` in the repo. If the placeholder isn't replaced and pushed, the D1 binding will never connect.

**3. Create the tables** (one-time; re-run this whenever `db/schema.sql` changes — pushing code does not run migrations automatically)

Either:
- Local `wrangler` (requires being logged in to the same Cloudflare account this Worker is deployed under):
  ```bash
  wrangler d1 execute subsonic-telegram --remote --file=./db/schema.sql
  ```
- Or call Cloudflare's **D1 HTTP API** directly (doesn't depend on a local wrangler login — `scripts/import.ts` and friends use this same path; you'll need an API token with D1 Edit permission):
  ```bash
  curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/<CF_ACCOUNT_ID>/d1/database/<D1_DATABASE_ID>/query" \
    -H "Authorization: Bearer <CF_API_TOKEN>" -H "Content-Type: application/json" \
    -d "$(jq -Rs '{sql: .}' db/schema.sql)"
  ```

**4. Configure Worker secrets** (unrelated to code, never set by a git push, and must never be committed to the repo): your Telegram credentials (`TG_BOT_TOKEN`/`TG_CHANNEL_ID`, from [Prerequisite: create a Telegram bot and channel](#prerequisite-create-a-telegram-bot-and-channel) above) plus your login credentials (`AUTH_USERNAME`/`AUTH_PASSWORD`, used to log in from Subsonic clients — pick any username/password you like; this is for single-user personal deployments only)

Either:
- Locally (requires `wrangler whoami` to be logged in to the same account as the Git integration):
  ```bash
  wrangler secret put TG_BOT_TOKEN
  wrangler secret put TG_CHANNEL_ID   # full chat_id, including the -100 prefix
  wrangler secret put AUTH_USERNAME
  wrangler secret put AUTH_PASSWORD
  ```
- Or add all four manually via Cloudflare Dashboard → this Worker → Settings → Variables and Secrets.

Set once and it persists on the Worker — later git-push-triggered redeploys won't clear it. Login credentials are never stored in a database or written to any config file; they live only in the Worker's encrypted secrets, and `src/auth.ts` compares them directly against client login requests.

**5. Set the build command** (needed for the Web UI — see [Web UI](#web-ui) below): Cloudflare Dashboard → this Worker → Settings → Build → Build command, set to `npm run build`. Workers Builds does not automatically run the `build` script from `package.json`; without setting this, the Web UI won't get bundled into the deployment (the `web/dist` directory that `[assets] directory` in `wrangler.toml` points to will be empty/missing, and the deploy will fail outright).

**6. (Optional) Custom domain**: add a domain under the Worker's Settings → Domains & Routes, then configure the matching Cloudflare DNS record. This isn't the same as a traditional "nginx reverse proxy + Origin CA certificate" setup — Workers custom domains get their certificates issued directly by Cloudflare, no nginx/certificate wrangling required.

**7. Verify**: `curl https://<your-worker>/rest/ping.view?u=<username>&p=<password>&v=1.16.1&c=test&f=json` should return `{"subsonic-response":{"status":"ok",...}}`.

## Importing a local music library

The import script talks to Cloudflare through the D1 HTTP API (D1 bindings only work from inside a Worker, so a plain Node script has to go through REST instead).

1. Copy `.env.example` to `.env` and fill in:
   - `TG_BOT_TOKEN` / `TG_CHANNEL_ID`: the same values used for the Worker secrets
   - `CF_ACCOUNT_ID`: your Cloudflare account ID
   - `CF_API_TOKEN`: a token with D1 edit permission
   - `D1_DATABASE_ID`: the database_id returned by `wrangler d1 create` in step 2 above
2. Run:
   ```bash
   npm run import -- /path/to/music
   npm run import -- /path/to/music --limit=300   # override the default 100-files-per-run cap
   ```
   This recursively scans the directory for mp3/flac/m4a/ogg/opus/wav files (automatically skipping macOS AppleDouble shadow files starting with `._`, which show up on non-HFS+ volumes — they aren't audio, and importing them just produces a pile of zero-duration "Unknown Artist" junk tracks). It reads tags (artist/album/title/year/genre/cover art), uploads to Telegram, and writes to D1. Files over 19MB are skipped with a warning. **Each run uploads at most 100 new files** (override with `--limit=`), then exits; for a large library, run the same command multiple times — the local state file (see point 3 below) automatically picks up where it left off, without re-uploading anything.
3. Already-imported files are tracked in a local `.import-state.json` (not committed to git); re-running the same directory automatically skips them, and you can interrupt and re-run anytime. **Deduplication only checks this local file, not D1** (a deliberate tradeoff to save D1 read quota) — the downside being that if this file is lost or you move to a different machine, re-running will re-upload the same batch of files to Telegram (D1 won't end up with duplicate rows, since a conflicting track id gets blocked by `ON CONFLICT DO NOTHING`, but the redundant Telegram messages from the wasted upload won't be referenced by anything).
4. Each track records a `source_path` (its path relative to the directory you passed on the command line at import time) — this is the key [Playlist](#playlist) matching relies on to match `.m3u` entries to tracks. **Always pass the same root directory** (it's recommended to fix this to your `LOCAL_MUSIC_DIR` value) — otherwise the same song will compute a different `source_path` across import runs and won't match up.

## Playlists

`getPlaylists`/`getPlaylist`/`createPlaylist`/`updatePlaylist`/`deletePlaylist` all implement standard Subsonic semantics, so clients can create/edit/delete playlists normally.

Besides letting a client create playlists itself, you can also bulk-generate them from existing local `.m3u`/`.m3u8` files:

```bash
npm run import-m3u -- /path/to/playlist.m3u
```

This works by taking each file path listed in the `.m3u`, converting it to a path relative to `LOCAL_MUSIC_DIR` (or the directory given via `--music-dir=`), and matching it against already-imported tracks in D1 by exact `source_path`. **So any song referenced in the `.m3u` must already have been imported via `npm run import`** — anything not yet imported gets listed at the end, prompting you to import it first. Re-running the same `.m3u` file updates the same-named playlist (its id is derived deterministically from the name), rather than creating a duplicate.

## Web UI

`web/` is a Vue 3 + Vite single-page app that calls the `/rest/*` API directly (the same interface third-party Subsonic clients use), providing a browsing/playback/playlist-management UI. It doesn't handle uploading or editing — that's left to the scripts above.

**Pages**: Home (library stats + recently added/recently played/most played), Artists (browse by ID3 artist/album), Songs (a flat, sortable, paginated track list), Folders (browse by the original local folder structure — see below), Search, Playlists.

**What "Folders" is**: it reconstructs the original folder tree from `source_path` (recorded by `npm run import`, relative to the import root directory), as an alternative to the ID3-tag-based grouping that Artists uses. This is especially useful for "compilation" folders (e.g. a monthly hits chart) — where each song's ID3 artist tag differs, so browsing by Artists scatters them across dozens or hundreds of artist names, while browsing by Folders preserves the original "one folder, one compilation" structure intact. The backing endpoint is `getFolder` (in `src/index.ts`), which — like `getLibraryStats`/`getSongs`/`getRecentlyPlayed`/`getMostPlayed` — isn't part of the official Subsonic protocol; it only exists to serve this project's own Web UI.

**Styling**: Tailwind CSS v4 (via `@tailwindcss/vite`, no separate `postcss.config.js` needed), a single dark theme, hand-rolled `.glass` frosted-glass cards plus fixed, blurred gradient "aurora" background blobs — no light/dark theme toggle.

**How it's wired into the Worker**: via Cloudflare Workers' Static Assets feature, configured in `wrangler.toml`:

```toml
[assets]
directory = "./web/dist"
binding = "ASSETS"
run_worker_first = ["/rest/*"]
not_found_handling = "single-page-application"
```

`run_worker_first` only applies to `/rest/*`, meaning every other path (`/`, `/playlists/xxx`, etc.) **never reaches `src/index.ts`** — Cloudflare serves it statically from `web/dist` directly (`not_found_handling = "single-page-application"` lets Vue Router's client-side routing handle refreshes/direct navigation and still resolve to `index.html`). This is also why the earlier special-case patch for Amperfy's root-path probing was removed — `/` is now naturally answered by the real `index.html`.

**Auth model**: the login screen collects a username and password and, like other Subsonic clients, stores them in the browser locally (`localStorage`), attaching them to every subsequent API/`stream`/`getCoverArt` request — meaning the password shows up in these requests' URL query parameters (visible in browser history, the Performance API, etc). This is an inherent property of Subsonic's classic auth scheme itself, not a risk newly introduced by this Web UI, and is acceptable for a personal, single-user deployment.

**Local development**:

```bash
cd web
npm install
npm run dev              # proxies /rest to http://127.0.0.1:8787 (wrangler dev) by default
VITE_API_PROXY_TARGET=https://<your-worker> npm run dev   # or proxy directly to a deployed backend
```

**Build/deploy**: running `npm run build` at the repo root (= `npm --prefix web ci && npm --prefix web run build`) produces `web/dist`, which gets published alongside the Worker via `[assets]` when you run `wrangler deploy` or deploy through the Git integration. **You must run this build once before the first local `wrangler dev`/`wrangler deploy`** — if `web/dist` doesn't exist, wrangler will refuse to start with an error. The Git integration path uses the Cloudflare Dashboard's Build command (see deployment step 5 above) instead of this local `npm run build` — both need to be kept in sync.

## Local development / testing

```bash
npm run db:migrate:local   # create a local D1 (wrangler's local simulation)
npm run dev                # wrangler dev, reads Telegram credentials from .dev.vars
```

`.dev.vars` has the same contents as `.env` (Telegram credentials) — it's the local secrets file wrangler dev uses specifically; neither file is committed to git.

For local testing you can insert a few fake rows directly into the local D1 (`wrangler d1 execute subsonic-telegram --local --command "..."`), and test `stream`/`getCoverArt` against real Telegram credentials, since Telegram's side is always the real API regardless of local vs. remote.

## Security / single-user assumptions

- `AUTH_PASSWORD` is stored as plaintext in Worker secrets: Subsonic's classic token auth (`t = md5(password + salt)`) requires the server to have the plaintext password on hand to recompute the hash — there's no way around this. This is designed for personal use; don't use a password here that you reuse elsewhere.
- There's no multi-user support, no permission isolation, and no rate limiting. The current scope is "for my own use," not a public service meant to host other people's accounts.

## Contributing

Issues and pull requests are welcome — this is a personal-scale project, so please keep the single-user design goals above in mind (no multi-tenant auth, no rate limiting) rather than treating them as gaps to fix. For anything beyond a small fix, opening an issue first to discuss the approach is appreciated.

## License

[MIT](LICENSE)
