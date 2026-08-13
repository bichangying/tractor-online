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

> 注：本方式免费额度不稳定、易掉线且首访有验证页，仅作兜底；优先用方式二/四。

## 方式二：localhost.run（最省事，零下载，推荐先试）

适合"几个朋友、免费、手机玩、不想租服务器"。利用系统自带 SSH，无需下载任何客户端、无需注册。

```bash
# 1) 先让服务器跑起来（本机终端）
npm start

# 2) 另开一个终端，建立公网隧道（Windows 10/11 / Git Bash 自带 ssh）
ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -R 80:localhost:3000 nokey@localhost.run
# 输出类似：https://xxxx.lhr.life   ← 把这个发朋友
#
# 参数说明：
#   -o StrictHostKeyChecking=accept-new  首次连接自动接受主机密钥，
#       避免在无终端（后台/脚本/自动化）环境下因 "Host key verification failed" 直接退出。
#   -o UserKnownHostsFile=/dev/null      跳过写入 known_hosts，避免 "Could not create directory .ssh" 报错。
#   如果是普通交互终端首次连接，也可只写  ssh -R 80:localhost:3000 nokey@localhost.run ，
#   按提示输入 yes 即可（之后本机会记住密钥）。
```

- 免费、免账号、不弹验证页，朋友手机直接开链接就能玩。
- 前提：你这台电脑**玩的时候保持开机**、隧道终端别关。
- 子域名每次重连都会变（实测带 SSH key 连接也一样会变，固定域名是付费功能）。
- 隧道**空闲太久会被服务端踢掉**（`tunnel inactivity timeout`），这是它最常见的掉线原因。
- ✅ **推荐直接用一键脚本**：`bash play.sh` —— 自动起服务 + 打通隧道 +
  每 45 秒保活心跳（防空闲掉线）+ 断线自动重连，当前地址实时写入 `CURRENT_URL.txt`。

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

## 方式四：部署到云平台（免本机开机、固定地址，推荐长期）

适合长期运营，仓库已配好 `Dockerfile` / `.dockerignore`，以及各平台蓝图：Render(`render.yaml`)、Koyeb(`koyeb.yaml`)、Railway(`railway.json`)。
**主推 Zeabur（免绑卡、中文控制台、香港/新加坡节点对中国延迟最低）；Render、Koyeb 作备用。**

### Zeabur（首选：免绑卡、中国延迟最低、中文控制台）

仓库地址：https://github.com/bichangying/tractor-online

Zeabur 是台湾团队出品的 Git 一键部署 PaaS，与 Render 同类，对国内用户更友好。

1. 打开 https://zeabur.com ，用 **GitHub 登录**（**免绑卡**，注册即用）。
2. 控制台 **Create Project** → 选**免费区域：香港 / 新加坡**（离中国最近，延迟最低）。
3. **Add Service** → **Deploy from GitHub repo** → 选 `tractor-online`（分支 `main`）。
4. Zeabur 读取仓库根目录的 **`zbpack.json`** 按既定方式构建（见下），无需在控制台填任何构建/启动命令。
5. 构建完成自动分配**固定子域名**（形如 `https://tractor-online.zeabur.app`）+ 免费 SSL，直接发朋友。

**`zbpack.json`（Zeabur 唯一认的配置文件，切勿改名）**

⚠️ Zeabur **不识别** `zeabur.toml` / `zeabur.yaml` 之类的文件名，配置文件只能叫 `zbpack.json`
（zbpack = "Zeabur Pack"，官方构建器）。多服务场景可用 `zbpack.[服务名].json` 覆盖，优先级更高。

```json
{
  "ignore_dockerfile": true,
  "build_command": "",
  "start_command": "node server/index.js"
}
```

| 字段 | 作用 |
|---|---|
| `ignore_dockerfile: true` | **故意忽略仓库里的 Dockerfile**，走 Zeabur 原生 Node 构建。原因：Zeabur 是额度制，原生构建比 Docker 更快、镜像更小、冷启动更短，省额度。 |
| `build_command: ""` | 显式声明"没有构建步骤"，防止 Zeabur 误猜去跑 `npm run build`（本项目是纯 JS，无打包） |
| `start_command` | 钉死启动命令，等价于 `npm start`，避免自动识别抽风 |

依赖安装由 Zeabur 自动完成：仓库有 `package-lock.json`，zbpack 会识别用 **npm** 按 lock 装。
Node 版本由 `package.json` 的 `engines.node: ">=20.0.0"` 保证（Zeabur 默认取最新 LTS）。
端口无需配置——服务端读 `process.env.PORT`，Zeabur 自动注入。

想改回 Docker 构建：把 `ignore_dockerfile` 改成 `false`（或删掉整个 `zbpack.json`），
Zeabur 检测到 `Dockerfile` 就会自动用 Docker 部署。

**免费档实况（2026-08 核实）**
| 项目 | 额度 |
|---|---|
| 信用卡 | **不需要** |
| 节点 | 香港 / 新加坡 / 东京（免费区，中国延迟最低） |
| 额度 | **$5/月 免费额度**，1 vCPU / 2GB 内存每服务 |
| 休眠 | 空闲自动休眠，冷启动仅几秒（比 Render 30-60s 快） |
| 子域名 | 固定 Zeabur 子域名（免费档不支持自定义域名） |

⚠️ **关键策略：让服务休眠，不要保活 ping。** Zeabur 是额度制（$5/月），若像 Render 那样用 cron 每 10 分钟 ping 保活，常驻会烧光额度导致停机。正确做法：空闲让它睡，朋友打开时冷启动几秒即可，永久免费。

### Render（备用一）

仓库地址：https://github.com/bichangying/tractor-online

一键部署链接（点开直接按 `render.yaml` 建服务）：
```
https://render.com/deploy?repo=https://github.com/bichangying/tractor-online
```

或手动：
1. 注册 https://render.com （用 GitHub 登录最快）。
2. Dashboard → **New → Blueprint** → 选中 `tractor-online` 仓库。
3. Render 读取 `render.yaml` 自动建好 Web 服务（free 计划，**不需要绑信用卡**）。
4. 首次构建约 3-5 分钟，完成后得到固定网址 `https://tractor-online.onrender.com`。

#### 路径 B：公开仓库 URL 直连（**不需要 GitHub 授权**，国内网络卡 OAuth 时用这个）

Render 官方支持"不连 Git 账号，直接填公开仓库地址"。适用于 GitHub OAuth 登录跳转失败、
授权页打不开的情况。

1. 用**邮箱**注册 https://dashboard.render.com/register （不选 GitHub 登录，绕开 OAuth）。
2. Dashboard → **New → Web Service**。
3. 在仓库选择区找到 **"Public Git Repository"** 输入框，粘贴：
   ```
   https://github.com/bichangying/tractor-online
   ```
4. 配置（Render 检测到 `Dockerfile` 后大多会自动填好）：
   | 项 | 值 |
   |---|---|
   | Name | `tractor-online` |
   | Region | **Singapore** |
   | Branch | `main` |
   | Runtime / Language | **Docker** |
   | Instance Type | **Free** |
   | Health Check Path | `/api/health` |
5. 点 **Create Web Service**，等 3-5 分钟。

⚠️ 此路径的**唯一限制**：不能自动部署。以后改了代码，要去 Render 面板点
**Manual Deploy → Deploy latest commit** 手动触发。（Blueprint / 连 Git 账号方式才有自动部署。）

**免费计划实况（2026-08 核实）**
| 项目 | 额度 |
|---|---|
| 实例时长 | 750 小时/月（够一个服务常驻） |
| 内存 / CPU | 512MB / 0.1 vCPU 共享 |
| 流量 | 100GB/月 |
| 构建分钟 | 500 分钟/月 |
| 信用卡 | 不需要 |

**唯一的坑：15 分钟无访问会休眠**，下一次请求要等 **30-60 秒**冷启动。
- 对打牌影响不大：第一个人开链接等一下，之后只要有人在玩（Socket.IO 长连接算活跃流量）就不会休眠。
- 想彻底免冷启动：用 https://cron-job.org （免费）每 10 分钟 GET 一次
  `https://tractor-online.onrender.com/api/health` 保活；或升级 $7/月。

**region 已设为 `singapore`**：离中国最近，延迟约 60-80ms；默认的 `oregon` 要 180ms+，打牌会有明显延迟感。

### Koyeb（备用二：免绑卡、原生 WebSocket）

仓库已配好 `koyeb.yaml`，Koyeb 读到即按蓝图建服务。

1. 注册 https://koyeb.com （GitHub 登录，免绑卡）。
2. **Create App** → 关联 GitHub 仓库 `tractor-online`（分支 `main`）。
3. Koyeb 检测到 `koyeb.yaml` 自动建好服务（Node 构建、`fra` 节点、nano 实例、常驻 1 实例、端口 3000、健康检查 `/api/health`）。
4. 部署完得到固定地址 `https://tractor-online.koyeb.app`。

⚠️ 节点在法兰克福/华盛顿，**中国延迟 200ms+**，打牌偶觉卡顿；免费 nano 仅 512MB/0.1CPU。
仅当 Zeabur / Render 都不满意时考虑。（Railway 已无长期免费档、需绑卡，不推荐免费场景。）

### 腾讯云轻量应用服务器（国内最稳，推荐给国内朋友群）

适合：想要**固定公网 IP、24 小时不休眠、国内低延迟**（比 Render 新加坡还快），且能接受**实名认证 + 几十元/年**。

- 新用户有 **1 个月 0 元试用**（需实名认证上传身份证），之后 2核2G ≈ 68元/年、4核4G 秒杀 ≈ 38元/年。
- ⚠️ "1个月一换免费"不可行：试用是一次性新户权益，不能无限续免费月；实际就是每年花几十块换一台常驻服务器。
- 已备好一键脚本 `deploy-tencent.sh`（仓库根目录），在新实例上跑一次即可。

**购买与部署步骤**
1. 注册腾讯云 https://cloud.tencent.com 并完成**实名认证**。
2. 轻量应用服务器 → 新建实例：
   - 镜像：**Ubuntu 22.04 LTS**
   - 地域：就近（如**广州 / 上海**，国内延迟最低）
   - 规格：**2核2G 够用**（能抢到 4核4G 秒杀 ¥38/年更划算）
   - 拿到**公网 IP**（如 `1.2.3.4`）
3. 控制台 → 该实例 → **防火墙** → 添加规则：应用类型「自定义」、协议 `TCP`、端口 `3000`、来源 `0.0.0.0/0`。**（不放开朋友就访问不了）**
4. 用 SSH 登录实例（控制台自带"登录"按钮，或本地 `ssh root@<公网IP>`）。
5. 执行一键脚本：
   ```bash
   curl -fsSL https://raw.githubusercontent.com/bichangying/tractor-online/main/deploy-tencent.sh | bash
   ```
   脚本会：装 Node 20 → 克隆仓库 → 装依赖（走国内 npm 镜像加速）→ pm2 常驻并开机自启 → 放行 ufw 3000 端口。
6. 脚本结尾打印 `http://<公网IP>:3000`，把这个发朋友即可，地址永久不变。

**维护**
- 改了代码想更新：`ssh` 进服务器，`cd ~/tractor-online && git pull && npm ci --omit=dev && pm2 restart tractor-online`。
- 查看状态：`pm2 status` / `pm2 logs tractor-online`；重启服务器后若没自启：`pm2 resurrect`。

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

---

## 故障排查（踩过的坑，按现象查）

### 现象：隧道跑一会儿就断，朋友进不去
原因：localhost.run 对**空闲隧道**会主动断开，日志里能看到
`Received disconnect ... tunnel inactivity timeout`。
解决：用 `bash play.sh`。脚本内置每 45 秒一次保活心跳 + 断线 5 秒自动重连，
并把当前地址写入 `CURRENT_URL.txt`（重连后地址会变，以该文件/终端输出为准）。

### 现象：ssh 建隧道报 `Host key verification failed`
原因：后台运行无 TTY，无法交互确认主机密钥。
解决：命令必须带
`-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null`。

### 现象：GitHub / 外网页面打开转圈十几秒后失败（"一到关键步骤就断网"）
根因：**IPv6 DNS 卡死**，不是被墙。典型特征——
```bash
curl -4 https://github.com/   # 200，1 秒      ← IPv4 正常
curl    https://github.com/   # 000，超时 15 秒 ← 默认走 IPv6 卡住
```
若本机 DNS 服务器是 `fe80::1`（路由器的 IPv6 地址），它对 AAAA 查询不响应，
浏览器每个请求都要空等回退，表现为页面加载到一半就断。

修复（管理员 PowerShell，`10` 换成你的网卡 InterfaceIndex）：
```powershell
Get-NetAdapter | Where-Object {$_.Status -eq 'Up'}          # 先查 InterfaceIndex
Set-DnsClientServerAddress -InterfaceIndex 10 -ServerAddresses 223.5.5.5,119.29.29.29
Disable-NetAdapterBinding -Name 'WLAN' -ComponentID ms_tcpip6
Clear-DnsClientCache
```
还原：
```powershell
Set-DnsClientServerAddress -InterfaceIndex 10 -ResetServerAddresses
Enable-NetAdapterBinding -Name 'WLAN' -ComponentID ms_tcpip6
Clear-DnsClientCache
```

### 现象：GitHub 时通时不通（间歇抖动），或 Render 页面打不开

**第一步：先分清是"网络不通"还是"浏览器问题"。** 命令行测一遍：
```bash
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" --max-time 20 https://render.com/
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" --max-time 20 https://github.com/
```
- 命令行 **200** 但浏览器打不开 → 是**浏览器层**问题：清缓存、彻底退出浏览器重开
  （旧的失效连接会被复用）、或换个浏览器 / 无痕窗口。
- 命令行也 **000** → 往下看。

**第二步：判断是不是 DNS 抖动。** 用 `--resolve` 强制指定 IP 绕过 DNS：
```bash
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" --max-time 10 \
  --resolve github.com:443:20.205.243.166 https://github.com/
```
若 `--resolve` 是 200、直连是 000 → DNS/解析链路抖动，写 hosts 锁定 IP 可缓解。

**修复：写 hosts 锁定 GitHub IP**（管理员 PowerShell）
```powershell
$hosts = "$env:SystemRoot\System32\drivers\etc\hosts"
Copy-Item $hosts "D:\hosts_backup.txt" -Force     # 先备份
Add-Content -Path $hosts -Encoding ASCII -Value @"

# ===== GitHub accel =====
20.205.243.166  github.com
20.205.243.168  api.github.com
20.205.243.165  codeload.github.com
185.199.110.133 raw.githubusercontent.com
185.199.110.133 objects.githubusercontent.com
185.199.111.215 github.githubassets.com
185.199.110.133 avatars.githubusercontent.com
"@
ipconfig /flushdns
```
IP 会变，失效时用 DoH 重新查（不受本地 DNS 干扰）：
```bash
curl -s "https://dns.alidns.com/resolve?name=github.com&type=A"
```
还原：删掉 hosts 里 `# ===== GitHub accel =====` 那一段即可。

> 实测记录（2026-08-11）：写 hosts 后 github.com 从"间歇 000/20s 超时"变为稳定
> **200 / 0.65s**；但 `raw.githubusercontent.com`（185.199.x 段）仍不稳定——
> 这**不影响**网页操作和云平台部署（平台是从它自己的服务器拉代码，与你本地网络无关）。

### 现象：Render 登录/授权页卡住
Render 默认引导用 GitHub OAuth 登录，国内网络下这一跳容易失败。
绕开办法：用**邮箱注册**，再走上面「Render → 路径 B：公开仓库 URL 直连」，
全程不碰 github.com 的授权跳转。

### 现象：脚本误判"服务启动失败"，却报 `EADDRINUSE`
原因：某些沙箱/终端里 `curl -s -o /dev/null` 会返回**假的非零退出码**（23），
导致 `if curl ...` 判断为失败，脚本以为服务没起，重复启动就撞上端口占用。
解决：健康检查不要用 `-o /dev/null`，改成判断响应内容：
```bash
curl -s --max-time 3 "http://127.0.0.1:3000/api/health" | grep -q '"ok"'
```

### 关于 localhost.run 的固定域名
实测：**带 SSH 密钥连接也不会给固定子域名**（两次连接分别得到
`a34cff0eae646e` / `b43a04d115bc02`）。固定域名是付费功能。
想要永久不变的地址，走上面的「方式四：部署到云平台」。
