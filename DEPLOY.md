# 上线部署（让任何人都能在互联网上玩）

游戏本身是标准网页多人架构（浏览器客户端 + Node/Socket.IO 服务端）。
要让**公网**上的朋友能进，只需让服务端地址对外可达。三种方式，按"即时→永久"排序。

---

## 方式一：localtunnel（最快，已就绪，免安装）

适合临时开一局。把本机端口映射成公网网址，**无需注册**。

```bash
# 在能联网的本机终端执行（项目已装好依赖）
npx localtunnel --port 3000
# 输出类似：your url is: https://xxxx.loca.lt
```

- 启动前先 `npm start` 让服务器跑在 3000 端口。
- 把 `https://xxxx.loca.lt` 发给朋友即可。
- ⚠️ 首次打开会有一次"我不是机器人"验证页；本机需保持开机、隧道进程不能关。

> 当前环境已为你跑了一条：`https://moody-taxes-cover.loca.lt`（随时可能变化，以终端输出为准）。

## 方式二：localhost.run（最省事，零下载，推荐先试）

适合"几个朋友、免费、手机玩、不想租服务器"。利用系统自带 SSH，无需下载任何客户端、无需注册。

```bash
# 1) 先让服务器跑起来（本机终端）
npm start

# 2) 另开一个终端，建立公网隧道（Windows 10/11 / Git Bash 自带 ssh）
ssh -R 80:localhost:3000 nokey@localhost.run
# 输出类似：https://xxxx.lhr.life   ← 把这个发朋友
```

- 免费、免账号、不弹验证页，朋友手机直接开链接就能玩。
- 前提：你这台电脑**玩的时候保持开机**、隧道终端别关。
- 匿名子域名每次重连会变；要固定域名去 localhost.run 注册并加 key（仍免费）。
- 卡死了就重跑第 2 步，会换一个新地址。

## 方式三：cloudflared（更稳定，免注册，需本机装客户端）

比 localtunnel 稳，不弹验证页。在本机（非本代理环境，网络正常）执行：

```bash
# 1) 下载客户端（Windows）
#    浏览器打开 https://github.com/cloudflare/cloudflared/releases/latest
#    下 cloudflared-windows-amd64.exe，放到某目录
# 2) 起隧道
cloudflared tunnel --url http://localhost:3000
# 输出类似：https://<随机>.trycloudflare.com
```

- 同样需先 `npm start`，且本机保持开机。
- 想要固定域名需登录 cloudflared 账号（`cloudflared tunnel login`）。

## 方式三：部署到云平台（永久 24 小时在线，推荐）

适合长期运营。仓库已配好 `Dockerfile` / `.dockerignore` / `render.yaml` / `railway.json`，任选一个免费平台：

### Render（最简单）
1. 注册 https://render.com （可用 GitHub 登录）。
2. Dashboard → New → Blueprint → 关联本仓库（或上传代码）。
3. Render 读取 `render.yaml` 自动建好 Web 服务（free 计划）。
4. 部署完成后得到固定网址 `https://tractor-online.onrender.com`，随时可玩。

### Railway
1. 注册 https://railway.app 。
2. New Project → Deploy from GitHub repo（或空项目后 `railway up`）。
3. 平台按 `railway.json` 用 Dockerfile 构建并启动。
4. 生成的域名即为公网地址。

### 通用 Docker 部署（自有服务器 / VPS）
```bash
docker build -t tractor-online .
docker run -d -p 3000:3000 --name tractor tractor-online
# 用 nginx/caddy 反代 3000 并配 HTTPS 域名即可
```

---

## 注意事项
- 服务端已监听 `0.0.0.0` 并读取 `process.env.PORT`，云平台分配的端口会自动生效。
- Socket.IO 的 CORS 设为 `origin: '*'`，跨域（部署域名 ≠ 客户端来源）也能连。
- 回放文件写在 `data/replays/`（运行时生成，已在 `.dockerignore` 中排除构建期）。
- 免费平台的免费实例会"休眠"，首访可能慢几秒，属正常。
