# subsonic-telegram

把 Telegram 变成免费、无限容量的私人音乐云盘：一个 Cloudflare Worker 直接实现 [Subsonic REST API](http://www.subsonic.org/pages/api.jsp)，音频文件本体存在 Telegram 私有频道里（走官方 Bot API，不依赖 rclone/WebDAV 之类的中间层），元数据存 Cloudflare D1。任何支持 Subsonic 协议的客户端（Amperfy、DSub、Ultrasonic、substreamer……）都能直接连上来听歌、管理歌单。

整个方案没有常驻服务器——Worker 按请求触发，D1 和 Telegram 都是托管服务，播放时 seek/拖进度条走的是 Telegram 文件下载接口原生支持的标准 HTTP Range（已实测验证），不需要额外绕路。

**当前限制**：单个音乐文件不超过 20MB（Telegram Bot API `getFile` 的硬限制），超过的文件导入时会被跳过。以后如果需要支持更大文件（比如无损专辑),再考虑分片或换用 MTProto/其它存储后端。

## 架构

```
Subsonic 客户端
   ↕ HTTPS /rest/*.view
Cloudflare Worker（src/index.ts，路由 + 鉴权 + 拼 Subsonic 响应）
   ↕
Cloudflare D1（artists/albums/tracks/users 元数据）
   ↕ file_ref (JSON: {messageId, fileId})
Telegram Bot API（sendDocument 上传 / getFile+文件CDN 下载，支持 Range）
```

存储层是一个接口（`src/storage/types.ts`），当前只有 Telegram 实现（`src/storage/telegram.ts`）。以后想换成 R2/S3 之类，只需要新写一个实现这个接口的 class，路由和数据库 schema 都不用动。

## 目录结构

| 路径 | 作用 |
|---|---|
| `src/index.ts` | Worker 入口，按 `/rest/<endpoint>.view` 路由，先鉴权再分发 |
| `src/auth.ts` | Subsonic 鉴权（token 或明文密码），`src/md5.ts` 是配套的无依赖 MD5 实现（Web Crypto 不支持 MD5） |
| `src/subsonic/` | 响应构建（`node.ts`/`response.ts`，同一套树可以序列化成 JSON 或 XML）、各端点的业务逻辑 |
| `src/db/queries.ts` | 所有 D1 查询 |
| `src/storage/` | 存储后端接口 + Telegram 实现 |
| `db/schema.sql` | D1 表结构 |
| `scripts/import.ts` | 本地导入脚本：扫描本地音乐目录，读 tag，传 Telegram，写 D1 |
| `scripts/import-m3u.ts` | 从本地 `.m3u`/`.m3u8` 文件建/更新 Subsonic playlist |
| `web/` | 自带的 Web UI（Vue 3 + Vite），打包后由 Workers Static Assets 跟 API 一起提供，见下面 [Web UI](#web-ui) |

## 已实现的端点

`ping` `getLicense` `getMusicFolders` `getIndexes` `getArtists` `getArtist` `getAlbum` `getSong` `getAlbumList2` `getGenres` `search3` `stream` `download` `getCoverArt` `getPlaylists` `getPlaylist` `createPlaylist` `updatePlaylist` `deletePlaylist` `getRandomSongs` `scrobble` `star` `unstar` `getStarred` `getStarred2`

`scrobble`（`submission=true`，默认值）会给对应 track 的 `play_count` 加一、更新 `last_played`；`submission=false`（"正在播放"通知）目前直接忽略，不做处理。`star`/`unstar` 接受 `id`（曲目）/`albumId`/`artistId` 中的任意组合；`getStarred`/`getStarred2` 返回同一份收藏数据，只是外层标签不同（`starred` vs `starred2`），走的都是这个项目原生的 ID3 结构。

**客户端兼容性备注**：部分 Subsonic 客户端（实测 Amperfy）在真正调用 API 之前会先探测裸的服务器地址 `/`，把非 2xx 响应当成"服务器不存在"，导致登录直接报 404。现在 `/`（连同其它非 `/rest/*` 路径）由 Web UI 的静态资源应答，天然是 `200`，这个兼容问题顺带解决了，见下面 [Web UI](#web-ui)。

## 部署方式：Cloudflare Git 集成（Workers Builds）

这个项目用的是 Cloudflare Dashboard 里把 Worker 跟这个 GitHub 仓库连起来的方式部署，**不是**本地跑 `wrangler deploy`。效果是：每次 push 到 `main`，Cloudflare 自动拉代码、`npm install`、按 `wrangler.toml` 构建部署，不需要手动触发。

但这只解决了"代码怎么发布"，下面这些是 **Git 集成不会替你做、必须手工做一次** 的事——因为它们要么是有状态的资源（数据库、密钥），要么根本不受代码变更触发：

这个仓库的 `wrangler.toml` 里 `database_id` 已经是真实值了（部署已跑通），下面 1~2 步是**从零搭一个新实例时**要做的，仅供参考：

**1. 建 D1 数据库**（在跟 Git 集成连的**同一个** Cloudflare 账号下手动建，Cloudflare 不会自动建数据库）

```bash
wrangler d1 create subsonic-telegram
```

**2. 把返回的 `database_id` 写回 `wrangler.toml`，commit + push**

Git 集成是从仓库里的 `wrangler.toml` 读配置的，占位符不改掉、不推上去，D1 binding 永远连不上。

**3. 建表**（一次性，改了 `db/schema.sql` 之后要重新跑；push 代码不会自动跑迁移）

```bash
wrangler d1 execute subsonic-telegram --remote --file=./db/schema.sql
```

⚠️ **已知坑**：本机 `wrangler` 走的是环境变量里的 `CLOUDFLARE_API_TOKEN`（登录身份可能是别的项目/账号常用的那个），不一定跟这个 Worker 部署所在的 Cloudflare 账号是同一个——`wrangler whoami` 能看到的账号列表里如果没有目标账号，`wrangler secret put`/`wrangler d1 execute --remote`/`wrangler tail` 这些都会失败或连错账号，且这种失败往往不直观（认证错误、而不是明确提示"账号不对"）。踩到这个坑时的绕过办法：改用 Cloudflare 的 **D1 HTTP API**（`https://api.cloudflare.com/client/v4/accounts/<CF_ACCOUNT_ID>/d1/database/<D1_DATABASE_ID>/query`，带 `Authorization: Bearer <CF_API_TOKEN>`）直接跑 SQL，效果跟 `wrangler d1 execute --remote` 等价，且不依赖本机 wrangler 的登录身份——`scripts/import.ts`/`scripts/import-m3u.ts` 全部走的这条路。Secrets（`TG_BOT_TOKEN`/`TG_CHANNEL_ID`）目前只能通过 Cloudflare Dashboard 手动设置来绕开这个问题（见下面第 5 步），HTTP API 没有对应的写入端点。

**4. 建一个登录账号**（Subsonic 客户端登录用，明文密码存 D1，仅限个人单用户部署）

```bash
wrangler d1 execute subsonic-telegram --remote --command \
  "INSERT INTO users (username, password) VALUES ('你的用户名', '你的密码');"
```

**5. 配置 Telegram 凭据**（跟代码无关，不会因为 git push 而设置，也绝对不能写进仓库）

二选一：
- 本地跑（要求 `wrangler whoami` 登录的就是跟 Git 集成同一个账号）：
  ```bash
  wrangler secret put TG_BOT_TOKEN
  wrangler secret put TG_CHANNEL_ID   # 完整 chat_id，带 -100 前缀
  ```
- 或者去 Cloudflare Dashboard → 该 Worker → Settings → Variables and Secrets 手动加。

两种方式设一次就持久化在 Worker 上，以后 git push 触发的重新部署不会清掉。

**6. 设置构建命令**（Web UI 需要，见下面 [Web UI](#web-ui)）：Cloudflare Dashboard → 该 Worker → Settings → Build → Build command 填 `npm run build`。Workers Builds 不会自动跑 `package.json` 里的 `build` 脚本，不设这个 Web UI 就不会被打包进部署（`wrangler.toml` 里 `[assets] directory` 指向的 `web/dist` 会是空的/不存在，部署直接失败）。

**7. （可选）自定义域名**：Worker 的 Settings → Domains & Routes 里加域名，再去 Cloudflare DNS 配对应记录。这跟传统"nginx 反代 + Origin CA 证书"那一套不是一回事——Workers 自定义域名由 Cloudflare 直接签发证书，不需要自己搞 nginx/证书。

**8. 验证**：`curl https://<worker地址>/rest/ping.view?u=<用户名>&p=<密码>&v=1.16.1&c=test&f=json`，应该返回 `{"subsonic-response":{"status":"ok",...}}`。

## 导入本地音乐库

导入脚本走 Cloudflare 的 D1 HTTP API（D1 binding 只能在 Worker 里用，普通 Node 脚本连不上，只能走 REST）。

1. 复制 `.env.example` 为 `.env`，填好：
   - `TG_BOT_TOKEN` / `TG_CHANNEL_ID`：跟 Worker secrets 用同一份
   - `CF_ACCOUNT_ID`：Cloudflare 账号 ID
   - `CF_API_TOKEN`：有 D1 编辑权限的 token
   - `D1_DATABASE_ID`：第 2 步 `wrangler d1 create` 返回的 database_id
2. 跑：
   ```bash
   npm run import -- /path/to/music
   ```
   会递归扫描目录下的 mp3/flac/m4a/ogg/opus/wav，读 tag（艺人/专辑/标题/年份/流派/封面），上传到 Telegram，写入 D1。超过 19MB 的文件会跳过并打印警告。
3. 已经传过的文件记在本地 `.import-state.json`（不提交进 git），下次跑同一个目录会自动跳过，可以随时中断重跑。**去重只看本地这个文件，不查 D1**（有意的取舍——省 D1 读配额），代价是如果这个文件丢了/搬了机器，重跑会把同一批文件重新传一遍 Telegram（D1 那边不会出现重复记录，因为 track id 冲突会被 `ON CONFLICT DO NOTHING` 挡住，但白传的那份 Telegram 消息就没人引用了）。
4. 每条 track 会记一个 `source_path`（相对导入时传给命令行的那个目录的路径），是 [Playlist](#playlist) 那边靠 `.m3u` 匹配 track 的关键——**每次都要传同一个根目录**（建议固定用 `LOCAL_MUSIC_DIR` 那个值），不然同一首歌在不同次 import 里 `source_path` 算出来不一样，匹配不上。

## Playlist

`getPlaylists`/`getPlaylist`/`createPlaylist`/`updatePlaylist`/`deletePlaylist` 都实现了标准 Subsonic 语义，客户端里能正常增删改查。

除了让客户端自己建 playlist，也可以从本地已有的 `.m3u`/`.m3u8` 文件批量生成：

```bash
npm run import-m3u -- /path/to/playlist.m3u
```

原理是拿 `.m3u` 里列的每个文件路径，换算成相对 `LOCAL_MUSIC_DIR`（或 `--music-dir=` 指定的目录）的路径，去 D1 按 `source_path` 精确匹配已导入的 track——**所以 `.m3u` 里引用的歌必须先用 `npm run import` 导入过**，没导入的会在结尾列出来，提示去先导入。重跑同一个 `.m3u` 文件会更新同名 playlist（按名字算出固定 id），不会重复建。

## Web UI

`web/` 是一个 Vue 3 + Vite 单页应用，直接调 `/rest/*` API（跟第三方 Subsonic 客户端走的是同一套接口），提供浏览歌库、播放、管理 playlist 的界面——不做上传/编辑，那部分场景交给上面的脚本。

**怎么跟 Worker 拼在一起**：Cloudflare Workers 的 Static Assets 功能，`wrangler.toml` 里配的：

```toml
[assets]
directory = "./web/dist"
binding = "ASSETS"
run_worker_first = ["/rest/*"]
not_found_handling = "single-page-application"
```

`run_worker_first` 只对 `/rest/*` 生效，意味着别的路径（`/`、`/playlists/xxx` 等）**根本不会进 `src/index.ts`**，直接由 Cloudflare 从 `web/dist` 静态返回（`not_found_handling = "single-page-application"` 让 Vue Router 的客户端路由刷新/直接访问也能命中 `index.html`）。这也是为什么之前给 Amperfy 打的那个"根路径特判"补丁被删掉了——现在 `/` 天然由真实的 `index.html` 应答。

**鉴权模型**：登录界面收集用户名密码，跟其它 Subsonic 客户端一样存在浏览器本地（`localStorage`），之后每个 API/`stream`/`getCoverArt` 请求都带上——这意味着密码会出现在这些请求的 URL 查询参数里（浏览器历史、Performance API 等能看到），是 Subsonic 协议这套经典鉴权方式本身的特性，不是这个 Web UI 独有的新增风险，个人单用户部署下可接受。

**本地开发**：

```bash
cd web
npm install
npm run dev              # 默认代理 /rest 到 http://127.0.0.1:8787（wrangler dev）
VITE_API_PROXY_TARGET=https://<你的worker地址> npm run dev   # 或者直接代理到已部署的真实后端
```

**构建/部署**：根目录 `npm run build`（= `npm --prefix web ci && npm --prefix web run build`）会把 `web/dist` 建出来，`wrangler deploy`/Git 集成部署时由 `[assets]` 一并发布。**本地第一次跑 `wrangler dev`/`wrangler deploy` 之前必须先跑一次这个 build**，`web/dist` 目录不存在的话 wrangler 会直接报错拒绝启动。Git 集成走的是 Cloudflare Dashboard 的 Build command（见上面部署步骤第 6 步），不是这里的 `npm run build`——两处都要配对。

## 本地开发 / 测试

```bash
npm run db:migrate:local   # 建本地 D1（wrangler 本地模拟）
npm run dev                # wrangler dev，读 .dev.vars 里的 Telegram 凭据
```

`.dev.vars` 跟 `.env` 内容一样（Telegram 凭据），是 wrangler dev 专用的本地 secrets 文件，两者都不提交进 git。

本地测试可以直接往本地 D1 塞几条假数据（`wrangler d1 execute subsonic-telegram --local --command "..."`），配合真实的 Telegram 凭据测 `stream`/`getCoverArt`，因为 Telegram 那边始终是真实 API，不区分本地/远程。

## 安全 / 单用户假设

- `users.password` 明文存库：Subsonic 的经典 token 鉴权（`t = md5(password + salt)`）要求服务端能拿到明文密码重算哈希，没有绕过的办法。这套东西设计成个人自用，不要在这张表里塞会在别处复用的密码。
- 没做多用户/权限隔离、没有速率限制。当前定位是"我自己用"，不是给别人开账号的公共服务。
