# subsonic-telegram

一个 Cloudflare Worker，直接实现 Subsonic REST API，文件本体存在 Telegram 私有频道（用 Bot API，不经 rclone/WebDAV），元数据存 Cloudflare D1。用来替代 [`navidrome-telegram`](../navidrome-telegram) 那套 Navidrome + TGFS + rclone 方案——不需要常驻服务器，也不需要为了 seek 播放而绕开 TGFS 的 Range bug（Telegram 的文件下载接口本身就支持标准 HTTP Range，已实测验证）。

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

## 已实现的端点

`ping` `getLicense` `getMusicFolders` `getIndexes` `getArtists` `getArtist` `getAlbum` `getSong` `getAlbumList2` `getGenres` `search3` `stream` `download` `getCoverArt`

还没做（用得上再加）：`getPlaylists`/`createPlaylist` 系列、`scrobble`、`getRandomSongs`、`getStarred`。

## 首次搭建

**1. 装依赖**

```bash
npm install
```

**2. 建 D1 数据库**（手动，Cloudflare 个人账号下）

```bash
wrangler d1 create subsonic-telegram
```

把返回的 `database_id` 填进 `wrangler.toml` 的 `database_id = "REPLACE_AFTER_WRANGLER_D1_CREATE"`。

**3. 建表**

```bash
npm run db:migrate:remote
```

**4. 建一个登录账号**（Subsonic 客户端登录用，明文密码存 D1，仅限个人单用户部署）

```bash
wrangler d1 execute subsonic-telegram --remote --command \
  "INSERT INTO users (username, password) VALUES ('你的用户名', '你的密码');"
```

**5. 配置 Worker 的 Telegram 凭据**（生产用 secrets，不写进 wrangler.toml）

```bash
wrangler secret put TG_BOT_TOKEN
wrangler secret put TG_CHANNEL_ID   # 完整 chat_id，带 -100 前缀
```

**6. 部署**

```bash
npm run deploy
```

部署后 Subsonic 客户端指向 `https://<你的worker地址>/rest`，用第 4 步建的账号登录。

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
3. 已经传过的文件记在本地 `.import-state.json`（不提交进 git），下次跑同一个目录会自动跳过，可以随时中断重跑。

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
