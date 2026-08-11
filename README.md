# 拖拉机 Online 🚜

网页版 **4 / 5 / 6 人在线拖拉机（升级）扑克**。开个链接就能玩，手机浏览器直接支持，不用装 App。

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/bichangying/tractor-online)

## 特性

- **三种人数模式**
  | 模式 | 牌副数 | 阵营 | 底牌 | 每人手牌 |
  |---|---|---|---|---|
  | 4 人 | 2 副 | 2v2 对家 | 8 张 | 25 张 |
  | 5 人 | 3 副 | 叫朋友 | 7 张 | 31 张 |
  | 6 人 | 3 副 | 3v3 | 6 张 | 26 张 |
- **完整规则**：主牌 / 级牌、跟牌校验、拖拉机（连对）、甩牌、扣底、埋底分翻倍、升级判定
- **实时对战**：Socket.IO 长连接，出牌即时同步，断线可重连
- **手机适配**：响应式布局，聊天面板做成抽屉，小屏也能舒服打
- **房间系统**：房主建房 → 分享房间号 → 朋友输号入座，支持换座、准备、踢人
- **AI 补位**：人不够时可加 AI 陪打
- **观战 + 回放**：对局可录制，支持复盘

## 快速开始

### 在线玩（推荐）

点上方 **Deploy to Render** 按钮，几分钟后拿到固定地址 `https://<你的服务名>.onrender.com`，发给朋友即可。
免费计划无需绑卡，详见 [DEPLOY.md](./DEPLOY.md)。

### 本地跑

```bash
npm install
npm start
# 打开 http://localhost:3000
```

### 让朋友临时连你电脑玩（免部署）

```bash
bash play.sh
```

脚本会自动启动服务 + 打通公网隧道（含保活心跳与断线自动重连），
当前公网地址实时写入 `CURRENT_URL.txt`，把它发给朋友就行。

## 开发

```bash
npm test    # 规则单元测试
npm run sim # 4/5/6 人 AI 全自动模拟对局
```

## 项目结构

```
shared/     规则与配置（前后端共用）
  ├─ cards.js      牌与牌型
  ├─ rules.js      核心规则：定序、结算、升级
  ├─ combos.js     牌组合判定（对子/拖拉机/甩牌）
  └─ config.js     4/5/6 人模式参数
server/
  ├─ core/         GameEngine 状态机、Room、RoomManager、Recorder
  ├─ ai/           AI 策略
  ├─ socket/       Socket.IO 事件处理
  └─ index.js      Express 入口
client/
  ├─ js/           Store（观察者模式）、网络层、视图
  ├─ render/       牌面与牌桌渲染
  └─ css/          样式（含移动端断点）
test/       单元测试与模拟对局
docs/       协议 / 架构 / 规则 / 路线图
```

对局状态机：`WAITING → DEALING → BURY → [CALL_FRIEND] → PLAYING → SETTLE → FINISHED`

详细设计见 [docs/](./docs)：
[协议](./docs/PROTOCOL.md) · [架构](./docs/ARCHITECTURE.md) · [规则](./docs/RULES.md) · [路线图](./docs/ROADMAP.md)

## 技术栈

Node.js + Express + Socket.IO v4，前端为浏览器原生 ES Modules（无框架、无构建步骤）。
发牌使用 mulberry32 seeded RNG，保证对局可复现、可回放。

## License

MIT
